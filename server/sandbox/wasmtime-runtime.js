import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { sandboxError } from './errors.js'
import { MAX_STDERR_BYTES, MAX_STDOUT_BYTES } from './limits.js'

const RUNTIME_VERSION = '48.0.0'
const VERSION_OUTPUT_LIMIT = 16 * 1024
const VERSION_TIMEOUT_MS = 2_000
const HOST_TIMEOUT_GRACE_MS = 250

export function buildWasmtimeArgs(moduleFile, limits) {
  return [
    'run',
    '-W', `fuel=${limits.fuel}`,
    '-W', `max-memory-size=${limits.memory_bytes}`,
    '-W', `max-wasm-stack=${limits.wasm_stack_bytes}`,
    '-W', `max-instances=${limits.instances}`,
    '-W', `max-memories=${limits.memories}`,
    '-W', `max-tables=${limits.tables}`,
    '-W', `timeout=${limits.timeout_ms}ms`,
    moduleFile,
  ]
}

export function buildWasmtimeChildEnv(parentEnv, privateTmp, platform = process.platform, { includePath = true } = {}) {
  const env = {}
  if (includePath && parentEnv?.PATH) env.PATH = parentEnv.PATH
  if (platform === 'win32') {
    if (parentEnv?.SystemRoot) env.SystemRoot = parentEnv.SystemRoot
    if (parentEnv?.WINDIR) env.WINDIR = parentEnv.WINDIR
    env.TEMP = privateTmp
    env.TMP = privateTmp
  } else {
    env.TMPDIR = privateTmp
  }
  return env
}

function resolveBinary(env) {
  const explicit = String(env?.EVEGLYPH_WASMTIME_BIN || '').trim()
  return explicit || 'wasmtime'
}

function collectVersionOutput(child, timeoutMs = VERSION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timer = null
    const finish = fn => value => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }
    const fail = finish(reject)
    const done = finish(resolve)
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)])
      if (next.length > VERSION_OUTPUT_LIMIT) throw sandboxError('sandbox_runtime_unavailable')
      return next
    }
    child.stdout?.on('data', chunk => {
      try { stdout = append(stdout, chunk) } catch (error) { try { child.kill() } catch {}; fail(error) }
    })
    child.stderr?.on('data', chunk => {
      try { stderr = append(stderr, chunk) } catch (error) { try { child.kill() } catch {}; fail(error) }
    })
    child.once('error', () => fail(sandboxError('sandbox_runtime_unavailable')))
    child.once('close', code => {
      if (code !== 0) {
        fail(sandboxError('sandbox_runtime_unavailable'))
        return
      }
      done({ stdout, stderr })
    })
    timer = setTimeout(() => {
      try { child.kill() } catch {}
      fail(sandboxError('sandbox_runtime_unavailable'))
    }, timeoutMs)
  })
}

function collectExecution(child, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let terminalError = null
    let settled = false
    let timer = null

    const finish = fn => value => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }
    const fail = finish(reject)
    const done = finish(resolve)

    const terminate = error => {
      if (!terminalError) terminalError = error
      try { child.kill('SIGKILL') } catch {}
    }

    child.stdout?.on('data', chunk => {
      if (terminalError) return
      const bytes = Buffer.from(chunk)
      stdoutBytes += bytes.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        terminate(sandboxError('sandbox_output_too_large'))
        return
      }
      stdout.push(bytes)
    })

    child.stderr?.on('data', chunk => {
      if (terminalError) return
      const bytes = Buffer.from(chunk)
      stderrBytes += bytes.length
      if (stderrBytes > MAX_STDERR_BYTES) {
        terminate(sandboxError('sandbox_stderr_too_large'))
        return
      }
      stderr.push(bytes)
    })

    child.once('error', () => fail(sandboxError('sandbox_spawn_failed')))
    child.once('close', (code, signal) => {
      if (terminalError) {
        fail(terminalError)
        return
      }
      if (code !== 0) {
        fail(sandboxError('sandbox_guest_exit_nonzero'))
        return
      }
      done({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exit_code: code ?? 0,
        signal: signal || null,
      })
    })

    timer = setTimeout(() => {
      terminate(sandboxError('sandbox_timeout'))
    }, timeoutMs)
  })
}

export function createWasmtimeRuntime({
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  tmpRoot = os.tmpdir(),
  nodeTimeoutMs = null,
} = {}) {
  const binary = resolveBinary(env)
  const explicit = Boolean(String(env?.EVEGLYPH_WASMTIME_BIN || '').trim())
  let verified = false

  async function verifyRuntime() {
    if (verified) return RUNTIME_VERSION
    let child
    try {
      child = spawnImpl(binary, ['--version'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildWasmtimeChildEnv(
          env,
          platform === 'win32' ? String(env?.TEMP || env?.TMP || '.') : String(env?.TMPDIR || '/tmp'),
          platform,
          { includePath: !explicit },
        ),
        windowsHide: true,
      })
    } catch {
      throw sandboxError('sandbox_runtime_unavailable')
    }

    const { stdout } = await collectVersionOutput(child)
    const text = stdout.toString('utf8').trim()
    if (!/^wasmtime 48\.0\.0(?:\s|$)/.test(text)) {
      throw sandboxError('sandbox_runtime_version_mismatch')
    }
    verified = true
    return RUNTIME_VERSION
  }

  async function execute({ moduleBytes, stdinBytes, limits }) {
    await verifyRuntime()
    if (!Buffer.isBuffer(moduleBytes) && !(moduleBytes instanceof Uint8Array)) {
      throw sandboxError('sandbox_invalid_module')
    }
    if (!Buffer.isBuffer(stdinBytes) && !(stdinBytes instanceof Uint8Array)) {
      throw sandboxError('sandbox_invalid_input')
    }

    await fs.mkdir(tmpRoot, { recursive: true })
    const runDir = await fs.mkdtemp(path.join(tmpRoot, 'eveglyph-wasmtime-'))
    const moduleFile = path.join(runDir, 'module.wasm')
    try {
      if (platform !== 'win32') await fs.chmod(runDir, 0o700).catch(() => {})
      await fs.writeFile(moduleFile, moduleBytes)
      if (platform !== 'win32') await fs.chmod(moduleFile, 0o600).catch(() => {})

      const args = buildWasmtimeArgs('module.wasm', limits)
      const childEnv = buildWasmtimeChildEnv(env, runDir, platform, { includePath: !explicit })
      let child
      try {
        child = spawnImpl(binary, args, {
          cwd: runDir,
          env: childEnv,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch {
        throw sandboxError('sandbox_spawn_failed')
      }

      child.stdin?.on('error', () => {})
      child.stdin?.end(Buffer.from(stdinBytes))
      const execution = await collectExecution(child, {
        timeoutMs: nodeTimeoutMs ?? (limits.timeout_ms + HOST_TIMEOUT_GRACE_MS),
      })
      return Object.freeze({
        ...execution,
        runtime_version: RUNTIME_VERSION,
      })
    } finally {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  return Object.freeze({
    binary,
    version: RUNTIME_VERSION,
    verifyRuntime,
    execute,
  })
}

export const WASMTIME_RUNTIME_VERSION = RUNTIME_VERSION
