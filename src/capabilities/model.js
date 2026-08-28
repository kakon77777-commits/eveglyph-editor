import { getCapabilityDefinition } from './registry.js'

export const CAPABILITY_LIFETIMES = Object.freeze([
  'once',
  'session',
  'workspace',
  'until',
  'persistent',
])

const LIFETIME_SET = new Set(CAPABILITY_LIFETIMES)
const ACTOR_FIELDS = ['humanPrincipal', 'client', 'agent', 'document', 'session']

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field, code) {
  if (typeof value !== 'string' || !value.trim()) {
    throw codedError(code, `${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value, field, code) {
  if (value == null || value === '') return null
  return requiredString(value, field, code)
}

function normalizeLifetime(value, code) {
  const lifetime = value == null ? 'once' : requiredString(value, 'lifetime', code)
  if (!LIFETIME_SET.has(lifetime)) throw codedError(code, `unsupported lifetime: ${lifetime}`)
  return lifetime
}

function normalizeContext(value, code) {
  if (value == null) return Object.freeze({})
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw codedError(code, 'context must be a plain object')
  }
  return Object.freeze({ ...value })
}

function normalizeExpiresAt(value, lifetime, code) {
  if (value == null || value === '') {
    if (lifetime === 'until') throw codedError(code, 'until grants require expiresAt')
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw codedError(code, 'expiresAt must be a valid timestamp')
  return parsed.toISOString()
}

export function createActorContext(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw codedError('invalid_capability_request', 'actor context must be an object')
  }
  const actor = {}
  for (const field of ACTOR_FIELDS) actor[field] = optionalString(input[field], `actor.${field}`, 'invalid_capability_request')
  return Object.freeze(actor)
}

export function createCapabilityRequest(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw codedError('invalid_capability_request', 'capability request must be an object')
  }
  const capability = requiredString(input.capability, 'capability', 'invalid_capability_request')
  getCapabilityDefinition(capability)
  const resource = requiredString(input.resource, 'resource', 'invalid_capability_request')
  const lifetime = normalizeLifetime(input.lifetime, 'invalid_capability_request')
  const reason = input.reason == null ? '' : String(input.reason)
  const context = normalizeContext(input.context, 'invalid_capability_request')
  return Object.freeze({ capability, resource, lifetime, reason, context })
}

export function createGrant(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw codedError('invalid_grant', 'grant must be an object')
  }
  const capability = requiredString(input.capability, 'capability', 'invalid_grant')
  getCapabilityDefinition(capability)
  const resource = requiredString(input.resource, 'resource', 'invalid_grant')
  const lifetime = normalizeLifetime(input.lifetime, 'invalid_grant')
  const source = requiredString(input.source, 'source', 'invalid_grant')
  const grantedBy = requiredString(input.grantedBy, 'grantedBy', 'invalid_grant')
  const expiresAt = normalizeExpiresAt(input.expiresAt, lifetime, 'invalid_grant')
  return Object.freeze({ capability, resource, lifetime, source, grantedBy, expiresAt })
}

// A trailing-`*` grant prefix must end in a real segment delimiter (`:` or
// `/`) — every resource string this codebase actually constructs already
// does (`execution:*`, `workspace:/docs/*`, `github:repository:<owner>/<repo>
// :contents:*`, `google:drive:files:*`). Demonstrated exploit without this
// check: resourceMatches('github:repo:owner/repo*', 'github:repo:owner/
// repo-evil:contents:x') returned true, because a bare startsWith has no
// concept of a segment boundary — 'repo' is a string-prefix of 'repo-evil'
// with nothing stopping the match. No grant PR #7 itself ships is affected
// (they all happen to end in a delimiter), but the primitive should be safe
// by construction, not just safe by every current caller's convention.
const WILDCARD_PREFIX_BOUNDARY_RE = /[:/]$/

export function resourceMatches(grantResource, requestedResource) {
  if (grantResource === requestedResource) return true
  if (typeof grantResource !== 'string' || !grantResource.endsWith('*')) return false
  const prefix = grantResource.slice(0, -1)
  if (!WILDCARD_PREFIX_BOUNDARY_RE.test(prefix)) return false
  return requestedResource.startsWith(prefix)
}

export function grantIsExpired(grant, now = new Date()) {
  if (!grant?.expiresAt) return false
  const current = now instanceof Date ? now : new Date(now)
  return new Date(grant.expiresAt).getTime() <= current.getTime()
}
