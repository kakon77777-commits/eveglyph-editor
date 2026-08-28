import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createCapabilitySession } from '../src/capabilities/session.js'

const fixture = name => readFile(path.resolve('.tmp/wasmtime-fixtures', `${name}.wasm`))

async function loadService() {
  return import('../server/sandbox/document-wasm-service.js')
}

function mockRuntime({ stdout = Buffer.from('{"ok":true}\n'), stderr = Buffer.alloc(0) } = {}) {
  const state = { executeCalls: 0, last: null }
  return {
    version: '48.0.0',
    state,
    async execute(request) {
      state.executeCalls += 1
      state.last = request
      return {
        stdout,
        stderr,
        exit_code: 0,
        signal: null,
        runtime_version: '48.0.0',
      }
    },
  }
}

async function validRequest(extra = {}) {
  const bytes = await fixture('echo-json')
  return {
    moduleBase64: bytes.toString('base64'),
    input: { n: 7 },
    ...extra,
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code, `expected ${code}`)
}

test('capability denial happens before module execution and physical runtime access', async () => {
  const { createDocumentWasmService } = await loadService()
  const runtime = mockRuntime()
  const service = createDocumentWasmService({ runtime })
  const denyingSession = createCapabilitySession({ profile: 'connector-session' })

  await assert.rejects(
    service.execute(await validRequest({ session: denyingSession })),
    error => error?.code === 'capability_denied',
  )
  assert.equal(runtime.state.executeCalls, 0)
})

test('successful document Wasm execution returns parsed JSON and capability/physical evidence without host paths', async () => {
  const { createDocumentWasmService } = await loadService()
  const runtime = mockRuntime({ stdout: Buffer.from('{"answer":42}\n', 'utf8') })
  const service = createDocumentWasmService({ runtime })
  const result = await service.execute(await validRequest({
    actor: { client: 'test-client', document: 'inline:test-wasm' },
  }))

  assert.deepEqual(result.result, { answer: 42 })
  assert.match(result.module_sha256, /^[0-9a-f]{64}$/)
  assert.equal(result.sandbox.runtime, 'wasmtime')
  assert.equal(result.sandbox.runtime_version, '48.0.0')
  assert.equal(result.sandbox.profile, 'wasi-stdio-json')
  assert.equal(result.sandbox.entrypoint, '_start')
  assert.deepEqual(result.sandbox.imports, [
    'wasi_snapshot_preview1.fd_read',
    'wasi_snapshot_preview1.fd_write',
  ])
  assert.equal(result.sandbox.limits.memory_bytes, 32 * 1024 * 1024)
  assert.equal(result.sandbox.limits.timeout_ms, 2000)
  assert.equal(result.sandbox.capability.profile, 'document-only')
  assert.deepEqual(
    result.sandbox.capability.audit.map(item => [item.request.capability, item.decision]),
    [
      ['document.read.self', 'allow'],
      ['document.compute', 'allow'],
      ['ephemeral.output', 'allow'],
    ],
  )

  assert.deepEqual(runtime.state.last.stdinBytes, Buffer.from('{"n":7}\n', 'utf8'))
  const publicText = JSON.stringify(result)
  for (const forbidden of ['runDir', 'cwd', 'module.wasm', 'TMPDIR', 'PATH=', 'EVEGLYPH_', 'clientSecret', 'accessToken', 'refreshToken']) {
    assert.equal(publicText.includes(forbidden), false, `result leaked ${forbidden}`)
  }
})

test('document Wasm input must be JSON-compatible and remain inside the 256 KiB bound', async () => {
  const { createDocumentWasmService } = await loadService()
  const runtime = mockRuntime()
  const service = createDocumentWasmService({ runtime })

  const cyclic = {}
  cyclic.self = cyclic
  await expectCode(service.execute(await validRequest({ input: cyclic })), 'sandbox_invalid_input')
  await expectCode(
    service.execute(await validRequest({ input: 'x'.repeat(300 * 1024) })),
    'sandbox_input_too_large',
  )
  assert.equal(runtime.state.executeCalls, 0)
})

test('document Wasm service fail-closes empty, malformed UTF-8, and invalid JSON stdout', async () => {
  const { createDocumentWasmService } = await loadService()

  for (const [stdout, code] of [
    [Buffer.alloc(0), 'sandbox_output_empty'],
    [Buffer.from([0xc3, 0x28]), 'sandbox_output_invalid_utf8'],
    [Buffer.from('not-json', 'utf8'), 'sandbox_output_invalid_json'],
  ]) {
    const service = createDocumentWasmService({ runtime: mockRuntime({ stdout }) })
    await expectCode(service.execute(await validRequest()), code)
  }
})

test('module import denial is enforced by the service before runtime execute', async () => {
  const { createDocumentWasmService } = await loadService()
  const runtime = mockRuntime()
  const service = createDocumentWasmService({ runtime })
  const bytes = await fixture('path-open')
  await expectCode(service.execute({
    moduleBase64: bytes.toString('base64'),
    input: {},
  }), 'sandbox_import_denied')
  assert.equal(runtime.state.executeCalls, 0)
})
