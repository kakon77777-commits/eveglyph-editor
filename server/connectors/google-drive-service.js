import { randomUUID } from 'node:crypto'

import {
  createActorContext,
  createCapabilitySession,
  createGrant,
} from '../../src/capabilities/index.js'

const GOOGLE_API = 'https://www.googleapis.com'
const METADATA_CAPABILITY = 'connector.google.drive.metadata.list'
const READ_CAPABILITY = 'connector.google.drive.file.read'
const MAX_DRIVE_TEXT_BYTES = 1024 * 1024
const REFRESH_SKEW_MS = 30 * 1000
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/
const GOOGLE_WORKSPACE_PREFIX = 'application/vnd.google-apps.'
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const GOOGLE_DOC_EXPORT_MIME = 'text/markdown'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('google_drive_clock_error', 'Google Drive connector clock returned an invalid date')
  return date
}

function normalizeFileId(value) {
  if (typeof value !== 'string') throw codedError('google_drive_invalid_file_id', 'Google Drive file id must be a non-empty identifier')
  const id = value.trim()
  if (!FILE_ID_RE.test(id)) throw codedError('google_drive_invalid_file_id', 'Google Drive file id is invalid')
  return id
}

function metadataGrantResource() {
  return 'google:drive:files:*'
}

function metadataListResource() {
  return 'google:drive:files:list'
}

function fileResource(fileId) {
  return `google:drive:file:${fileId}`
}

function publicGrant(grant) {
  return Object.freeze({
    capability: grant.capability,
    resource: grant.resource,
    lifetime: grant.lifetime,
    source: grant.source,
    granted_by: grant.grantedBy,
  })
}

function publicFile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('google_drive_api_error', 'Google Drive file metadata was invalid')
  }
  const id = normalizeFileId(value.id)
  const name = typeof value.name === 'string' ? value.name : ''
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : ''
  if (!name || !mimeType) throw codedError('google_drive_api_error', 'Google Drive file metadata was incomplete')
  const numericSize = value.size == null || value.size === '' ? null : Number(value.size)
  return Object.freeze({
    id,
    name,
    mime_type: mimeType,
    size: Number.isFinite(numericSize) && numericSize >= 0 ? numericSize : null,
    modified_time: typeof value.modifiedTime === 'string' && value.modifiedTime ? value.modifiedTime : null,
    web_view_link: typeof value.webViewLink === 'string' && value.webViewLink ? value.webViewLink : null,
  })
}

function defaultEventIdFactory() {
  return randomUUID()
}

function responseContentLength(response) {
  const raw = response?.headers?.get?.('content-length')
  if (raw == null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

async function readJsonResponse(response, code = 'google_drive_api_error') {
  if (!response?.ok) throw codedError(code, `Google Drive API request failed (HTTP ${response?.status ?? 'unknown'})`)
  try { return await response.json() }
  catch { throw codedError(code, 'Google Drive API returned invalid JSON') }
}

async function readTextBytes(response) {
  if (!response?.ok) throw codedError('google_drive_api_error', `Google Drive content request failed (HTTP ${response?.status ?? 'unknown'})`)
  const announced = responseContentLength(response)
  if (announced != null && announced > MAX_DRIVE_TEXT_BYTES) {
    throw codedError('google_drive_file_too_large', 'Google Drive file exceeds the 1 MiB connector limit')
  }

  let buffer
  try { buffer = await response.arrayBuffer() }
  catch { throw codedError('google_drive_api_error', 'Google Drive content response could not be read') }
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength > MAX_DRIVE_TEXT_BYTES) {
    throw codedError('google_drive_file_too_large', 'Google Drive file exceeds the 1 MiB connector limit')
  }

  let content
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw codedError('google_drive_file_encoding_unsupported', 'Google Drive file is not valid UTF-8 text') }
  return Object.freeze({ content, size: bytes.byteLength })
}

