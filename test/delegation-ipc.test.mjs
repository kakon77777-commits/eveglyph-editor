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

test('one-use ticket survives a genuine concurrent-dispatch race: exactly one of N simultaneous invocations succeeds', async () => {
  // Sequential issue-then-consume-then-consume-again (the test above) proves
  // ordering but not concurrency safety. This test fires real, independent
  // socket connections at the same ticket concurrently (a realistic surface
  // — e.g. a caller's retry racing its own original request) and confirms
  // the single-use guarantee still holds through the actual IPC stack, not
  // just against a mocked/direct broker call.
  //
  // What this test does NOT prove: consume() itself (delegation-broker.js)
  // is currently fully synchronous with no internal await, which is what
  // actually makes it atomic under Node's run-to-completion model — not
  // careful locking. I verified by deliberately inserting an await
  // immediately before the consume() call in delegation-ipc.js and
  // re-running this exact test: it still passed every time, because Node's
  // real socket/pipe accept-and-read scheduling in this environment does not
  // reliably interleave separate connections finely enough to expose that
  // specific regression. So this test is real regression coverage for the
  // shipped IPC path, but it is NOT a tripwire for "someone made consume()
  // internally async" — see the comment on consume() itself in
  // delegation-broker.js for the invariant that actually guards against that.
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
        // Widen the async window between consume() and handler completion so
        // a real regression (e.g. an await inserted before consume()) has a
        // realistic chance of being caught by a race this size, not just a
        // theoretical one.
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(delegation.capability, claim.capability)
        return { ok: true, content: input.path }
      },
    },
  })
  await server.start()
  try {
    const request = { method: 'invoke', ticket: issued.ticket, ...claim, input: { path: 'README.md' } }
    const CONCURRENCY = 10
    const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => invoke(endpoint, request)))
    const succeeded = results.filter(r => r.ok === true)
    const denied = results.filter(r => r.ok === false && r.error?.code === 'delegation_not_found')
    assert.equal(succeeded.length, 1, `expected exactly 1 success among ${CONCURRENCY} concurrent attempts, got ${succeeded.length}`)
    assert.equal(denied.length, CONCURRENCY - 1)
    assert.equal(calls, 1, 'handler must run exactly once even under concurrent dispatch')
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
