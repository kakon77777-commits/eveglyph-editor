import { createHash, randomBytes } from 'node:crypto'

const DEFAULT_TTL_MS = 60 * 1000
const MAX_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_USES = 1
const MAX_USES = 10

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw codedError('delegation_invalid', `${field} must be a non-empty string`)
  return value.trim()
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('delegation_clock_error', 'delegation clock returned an invalid date')
  return date
}

function ticketHash(ticket) {
  return createHash('sha256').update(requiredString(ticket, 'ticket')).digest('hex')
}

function publicRecord(record) {
  return Object.freeze({
    delegation_id: record.id,
    provider: record.provider,
    operation: record.operation,
    capability: record.capability,
    resource: record.resource,
    actor: record.actor,
    issued_at: record.issuedAt,
    expires_at: record.expiresAt,
    max_uses: record.maxUses,
    remaining_uses: record.remainingUses,
  })
}

export function createDelegationBroker({
  now = () => new Date(),
  randomBytesImpl = randomBytes,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof randomBytesImpl !== 'function') throw new TypeError('randomBytesImpl must be a function')
  const records = new Map()

  function issue({
    provider,
    operation,
    capability,
    resource,
    actor,
    ttlMs = DEFAULT_TTL_MS,
    maxUses = DEFAULT_MAX_USES,
  } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw codedError('delegation_ttl_invalid', `delegation ttl must be between 1 and ${MAX_TTL_MS} ms`)
    }
    if (!Number.isInteger(maxUses) || maxUses <= 0 || maxUses > MAX_USES) {
      throw codedError('delegation_uses_invalid', `delegation maxUses must be between 1 and ${MAX_USES}`)
    }
    const issued = asDate(now())
    const rawBytes = randomBytesImpl(32)
    if (!rawBytes || typeof rawBytes.toString !== 'function' || rawBytes.length !== 32) {
      throw codedError('delegation_random_error', 'delegation random source must return 32 bytes')
    }
    const ticket = Buffer.from(rawBytes).toString('base64url')
    const hash = ticketHash(ticket)
    if (records.has(hash)) throw codedError('delegation_collision', 'delegation ticket collision')
    const record = {
      id: hash.slice(0, 24),
      provider: requiredString(provider, 'provider'),
      operation: requiredString(operation, 'operation'),
      capability: requiredString(capability, 'capability'),
      resource: requiredString(resource, 'resource'),
      actor: requiredString(actor, 'actor'),
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + ttlMs).toISOString(),
      maxUses,
      remainingUses: maxUses,
    }
    records.set(hash, record)
    return Object.freeze({ ticket, delegation: publicRecord(record) })
  }

  // INVARIANT: this function must stay fully synchronous — no `await`
  // anywhere in its body, and callers must invoke it with no `await` between
  // "a request for this ticket arrived" and "this function runs". The
  // one-use guarantee (records.delete / remainingUses-- below) relies
  // entirely on Node's run-to-completion model making the whole
  // lookup-check-decrement sequence atomic; it is not enforced by a lock.
  // Two calls racing this function concurrently (e.g. because a future
  // change makes ticket lookup hit an async store, or a caller adds an
  // `await` before invoking this) would both read `record` before either
  // writes back `remainingUses`, and a "one-use" ticket could be consumed
  // twice. No test in this repo can catch that regression by construction —
  // see the comment on the concurrent-dispatch test in
  // test/delegation-ipc.test.mjs for why real socket-level concurrency
  // doesn't reliably expose it — so this must hold by code review, not by CI.
  function consume({ ticket, provider, operation, capability, resource } = {}) {
    const hash = ticketHash(ticket)
    const record = records.get(hash)
    if (!record) throw codedError('delegation_not_found', 'delegation ticket not found')
    const current = asDate(now())
    if (current.getTime() >= new Date(record.expiresAt).getTime()) {
      records.delete(hash)
      throw codedError('delegation_expired', 'delegation ticket expired')
    }
    const expected = {
      provider: requiredString(provider, 'provider'),
      operation: requiredString(operation, 'operation'),
      capability: requiredString(capability, 'capability'),
      resource: requiredString(resource, 'resource'),
    }
    if (record.provider !== expected.provider || record.operation !== expected.operation ||
        record.capability !== expected.capability || record.resource !== expected.resource) {
      throw codedError('delegation_mismatch', 'delegation ticket does not authorize this operation')
    }
    record.remainingUses -= 1
    const result = publicRecord(record)
    if (record.remainingUses <= 0) records.delete(hash)
    return result
  }

  function revoke(ticket) {
    let hash
    try { hash = ticketHash(ticket) }
    catch { return false }
    return records.delete(hash)
  }

  function listPublic() {
    const current = asDate(now()).getTime()
    const output = []
    for (const [hash, record] of records) {
      if (current >= new Date(record.expiresAt).getTime()) {
        records.delete(hash)
        continue
      }
      output.push(publicRecord(record))
    }
    return Object.freeze(output)
  }

  return Object.freeze({ issue, consume, revoke, listPublic })
}

export { DEFAULT_TTL_MS, MAX_TTL_MS, DEFAULT_MAX_USES, MAX_USES }
