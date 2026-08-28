import { spawn } from 'node:child_process'
import { sandboxError } from './errors.js'

const RUNTIME_VERSION = '48.0.0'
const VERSION_OUTPUT_LIMIT = 16 * 1024
const VERSION_TIMEOUT_MS = 2_000

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
    const finish = fn => value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
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
    child.once('error', error => {
      fail(error?.code === 'ENOENT'
        ? sandboxError('sandbox_runtime_unavailable')
        : sandboxError('sandbox_runtime_unavailable'))
    })
    child.once('close', code => {
      if (code !== 0) {
        fail(sandboxError('sandbox_runtime_unavailable'))
        return
      }
      done({ stdout, stderr })
    })
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      fail(sandboxError('sandbox_runtime_unavailable'))
    }, timeoutMs)
  })
}

export function createWasmtimeRuntime({
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  const binary = resolveBinary(env)
  const explicit = Boolean(String(env?.EVEGLYPH_WASMTIME_BIN || '').trim())

  async function verifyRuntime() {
    let child
    try {
      child = spawnImpl(binary, ['--version'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildWasmtimeChildEnv(env, platform === 'win32' ? String(env?.TEMP || env?.TMP || '.') : String(env?.TMPDIR || '/tmp'), platform, {
          includePath: !explicit,
        }),
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
    return RUNTIME_VERSION
  }

  async function execute() {
    throw sandboxError('sandbox_internal_error')
  }

  return Object.freeze({
    binary,
    version: RUNTIME_VERSION,
    verifyRuntime,
    execute,
  })
}

export const WASMTIME_RUNTIME_VERSION = RUNTIME_VERSION
