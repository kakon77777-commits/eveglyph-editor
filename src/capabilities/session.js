import { getSandboxProfile } from './profiles.js'
import {
  createActorContext,
  createCapabilityRequest,
  createGrant,
  grantIsExpired,
  resourceMatches,
} from './model.js'

let fallbackEventCounter = 0

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackEventCounter += 1
  return `cap-${Date.now().toString(36)}-${fallbackEventCounter.toString(36)}`
}

function defaultNow() {
  return new Date()
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('capability session clock returned an invalid date')
  return date
}

function freezeDecision({ eventId, timestamp, actor, profile, request, decision, reason, grantSource }) {
  return Object.freeze({
    eventId,
    timestamp,
    actor,
    profile,
    request,
    decision,
    reason,
    grantSource,
  })
}

export class CapabilityDeniedError extends Error {
  constructor(decision) {
    super(`capability denied: ${decision.request.capability} on ${decision.request.resource}`)
    this.name = 'CapabilityDeniedError'
    this.code = 'capability_denied'
    this.decision = decision
  }
}

export function createCapabilitySession({
  profile = 'document-only',
  actor,
  grants = [],
  now = defaultNow,
  idFactory = defaultIdFactory,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function')

  const sandboxProfile = getSandboxProfile(profile)
  const normalizedActor = createActorContext(actor || {})
  const ledger = []

  const grantStates = [
    ...sandboxProfile.grants.map(grant => ({
      grant: Object.freeze({
        capability: grant.capability,
        resource: grant.resource,
        lifetime: 'session',
        source: `profile:${sandboxProfile.name}`,
        grantedBy: `profile:${sandboxProfile.name}`,
        expiresAt: null,
      }),
      consumed: false,
      profileGrant: true,
    })),
    ...grants.map(input => ({ grant: createGrant(input), consumed: false, profileGrant: false })),
  ]

  function appendDecision(request, decision, reason, grantSource = null) {
    const timestamp = asDate(now()).toISOString()
    const eventId = String(idFactory())
    const record = freezeDecision({
      eventId,
      timestamp,
      actor: normalizedActor,
      profile: sandboxProfile.name,
      request,
      decision,
      reason,
      grantSource,
    })
    ledger.push(record)
    return record
  }

  function findGrant(request) {
    const current = asDate(now())
    return grantStates.find(state => {
      if (state.consumed) return false
      const grant = state.grant
      if (grant.capability !== request.capability) return false
      if (grantIsExpired(grant, current)) return false
      return resourceMatches(grant.resource, request.resource)
    }) || null
  }

  function authorize(requestInput) {
    const request = createCapabilityRequest(requestInput)
    const matched = findGrant(request)
    if (!matched) return appendDecision(request, 'deny', 'no_matching_grant')

    const decision = appendDecision(request, 'allow', 'matched_grant', matched.grant.source)
    if (!matched.profileGrant && matched.grant.lifetime === 'once') matched.consumed = true
    return decision
  }

  function requireCapability(requestInput) {
    const decision = authorize(requestInput)
    if (decision.decision !== 'allow') throw new CapabilityDeniedError(decision)
    return decision
  }

  function getAuditLedger() {
    return Object.freeze([...ledger])
  }

  function snapshot() {
    return Object.freeze({
      profile: sandboxProfile.name,
      actor: normalizedActor,
      audit: getAuditLedger(),
    })
  }

  return Object.freeze({
    authorize,
    require: requireCapability,
    getAuditLedger,
    snapshot,
  })
}
