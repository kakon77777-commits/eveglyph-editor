import test from 'node:test'
import assert from 'node:assert/strict'

async function requireDelegation() {
  try { return await import('../server/credentials/delegation-broker.js') }
  catch (error) { assert.fail(`delegation broker is not implemented: ${error.message}`) }
}

function claim(overrides = {}) {
  return {
    provider: 'github',
    operation: 'read-file',
    capability: 'connector.github.repository.contents.read',
    resource: 'github:repository:owner/repo:contents:README.md',
    actor: 'github:user:7',
    ...overrides,
  }
}

test('delegation broker issues opaque hash-stored one-use tickets and public listing never includes raw ticket', async () => {
  const { createDelegationBroker } = await requireDelegation()
  let now = new Date('2026-08-28T06:00:00.000Z')
  const broker = createDelegationBroker({
    now: () => now,
    randomBytesImpl: size => Buffer.alloc(size, 7),
  })
  const issued = broker.issue(claim())
  assert.equal(typeof issued.ticket, 'string')
  assert.ok(issued.ticket.length > 20)
  assert.equal(JSON.stringify(broker.listPublic()).includes(issued.ticket), false)
  assert.equal('ticket' in broker.listPublic()[0], false)

  const consumed = broker.consume({ ticket: issued.ticket, ...claim() })
  assert.equal(consumed.remaining_uses, 0)
  assert.throws(() => broker.consume({ ticket: issued.ticket, ...claim() }), { code: 'delegation_not_found' })
})

test('delegation exact-matches provider operation capability and resource', async () => {
  const { createDelegationBroker } = await requireDelegation()
  const broker = createDelegationBroker({ randomBytesImpl: size => Buffer.alloc(size, 8) })
  const issued = broker.issue({ ...claim(), maxUses: 3 })
  for (const mismatch of [
    { provider: 'google' },
    { operation: 'list-files' },
    { capability: 'connector.github.repository.contents.write' },
    { resource: 'github:repository:owner/other:contents:README.md' },
  ]) {
    assert.throws(() => broker.consume({ ticket: issued.ticket, ...claim(), ...mismatch }), { code: 'delegation_mismatch' })
  }
  const ok = broker.consume({ ticket: issued.ticket, ...claim() })
  assert.equal(ok.remaining_uses, 2)
})

test('delegation broker enforces ttl bounds, expiry, revoke, and max-use bounds', async () => {
  const { createDelegationBroker } = await requireDelegation()
  let now = new Date('2026-08-28T06:00:00.000Z')
  let byte = 20
  const broker = createDelegationBroker({
    now: () => now,
    randomBytesImpl: size => Buffer.alloc(size, byte++),
  })
  assert.throws(() => broker.issue({ ...claim(), ttlMs: 300001 }), { code: 'delegation_ttl_invalid' })
  assert.throws(() => broker.issue({ ...claim(), maxUses: 11 }), { code: 'delegation_uses_invalid' })

  const expiring = broker.issue({ ...claim(), ttlMs: 1000 })
  now = new Date('2026-08-28T06:00:01.001Z')
  assert.throws(() => broker.consume({ ticket: expiring.ticket, ...claim() }), { code: 'delegation_expired' })

  const revoked = broker.issue(claim())
  assert.equal(broker.revoke(revoked.ticket), true)
  assert.throws(() => broker.consume({ ticket: revoked.ticket, ...claim() }), { code: 'delegation_not_found' })
})
