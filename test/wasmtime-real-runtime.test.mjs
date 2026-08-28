import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { normalizeSandboxLimits } from '../server/sandbox/limits.js'
import { createWasmtimeRuntime } from '../server/sandbox/wasmtime-runtime.js'

const fixture = name => path.resolve('.tmp/wasmtime-fixtures', `${name}.wasm`)

test('Wasmtime 48 executes a wasi-stdio-json guest through private staging and cleans it up', async () => {
  const moduleBytes = await readFile(fixture('echo-json'))
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-wasmtime-test-root-'))
  const input = Buffer.from('{"n":7,"ok":true}\n', 'utf8')
  const runtime = createWasmtimeRuntime({
    env: process.env,
    platform: process.platform,
    tmpRoot,
  })

  try {
    assert.equal(await runtime.verifyRuntime(), '48.0.0')
    const result = await runtime.execute({
      moduleBytes,
      stdinBytes: input,
      limits: normalizeSandboxLimits({}),
    })
    assert.equal(result.runtime_version, '48.0.0')
    assert.equal(result.exit_code, 0)
    assert.deepEqual(result.stdout, input)
    assert.equal(result.stderr.length, 0)
    assert.deepEqual(await readdir(tmpRoot), [], 'private per-execution directory must be removed')
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
})
