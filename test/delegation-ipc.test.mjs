import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

async function requireModules() {
  try {
    const delegation = await import('../server/credentials/delegation-broker.js')
    const ipc = await import('../server/credentials/delegation-ipc.js')
    return { ...delegation, ...ipc }
  } catch (error) {
    assert.fail(`delegation IPC is not implemented: ${error.message}`)
  }
}

function endpointForTest() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\eveglyph-test-${process.pid}-${Date.now()}`
  return path.join(os.tmpdir(), `eveglyph-test-${process.pid}-${Date.now()}.sock`)
}

function invoke(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    let text = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.end(`${JSON.stringify(payload)}\n`))
    socket.on('data', chunk => { text += chunk })
    socket.on('end', () => {
      try { resolve(JSON.parse(text.trim())) }
      catch (error) { reject(error) }
    })
    socket.on('error', reject)
  })
}

const claim = {
  provider: 'github',
  operation: 'read-file',
  capability: 'connector.github.repository.contents.read',
  resource: 'github:repository:owner/repo:contents:README.md',
  actor: 'github:user:7',
}

test('local IPC consumes delegation before handler execution and one-use ticket cannot replay', async () => {
  const { createDelegationBroker, createDelegationIpcServer } = await requireModules()
  let calls = 0
  const broker = createDelegationBroker()
  const issued = broker.issue(claim)
  const endpoint = endpointForTest()
  const server = createDelegationIpcServer({
    delegationBroker: broker,
    endpoint,
    handlers: {
      'github:read-file': async ({ delegation, input }) => {
        calls += 1
        assert.equal(delegation.capability, claim.capability)
        return { ok: true, content: input.path }
      },
    },
  })
  await server.start()
  try {
    const request = { method: 'invoke', ticket: issued.ticket, ...claim, input: { path: 'README.md' } }
    const first = await invoke(endpoint, request)
    assert.deepEqual(first, { ok: true, result: { ok: true, content: 'README.md' } })
    assert.equal(calls, 1)
    const second = await invoke(endpoint, request)
    assert.equal(second.ok, false)
    assert.equal(second.error.code, 'delegation_not_found')
    assert.equal(calls, 1)
  } finally {
    await server.stop()
  }
})

test('IPC rejects malformed or oversized requests before handler execution and never exposes stack/credential fields', async () => {
  const { createDelegationBroker, createDelegationIpcServer } = await requireModules()
  let calls = 0
  const broker = createDelegationBroker()
  const endpoint = endpointForTest()
  const server = createDelegationIpcServer({
    delegationBroker: broker,
    endpoint,
    maxRequestBytes: 256,
    handlers: {
      'github:read-file': async () => { calls += 1; return { accessToken: 'must-not-return' } },
    },
  })
  await server.start()
  try {
    const malformed = await new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint)
      let text = ''
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.end('{bad json}\n'))
      socket.on('data', c => { text += c })
      socket.on('end', () => { try { resolve(JSON.parse(text.trim())) } catch (e) { reject(e) } })
      socket.on('error', reject)
    })
    assert.equal(malformed.ok, false)
    assert.equal(malformed.error.code, 'ipc_invalid_json')
    assert.equal(JSON.stringify(malformed).includes('stack'), false)

    const tooLarge = await new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint)
      let text = ''
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.end(`${'x'.repeat(300)}\n`))
      socket.on('data', c => { text += c })
      socket.on('end', () => { try { resolve(JSON.parse(text.trim())) } catch (e) { reject(e) } })
      socket.on('error', reject)
    })
    assert.equal(tooLarge.ok, false)
    assert.equal(tooLarge.error.code, 'ipc_request_too_large')
    assert.equal(calls, 0)
  } finally {
    await server.stop()
  }
})
