import { randomUUID } from 'node:crypto'

import {
  createActorContext,
  createCapabilitySession,
  createGrant,
} from '../../src/capabilities/index.js'
import { resolveDelegatedOperation } from './delegated-contracts.js'

const GITHUB_API = 'https://api.github.com'
const READ_CAPABILITY = 'connector.github.repository.contents.read'
const MAX_TEXT_FILE_BYTES = 1024 * 1024
const REFRESH_SKEW_MS = 30 * 1000
const NAME_RE = /^[A-Za-z0-9_.-]+$/

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('github_clock_error', 'GitHub connector clock returned an invalid date')
  return date
}

function normalizeRepository(value) {
  if (typeof value !== 'string') throw codedError('github_invalid_repository', 'repository must be owner/repo')
  const text = value.trim()
  const parts = text.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1] || !NAME_RE.test(parts[0]) || !NAME_RE.test(parts[1])) {
    throw codedError('github_invalid_repository', 'repository must be a valid owner/repo identifier')
  }
  return `${parts[0]}/${parts[1]}`
}

function normalizePath(value) {
  if (typeof value !== 'string') throw codedError('github_invalid_path', 'path must be a non-empty repository-relative path')
  const text = value.trim()
  if (!text || text.startsWith('/') || text.includes('\0')) {
    throw codedError('github_invalid_path', 'path must be a non-empty repository-relative path')
  }
  const segments = text.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw codedError('github_invalid_path', 'path contains an invalid segment')
  }
  return segments.join('/')
}

function normalizeRef(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw codedError('github_invalid_ref', 'ref must be a non-empty string')
  }
  return value.trim()
}

function repositoryGrantResource(repository) {
  return `github:repository:${repository}:contents:*`
}

function repositoryFileResource(repository, path) {
  return `github:repository:${repository}:contents:${path}`
}

function repositoryFromGrant(grant) {
  const prefix = 'github:repository:'
  const suffix = ':contents:*'
  if (!grant.resource.startsWith(prefix) || !grant.resource.endsWith(suffix)) return null
  return grant.resource.slice(prefix.length, -suffix.length)
}

