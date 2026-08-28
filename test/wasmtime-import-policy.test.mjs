import test from 'node:test'
import assert from 'node:assert/strict'

function u32(value) {
  const out = []
  let n = value >>> 0
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n) byte |= 0x80
    out.push(byte)
  } while (n)
  return out
}

function utf8(text) {
  const bytes = [...new TextEncoder().encode(text)]
  return [...u32(bytes.length), ...bytes]
}

function section(id, payload) {
  return [id, ...u32(payload.length), ...payload]
}

function moduleWithImports(imports = [], { exportStart = true } = {}) {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
  const type = section(1, [0x01, 0x60, 0x00, 0x00])
  const importEntries = imports.flatMap(({ module, name }) => [
    ...utf8(module),
    ...utf8(name),
    0x00,
    0x00,
  ])
  const importSection = imports.length ? section(2, [...u32(imports.length), ...importEntries]) : []
  const functions = section(3, [0x01, 0x00])
  const exports = exportStart
    ? section(7, [0x01, ...utf8('_start'), 0x00, ...u32(imports.length)])
    : section(7, [0x00])
  const code = section(10, [0x01, 0x02, 0x00, 0x0b])
  return Buffer.from([...header, ...type, ...importSection, ...functions, ...exports, ...code])
}

async function loadPolicy() {
  const [limits, policy, errors] = await Promise.all([
    import('../server/sandbox/limits.js'),
    import('../server/sandbox/wasi-import-policy.js'),
    import('../server/sandbox/errors.js'),
  ])
  return { ...limits, ...policy, ...errors }
}

function assertCode(fn, code) {
  assert.throws(fn, error => error?.code === code)
}

test('sandbox policy normalizes canonical limits and rejects unknown or excessive authority budgets', async () => {
  const { normalizeSandboxLimits } = await loadPolicy()
  const limits = normalizeSandboxLimits({})
  assert.equal(limits.memory_bytes, 32 * 1024 * 1024)
  assert.equal(limits.timeout_ms, 2000)
  assert.equal(limits.fuel, 10_000_000)
  assert.equal(limits.wasm_stack_bytes, 1024 * 1024)
  assert.equal(limits.instances, 1)
  assert.equal(limits.memories, 1)
  assert.equal(limits.tables, 1)
  assert.equal(Object.isFrozen(limits), true)

  assertCode(() => normalizeSandboxLimits({ timeout_ms: 10_001 }), 'sandbox_invalid_limits')
  assertCode(() => normalizeSandboxLimits({ memory_bytes: 64 * 1024 * 1024 + 1 }), 'sandbox_invalid_limits')
  assertCode(() => normalizeSandboxLimits({ fuel: 100_000_001 }), 'sandbox_invalid_limits')
  assertCode(() => normalizeSandboxLimits({ unknown: 1 }), 'sandbox_invalid_limits')
})

test('module Base64 decoding is canonical, bounded before decode, and returns exact bytes', async () => {
  const { decodeCanonicalModuleBase64 } = await loadPolicy()
  const wasm = moduleWithImports([])
  const encoded = wasm.toString('base64')
  assert.deepEqual(decodeCanonicalModuleBase64(encoded), wasm)

  assertCode(() => decodeCanonicalModuleBase64('%%%%'), 'sandbox_invalid_module')
  assertCode(() => decodeCanonicalModuleBase64(`${encoded}\n`), 'sandbox_invalid_module')
  assertCode(() => decodeCanonicalModuleBase64(''), 'sandbox_invalid_module')
  assertCode(() => decodeCanonicalModuleBase64('A'.repeat(1_500_000)), 'sandbox_invalid_module')
})

test('wasi-stdio-json accepts only fd_read/fd_write/proc_exit function imports and requires _start', async () => {
  const { inspectWasiStdioJsonModule } = await loadPolicy()
  const valid = moduleWithImports([
    { module: 'wasi_snapshot_preview1', name: 'fd_read' },
    { module: 'wasi_snapshot_preview1', name: 'fd_write' },
  ])
  const info = inspectWasiStdioJsonModule(valid)
  assert.deepEqual(info.imports, [
    'wasi_snapshot_preview1.fd_read',
    'wasi_snapshot_preview1.fd_write',
  ])
  assert.equal(info.entrypoint, '_start')

  for (const denied of [
    { module: 'wasi_snapshot_preview1', name: 'path_open' },
    { module: 'wasi_snapshot_preview1', name: 'environ_get' },
    { module: 'env', name: 'host_call' },
  ]) {
    assertCode(
      () => inspectWasiStdioJsonModule(moduleWithImports([denied])),
      'sandbox_import_denied',
    )
  }

  assertCode(
    () => inspectWasiStdioJsonModule(moduleWithImports([], { exportStart: false })),
    'sandbox_entrypoint_missing',
  )
  assertCode(() => inspectWasiStdioJsonModule(Buffer.from('not wasm')), 'sandbox_invalid_module')
})