export function createGoogleDriveConnectorService({
  broker,
  oauth,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  eventIdFactory = defaultEventIdFactory,
} = {}) {
  if (!broker || typeof broker.store !== 'function' || typeof broker.describe !== 'function' || typeof broker.withCredential !== 'function') {
    throw new TypeError('credential broker is required')
  }
  if (!oauth || typeof oauth.configured !== 'function' || typeof oauth.start !== 'function' || typeof oauth.complete !== 'function') {
    throw new TypeError('Google OAuth client is required')
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof eventIdFactory !== 'function') throw new TypeError('eventIdFactory must be a function')

  let credentialId = null
  let actor = null
  let grants = []

  function requireConnected() {
    if (!credentialId || !actor) throw codedError('google_drive_not_connected', 'Google Drive is not connected')
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
      humanPrincipal: `google:account:${completed.account.sub}`,
      client: 'eveglyph-editor',
      session: `google:${completed.credentialId}`,
    })
    // Provider authentication binds identity only. Drive authority starts empty.
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

  function grantMetadataList() {
    requireConnected()
    const resource = metadataGrantResource()
    const existing = grants.find(grant => grant.capability === METADATA_CAPABILITY && grant.resource === resource)
    if (existing) return publicGrant(existing)
    const grant = createGrant({
      capability: METADATA_CAPABILITY,
      resource,
      lifetime: 'session',
      source: 'user-explicit-session',
      grantedBy: actor.humanPrincipal,
    })
    grants.push(grant)
    return publicGrant(grant)
  }

  function grantFileRead({ fileId } = {}) {
    requireConnected()
    const normalized = normalizeFileId(fileId)
    const resource = fileResource(normalized)
    const existing = grants.find(grant => grant.capability === READ_CAPABILITY && grant.resource === resource)
    if (existing) return publicGrant(existing)
    const grant = createGrant({
      capability: READ_CAPABILITY,
      resource,
      lifetime: 'session',
      source: 'user-explicit-session',
      grantedBy: actor.humanPrincipal,
    })
    grants.push(grant)
    return publicGrant(grant)
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
        throw codedError('google_reauthentication_required', 'Google connection must be authenticated again')
      }
      await oauth.refreshCredential({ credentialId, broker })
    }
  }

  async function authenticatedFetch(url) {
    await ensureFreshCredential()
    try {
      return await broker.withCredential(credentialId, credential => fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential.accessToken}`,
          'User-Agent': 'EveGlyph-Editor',
        },
      }))
    } catch (error) {
      if (error?.code === 'credential_not_found') throw codedError('google_drive_not_connected', 'Google Drive is not connected')
      if (error?.code && String(error.code).startsWith('google_')) throw error
      throw codedError('google_drive_api_error', 'Google Drive request failed before a valid response was received')
    }
  }

  function capabilitySession() {
    return createCapabilitySession({
      profile: 'connector-session',
      actor,
      grants,
      now,
      idFactory: eventIdFactory,
    })
  }

  async function listDriveFiles({ pageToken = null } = {}) {
    requireConnected()
    const token = pageToken == null || pageToken === '' ? null : String(pageToken).trim()
    if (token != null && (!token || token.length > 2048 || token.includes('\0'))) {
      throw codedError('google_drive_invalid_page_token', 'Google Drive page token is invalid')
    }

    const decision = capabilitySession().require({
      capability: METADATA_CAPABILITY,
      resource: metadataListResource(),
      lifetime: 'once',
      reason: 'List Google Drive file metadata',
      context: Object.freeze({ provider: 'google', service: 'drive' }),
    })

    const url = new URL(`${GOOGLE_API}/drive/v3/files`)
    url.searchParams.set('q', 'trashed = false')
    url.searchParams.set('spaces', 'drive')
    url.searchParams.set('pageSize', '50')
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)')
    if (token) url.searchParams.set('pageToken', token)

    const response = await authenticatedFetch(url.toString())
    const data = await readJsonResponse(response)
    const files = Array.isArray(data.files) ? data.files.map(publicFile) : []
    return Object.freeze({
      files: Object.freeze(files),
      next_page_token: typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null,
      capability_evidence: decision,
    })
  }

  async function fetchFileMetadata(fileId) {
    const url = new URL(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,webViewLink')
    const response = await authenticatedFetch(url.toString())
    const data = await readJsonResponse(response)
    return publicFile(data)
  }

  async function fetchStoredFile(fileId) {
    const url = new URL(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('alt', 'media')
    return readTextBytes(await authenticatedFetch(url.toString()))
  }

  async function exportGoogleDoc(fileId) {
    const url = new URL(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}/export`)
    url.searchParams.set('mimeType', GOOGLE_DOC_EXPORT_MIME)
    return readTextBytes(await authenticatedFetch(url.toString()))
  }

  async function readDriveFile({ fileId } = {}) {
    requireConnected()
    const normalized = normalizeFileId(fileId)
    const decision = capabilitySession().require({
      capability: READ_CAPABILITY,
      resource: fileResource(normalized),
      lifetime: 'once',
      reason: 'Read Google Drive file',
      context: Object.freeze({ provider: 'google', service: 'drive', file_id: normalized }),
    })

    const file = await fetchFileMetadata(normalized)
    if (file.size != null && file.size > MAX_DRIVE_TEXT_BYTES) {
      throw codedError('google_drive_file_too_large', 'Google Drive file exceeds the 1 MiB connector limit')
    }

    let payload
    let exportMimeType = null
    if (file.mime_type === GOOGLE_DOC_MIME) {
      exportMimeType = GOOGLE_DOC_EXPORT_MIME
      payload = await exportGoogleDoc(normalized)
    } else if (file.mime_type.startsWith(GOOGLE_WORKSPACE_PREFIX)) {
      throw codedError('google_drive_export_unsupported', 'This Google Workspace file type is not supported by the read-only connector')
    } else {
      payload = await fetchStoredFile(normalized)
    }

    return Object.freeze({
      file,
      export_mime_type: exportMimeType,
      content: payload.content,
      encoding: 'utf-8',
      size: payload.size,
      capability_evidence: decision,
    })
  }

  return Object.freeze({
    getStatus,
    startAuth,
    completeAuth,
    disconnect,
    grantMetadataList,
    listDriveFiles,
    grantFileRead,
    readDriveFile,
  })
}

export {
  MAX_DRIVE_TEXT_BYTES,
  METADATA_CAPABILITY,
  READ_CAPABILITY,
  normalizeFileId,
  metadataGrantResource,
  fileResource,
}