function encodeRepositoryPath(path) {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function publicGrant(grant) {
  return Object.freeze({
    capability: grant.capability,
    repository: repositoryFromGrant(grant),
    lifetime: grant.lifetime,
    source: grant.source,
    granted_by: grant.grantedBy,
  })
}

function defaultEventIdFactory() {
  return randomUUID()
}

async function readResponseJson(response) {
  try { return await response.json() }
  catch { throw codedError('github_api_error', `GitHub API returned invalid JSON (HTTP ${response?.status ?? 'unknown'})`) }
}

export function createGitHubConnectorService({
  broker,
  delegationBroker = null,
  oauth,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  eventIdFactory = defaultEventIdFactory,
} = {}) {
  if (!broker || typeof broker.store !== 'function' || typeof broker.describe !== 'function' || typeof broker.withCredential !== 'function') {
    throw new TypeError('credential broker is required')
  }
  if (delegationBroker != null && typeof delegationBroker.issue !== 'function') {
    throw new TypeError('delegation broker must expose issue()')
  }
  if (!oauth || typeof oauth.configured !== 'function' || typeof oauth.start !== 'function' || typeof oauth.complete !== 'function') {
    throw new TypeError('GitHub OAuth client is required')
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof eventIdFactory !== 'function') throw new TypeError('eventIdFactory must be a function')

  let credentialId = null
  let actor = null
  let grants = []

  function requireConnected() {
    if (!credentialId || !actor) throw codedError('github_not_connected', 'GitHub is not connected')
  }

  function getStatus() {
    const configured = Boolean(oauth.configured())
    if (!credentialId || !actor) {
      return Object.freeze({
        configured,
        connected: false,
        credential_id: null,
        account: null,
        expires_at: null,
        grants: Object.freeze([]),
      })
    }

    let description
    try { description = broker.describe(credentialId) }
    catch (error) {
      if (error?.code !== 'credential_not_found') throw error
      credentialId = null
      actor = null
      grants = []
      return Object.freeze({
        configured,
        connected: false,
        credential_id: null,
        account: null,
        expires_at: null,
        grants: Object.freeze([]),
      })
    }

    return Object.freeze({
      configured,
      connected: true,
      credential_id: credentialId,
      account: description.account,
      expires_at: description.expires_at,
      grants: Object.freeze(grants.map(publicGrant)),
    })
  }

  function startAuth({ redirectUri } = {}) {
    return oauth.start({ redirectUri })
  }

  async function completeAuth({ code, state } = {}) {
    const completed = await oauth.complete({ code, state, broker })
    if (credentialId && credentialId !== completed.credentialId) broker.remove(credentialId)
    credentialId = completed.credentialId
    actor = createActorContext({
      humanPrincipal: `github:user:${completed.account.id}`,
      client: 'eveglyph-editor',
      session: `github:${completed.credentialId}`,
    })
    grants = []
    return getStatus()
  }

  function restoreAuth({ credentialId: restoredCredentialId } = {}) {
    const description = broker.describe(restoredCredentialId)
    if (description.provider !== 'github') {
      throw codedError('credential_provider_mismatch', 'restored credential provider is not GitHub')
    }
    const accountId = Number(description.account?.id)
    const login = typeof description.account?.login === 'string' ? description.account.login.trim() : ''
    if (!Number.isFinite(accountId) || !login) {
      throw codedError('github_identity_failed', 'restored GitHub account metadata is incomplete')
    }
    credentialId = description.credential_id
    actor = createActorContext({
      humanPrincipal: `github:user:${accountId}`,
      client: 'eveglyph-editor',
      session: `github:${credentialId}`,
    })
    grants = []
    return getStatus()
  }

  function disconnect() {
    if (!credentialId) {
      actor = null
      grants = []
      return false
    }
    const removed = broker.remove(credentialId)
    credentialId = null
    actor = null
    grants = []
    return removed
  }

  function grantRepositoryRead({ repository } = {}) {
    requireConnected()
    const normalized = normalizeRepository(repository)
    const existing = grants.find(grant =>
      grant.capability === READ_CAPABILITY && grant.resource === repositoryGrantResource(normalized))
    if (existing) return publicGrant(existing)

    const grant = createGrant({
      capability: READ_CAPABILITY,
      resource: repositoryGrantResource(normalized),
      lifetime: 'session',
      source: 'user-explicit-session',
      grantedBy: actor.humanPrincipal,
    })
    grants.push(grant)
    return publicGrant(grant)
  }

  function issueRepositoryFileDelegation({ repository, path, ref = null } = {}) {
    requireConnected()
    if (!delegationBroker) throw codedError('delegation_unavailable', 'connector delegation runtime is unavailable')
    const operation = resolveDelegatedOperation('github_read_file_delegated', { repository, path, ref })
    const session = createCapabilitySession({
      profile: 'connector-session',
      actor,
      grants,
      now,
      idFactory: eventIdFactory,
    })
    session.require({
      capability: operation.capability,
      resource: operation.resource,
      lifetime: 'once',
      reason: 'Issue MCP delegated GitHub repository file read',
      context: Object.freeze({
        provider: operation.provider,
        operation: operation.operation,
        repository: operation.input.repository,
        path: operation.input.path,
        ref: operation.input.ref ?? null,
      }),
    })
    return delegationBroker.issue({
      provider: operation.provider,
      operation: operation.operation,
      capability: operation.capability,
      resource: operation.resource,
      actor: actor.humanPrincipal,
      ttlMs: 60 * 1000,
      maxUses: 1,
    })
  }

  function needsRefresh(description) {
    if (!description.expires_at) return false
    const expires = new Date(description.expires_at)
    if (Number.isNaN(expires.getTime())) return true
    return expires.getTime() - asDate(now()).getTime() <= REFRESH_SKEW_MS
  }

  async function ensureFreshCredential() {
    requireConnected()
    const description = broker.describe(credentialId)
    if (needsRefresh(description)) {
      if (typeof oauth.refreshCredential !== 'function') {
        throw codedError('github_reauthentication_required', 'GitHub connection must be authenticated again')
      }
      await oauth.refreshCredential({ credentialId, broker })
    }
  }

  async function fetchRepositoryFile({ repository, path, ref, decision }) {
    await ensureFreshCredential()
    const url = new URL(`${GITHUB_API}/repos/${repository}/contents/${encodeRepositoryPath(path)}`)
    if (ref) url.searchParams.set('ref', ref)

    let response
    try {
      response = await broker.withCredential(credentialId, credential => fetchImpl(url.toString(), {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${credential.accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'EveGlyph-Editor',
        },
      }))
    } catch (error) {
      if (error?.code === 'credential_not_found') throw codedError('github_not_connected', 'GitHub is not connected')
      throw codedError('github_api_error', 'GitHub repository read failed before a valid response was received')
    }

    if (!response?.ok) throw codedError('github_api_error', `GitHub repository read failed (HTTP ${response?.status ?? 'unknown'})`)
    const data = await readResponseJson(response)
    if (Array.isArray(data) || !data || data.type !== 'file') {
      throw codedError('github_resource_not_file', 'GitHub resource is not a regular file')
    }
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw codedError('github_file_encoding_unsupported', 'GitHub file content is not available as inline base64')
    }
    if (Number.isFinite(Number(data.size)) && Number(data.size) > MAX_TEXT_FILE_BYTES) {
      throw codedError('github_file_too_large', 'GitHub file exceeds the 1 MiB connector limit')
    }

    let bytes
    try { bytes = Buffer.from(data.content.replace(/\s+/g, ''), 'base64') }
    catch { throw codedError('github_file_encoding_unsupported', 'GitHub file base64 content is invalid') }
    if (bytes.length > MAX_TEXT_FILE_BYTES) throw codedError('github_file_too_large', 'GitHub file exceeds the 1 MiB connector limit')

    let content
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw codedError('github_file_encoding_unsupported', 'GitHub file is not valid UTF-8 text') }

    return Object.freeze({
      repository,
      path: typeof data.path === 'string' && data.path ? data.path : path,
      ref,
      sha: typeof data.sha === 'string' ? data.sha : null,
      size: bytes.length,
      encoding: 'utf-8',
      content,
      capability_evidence: decision,
    })
  }

  async function readRepositoryFile({ repository, path, ref = null } = {}) {
    requireConnected()
    const normalizedRepository = normalizeRepository(repository)
    const normalizedPath = normalizePath(path)
    const normalizedRef = normalizeRef(ref)

    const session = createCapabilitySession({
      profile: 'connector-session',
      actor,
      grants,
      now,
      idFactory: eventIdFactory,
    })
    const decision = session.require({
      capability: READ_CAPABILITY,
      resource: repositoryFileResource(normalizedRepository, normalizedPath),
      lifetime: 'once',
      reason: 'Read GitHub repository file',
      context: Object.freeze({
        provider: 'github',
        repository: normalizedRepository,
        path: normalizedPath,
        ref: normalizedRef,
      }),
    })

    return fetchRepositoryFile({
      repository: normalizedRepository,
      path: normalizedPath,
      ref: normalizedRef,
      decision,
    })
  }

  return Object.freeze({
    getStatus,
    startAuth,
    completeAuth,
    restoreAuth,
    disconnect,
    grantRepositoryRead,
    issueRepositoryFileDelegation,
    readRepositoryFile,
  })
}

export {
  MAX_TEXT_FILE_BYTES,
  normalizeRepository,
  normalizePath,
  repositoryGrantResource,
  repositoryFileResource,
}
