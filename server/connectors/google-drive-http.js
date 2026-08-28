const ERROR_STATUS = Object.freeze({
  google_not_configured: 503,
  credential_vault_unavailable: 503,
  delegation_unavailable: 503,
  google_invalid_oauth_state: 400,
  google_oauth_state_expired: 400,
  google_oauth_exchange_failed: 502,
  google_required_scope_missing: 403,
  google_identity_failed: 502,
  google_invalid_redirect_uri: 400,
  google_drive_not_connected: 401,
  google_reauthentication_required: 401,
  google_drive_invalid_page_token: 400,
  google_drive_invalid_file_id: 400,
  capability_denied: 403,
  google_drive_api_error: 502,
  google_drive_file_too_large: 413,
  google_drive_file_encoding_unsupported: 422,
  google_drive_export_unsupported: 422,
})

const PUBLIC_MESSAGES = Object.freeze({
  google_not_configured: 'Google OAuth is not configured on this EveGlyph server.',
  credential_vault_unavailable: 'Credential vault is unavailable. Unlock or restore the system credential store and try again.',
  delegation_unavailable: 'Connector delegation runtime is unavailable.',
  google_invalid_oauth_state: 'Google OAuth state is invalid or was already used.',
  google_oauth_state_expired: 'Google OAuth state expired. Start authentication again.',
  google_oauth_exchange_failed: 'Google OAuth token exchange failed.',
  google_required_scope_missing: 'Google did not grant the required Drive read-only scope.',
  google_identity_failed: 'Google identity lookup failed.',
  google_invalid_redirect_uri: 'Google OAuth redirect URI is invalid.',
  google_drive_not_connected: 'Google Drive is not connected.',
  google_reauthentication_required: 'Google must be authenticated again.',
  google_drive_invalid_page_token: 'Google Drive page token is invalid.',
  google_drive_invalid_file_id: 'Google Drive file id is invalid.',
  capability_denied: 'The requested Google Drive capability is not granted.',
  google_drive_api_error: 'Google Drive API request failed.',
  google_drive_file_too_large: 'The requested Google Drive file exceeds the connector size limit.',
  google_drive_file_encoding_unsupported: 'The requested Google Drive file is not supported as UTF-8 text.',
  google_drive_export_unsupported: 'This Google Workspace file type is not supported by the read-only connector.',
  internal_error: 'Internal Google Drive connector error.',
})

function errorCode(error) {
  return typeof error?.code === 'string' && error.code in PUBLIC_MESSAGES
    ? error.code
    : 'internal_error'
}

function publicError(error) {
  const code = errorCode(error)
  return Object.freeze({
    status: ERROR_STATUS[code] || 500,
    body: Object.freeze({ error: Object.freeze({ code, message: PUBLIC_MESSAGES[code] }) }),
  })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function callbackHtml({ ok, code = null }) {
  const title = ok ? 'Google Drive connected' : 'Google Drive connection failed'
  const message = ok
    ? 'Google Drive connected. You can close this window and return to EveGlyph.'
    : `${PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.internal_error} (${code || 'internal_error'})`
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n<main>\n<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(message)}</p>\n</main>\n</body>\n</html>`
}

export function createGoogleDriveConnectorHttpController({ service } = {}) {
  if (!service || typeof service !== 'object') throw new TypeError('Google Drive connector service is required')

  function status() {
    try { return Object.freeze({ status: 200, body: service.getStatus() }) }
    catch (error) { return publicError(error) }
  }

  function startAuth({ redirectUri } = {}) {
    try {
      const started = service.startAuth({ redirectUri })
      return Object.freeze({ status: 200, body: Object.freeze({ authorize_url: started.authorizeUrl }) })
    } catch (error) { return publicError(error) }
  }

  async function callback({ code, state } = {}) {
    try {
      await service.completeAuth({ code, state })
      return Object.freeze({ status: 200, contentType: 'text/html; charset=utf-8', body: callbackHtml({ ok: true }) })
    } catch (error) {
      const codeValue = errorCode(error)
      return Object.freeze({ status: ERROR_STATUS[codeValue] || 500, contentType: 'text/html; charset=utf-8', body: callbackHtml({ ok: false, code: codeValue }) })
    }
  }

  function disconnect() {
    try {
      const disconnected = service.disconnect()
      return Object.freeze({ status: 200, body: Object.freeze({ disconnected: Boolean(disconnected) }) })
    } catch (error) { return publicError(error) }
  }

  function grantMetadata() {
    try { return Object.freeze({ status: 200, body: service.grantMetadataList() }) }
    catch (error) { return publicError(error) }
  }

  function issueDelegatedList({ pageToken = null } = {}) {
    try { return Object.freeze({ status: 200, body: service.issueMetadataListDelegation({ pageToken }) }) }
    catch (error) { return publicError(error) }
  }

  async function listFiles({ pageToken = null } = {}) {
    try { return Object.freeze({ status: 200, body: await service.listDriveFiles({ pageToken }) }) }
    catch (error) { return publicError(error) }
  }

  function grantFileRead({ fileId } = {}) {
    try { return Object.freeze({ status: 200, body: service.grantFileRead({ fileId }) }) }
    catch (error) { return publicError(error) }
  }

  function issueDelegatedFileRead({ fileId } = {}) {
    try { return Object.freeze({ status: 200, body: service.issueFileReadDelegation({ fileId }) }) }
    catch (error) { return publicError(error) }
  }

  async function readFile({ fileId } = {}) {
    try { return Object.freeze({ status: 200, body: await service.readDriveFile({ fileId }) }) }
    catch (error) { return publicError(error) }
  }

  return Object.freeze({
    status,
    startAuth,
    callback,
    disconnect,
    grantMetadata,
    issueDelegatedList,
    listFiles,
    grantFileRead,
    issueDelegatedFileRead,
    readFile,
  })
}

export { PUBLIC_MESSAGES, ERROR_STATUS }
