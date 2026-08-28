import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeSandboxLimits } from '../server/sandbox/limits.js'
import { inspectWasiStdioJsonModule } from '../server/sandbox/wasi-import-policy.js'
import { createWasmtimeRuntime } from '../server/sandbox/wasmtime-runtime.js'

const fixture = name => readFile(path.resolve('.tmp/wasmtime-fixtures', `${name}.wasm`))
const emptyInput = Buffer.from('{}\n', 'utf8')

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code, `expected ${code}`)
}

test('filesystem, environment, and unknown host imports are denied before runtime execution', async () => {
  for (const [name, expectedImport] of [
    ['path-open', 'path_open'],
    ['environ-get', 'environ_get'],
    ['unknown-import', 'host_call'],
  ]) {
    const bytes = await fixture(name)
    assert.throws(
      () => inspectWasiStdioJsonModule(bytes),
      error => error?.code === 'sandbox_import_denied',
      `${name} (${expectedImport}) must be statically denied`,
    )
  }
})

test('exact Wasmtime fuel exhaustion is classified separately from generic guest exit', async () => {
  const runtime = createWasmtimeRuntime({ env: process.env })
  const moduleBytes = await fixture('infinite-loop')
  await expectCode(runtime.execute({
    moduleBytes,
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({ fuel: 1_000, timeout_ms: 10_000 }),
  }), 'sandbox_fuel_exhausted')
})

test('independent Node wall-clock timeout terminates a guest even when Wasmtime budgets are generous', async () => {
  const runtime = createWasmtimeRuntime({ env: process.env, nodeTimeoutMs: 20 })
  const moduleBytes = await fixture('infinite-loop')
  await expectCode(runtime.execute({
    moduleBytes,
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({ fuel: 100_000_000, timeout_ms: 10_000 }),
  }), 'sandbox_timeout')
})

test('memory growth beyond the configured bound traps with a stable memory-limit code', async () => {
  const runtime = createWasmtimeRuntime({ env: process.env })
  const moduleBytes = await fixture('memory-grow')
  await expectCode(runtime.execute({
    moduleBytes,
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({ memory_bytes: 32 * 1024 * 1024 }),
  }), 'sandbox_memory_limit')
})

test('stdout and stderr bombs are killed at EveGlyph pipe limits', async () => {
  const runtime = createWasmtimeRuntime({ env: process.env })
  await expectCode(runtime.execute({
    moduleBytes: await fixture('output-bomb'),
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({}),
  }), 'sandbox_output_too_large')

  await expectCode(runtime.execute({
    moduleBytes: await fixture('stderr-bomb'),
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({}),
  }), 'sandbox_stderr_too_large')
})

test('ordinary non-zero proc_exit remains distinct from runtime resource traps', async () => {
  const runtime = createWasmtimeRuntime({ env: process.env })
  await expectCode(runtime.execute({
    moduleBytes: await fixture('nonzero-exit'),
    stdinBytes: emptyInput,
    limits: normalizeSandboxLimits({}),
  }), 'sandbox_guest_exit_nonzero')
})
