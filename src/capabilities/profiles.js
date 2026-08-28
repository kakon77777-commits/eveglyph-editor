import { getCapabilityDefinition } from './registry.js'

const DOCUMENT_ONLY_GRANTS = [
  Object.freeze({ capability: 'document.read.self', resource: 'document:self' }),
  Object.freeze({ capability: 'document.compute', resource: 'document:self' }),
  Object.freeze({ capability: 'ephemeral.output', resource: 'execution:*' }),
]

for (const grant of DOCUMENT_ONLY_GRANTS) getCapabilityDefinition(grant.capability)

const PROFILES = Object.freeze({
  'document-only': Object.freeze({
    name: 'document-only',
    grants: Object.freeze(DOCUMENT_ONLY_GRANTS),
  }),
  // Connector sessions start with no ambient authority. External-service
  // capabilities are acquired only through explicit grants (for example, a
  // user-approved GitHub repository read grant) so OAuth identity never
  // becomes implicit resource authorization.
  'connector-session': Object.freeze({
    name: 'connector-session',
    grants: Object.freeze([]),
  }),
})

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function getSandboxProfile(name = 'document-only') {
  const key = typeof name === 'string' ? name.trim() : ''
  const profile = PROFILES[key]
  if (!profile) throw codedError('unknown_profile', `unknown sandbox profile: ${key || String(name)}`)
  return profile
}

export function listSandboxProfiles() {
  return Object.freeze(Object.values(PROFILES))
}
