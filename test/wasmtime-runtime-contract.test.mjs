import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

async function loadRuntime() {
  return import('../server/sandbox/wasmtime-runtime.js')
}

function childThat({ stdout = '', stderr = '', code = 0, error = null } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.kill = () => { child.killed = true; return true }
  process.nextTick(() => {
    if (error) {
      child.emit('error', error)
      return
    }
    if (stdout) child.stdout.write(stdout)
    if (stderr) child.stderr.write(stderr)
    child.stdout.end()
    child.stderr.end()
    child.emit('close', code, null)
  })
  return child
}

test('Wasmtime argv applies exact bounded wasm controls with no ambient WASI authority flags', async () => {
  const { buildWasmtimeArgs } = await loadRuntime()
  const limits = {
    fuel: 10_000_000,
    memory_bytes: 32 * 1024 * 1024,
    timeout_ms: 2_000,
    wasm_stack_bytes: 1024 * 1024,
    instances: 1,
    memories: 1,
    tables: 1,
  }
  const args = buildWasmtimeArgs('module.wasm', limits)
  assert.deepEqual(args, [
    'run',
    '-W', 'fuel=10000000',
    '-W', 'max-memory-size=33554432',
    '-W', 'max-wasm-stack=1048576',
    '-W', 'max-instances=1',
    '-W', 'max-memories=1',
    '-W', 'max-tables=1',
    '-W', 'trap-on-grow-failure=y',
    '-W', 'timeout=2000ms',
    'module.wasm',
  ])
  const joined = args.join(' ')
  for (const denied of ['--dir', '--env', 'inherit-env', 'inherit-network', '--tcplisten', '--allow-precompiled']) {
    assert.equal(joined.includes(denied), false, `argv must not contain ${denied}`)
  }
})

test('Wasmtime child environment is explicit and excludes parent secrets/home state', async () => {
  const { buildWasmtimeChildEnv } = await loadRuntime()
  const parent = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/user',
    USERPROFILE: 'C:\\Users\\user',
    TMPDIR: '/parent-tmp',
    EVEGLYPH_GITHUB_CLIENT_SECRET: 'github-secret',
    EVEGLYPH_GOOGLE_CLIENT_SECRET: 'google-secret',
    EVEGLYPH_MCP_TOKEN: 'mcp-secret',
    OPENAI_API_KEY: 'openai-secret',
    GITHUB_TOKEN: 'token',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    ARBITRARY_PARENT_VALUE: 'nope',
  }
  assert.deepEqual(
    buildWasmtimeChildEnv(parent, '/private-run', 'linux', { includePath: true }),
    { PATH: '/usr/bin:/bin', TMPDIR: '/private-run' },
  )
  assert.deepEqual(
    buildWasmtimeChildEnv(parent, '/private-run', 'linux', { includePath: false }),
    { TMPDIR: '/private-run' },
  )

  const windowsParent = {
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\user',
    EVEGLYPH_GOOGLE_CLIENT_SECRET: 'secret',
  }
  assert.deepEqual(
    buildWasmtimeChildEnv(windowsParent, 'C:\\Temp\\eveglyph-private', 'win32', { includePath: true }),
    {
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      TEMP: 'C:\\Temp\\eveglyph-private',
      TMP: 'C:\\Temp\\eveglyph-private',
    },
  )
})

test('runtime verification accepts exactly Wasmtime 48.0.0 and redacts unavailable/version errors', async () => {
  const { createWasmtimeRuntime } = await loadRuntime()
  const calls = []
  const runtime = createWasmtimeRuntime({
    env: { EVEGLYPH_WASMTIME_BIN: '/opt/wasmtime' },
    platform: 'linux',
    spawnImpl(command, args, options) {
      calls.push({ command, args, options })
      return childThat({ stdout: 'wasmtime 48.0.0 (abcdef 2026-08-20)\n' })
    },
  })
  assert.equal(await runtime.verifyRuntime(), '48.0.0')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, '/opt/wasmtime')
  assert.deepEqual(calls[0].args, ['--version'])
  assert.equal(calls[0].options.shell, false)
  assert.equal('HOME' in calls[0].options.env, false)

  const mismatch = createWasmtimeRuntime({
    env: { EVEGLYPH_WASMTIME_BIN: '/opt/wasmtime' },
    platform: 'linux',
    spawnImpl: () => childThat({ stdout: 'wasmtime 47.0.2\n' }),
  })
  await assert.rejects(mismatch.verifyRuntime(), error => error?.code === 'sandbox_runtime_version_mismatch')

  const missing = createWasmtimeRuntime({
    env: {},
    platform: 'linux',
    spawnImpl: () => childThat({ error: Object.assign(new Error('not found /secret/path'), { code: 'ENOENT' }) }),
  })
  await assert.rejects(missing.verifyRuntime(), error => error?.code === 'sandbox_runtime_unavailable')
})
