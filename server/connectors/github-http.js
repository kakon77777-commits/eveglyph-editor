const ERROR_STATUS = Object.freeze({
  github_not_configured: 503,
  credential_vault_unavailable: 503,
  delegation_unavailable: 503,
  github_invalid_oauth_state: 400,
  github_oauth_state_expired: 400,
  github_oauth_exchange_failed: 502,
  github_identity_failed: 502,
  github_not_connected: 401,
  github_reauthentication_required: 401,
  github_invalid_redirect_uri: 400,
  github_invalid_repository: 400,
  github_invalid_path: 400,
  github_invalid_ref: 400,
  capability_denied: 403,
  github_api_error: 502,
  github_resource_not_file: 422,
  github_file_too_large: 413,
  github_file_encoding_unsupported: 422,
})

const PUBLIC_MESSAGES = Object.freeze({
  github_not_configured: 'GitHub App OAuth is not configured on this EveGlyph server.',
  credential_vault_unavailable: 'Credential vault is unavailable. Unlock or restore the system credential store and try again.',
  delegation_unavailable: 'Connector delegation runtime is unavailable.',
  github_invalid_oauth_state: 'GitHub OAuth state is invalid or was already used.',
  github_oauth_state_expired: 'GitHub OAuth state expired. Start authentication again.',
  github_oauth_exchange_failed: 'GitHub OAuth token exchange failed.',
  github_identity_failed: 'GitHub identity lookup failed.',
  github_not_connected: 'GitHub is not connected.',
  github_reauthentication_required: 'GitHub must be authenticated again.',
  github_invalid_redirect_uri: 'GitHub OAuth redirect URI is invalid.',
  github_invalid_repository: 'GitHub repository must be a valid owner/repo identifier.',
  github_invalid_path: 'GitHub path is invalid.',
  github_invalid_ref: 'GitHub ref is invalid.',
  capability_denied: 'The requested GitHub repository capability is not granted.',
  github_api_error: 'GitHub API request failed.',
  github_resource_not_file: 'The requested GitHub resource is not a regular file.',
  github_file_too_large: 'The requested GitHub file exceeds the connector size limit.',
  github_file_encoding_unsupported: 'The requested GitHub file is not supported as UTF-8 text.',
  internal_error: 'Internal GitHub connector error.',
})

function errorCode(error) {
  const code = typeof error?.code === 'string' && error.code in PUBLIC_MESSAGES
    ? error.code
    : 'internal_error'
  return code
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
  const title = ok ? 'GitHub connected' : 'GitHub connection failed'
  const message = ok
    ? 'GitHub connected. You can close this window and return to EveGlyph.'
    : `${PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.internal_error} (${code || 'internal_error'})`
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n<main>\n<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(message)}</p>\n</main>\n</body>\n</html>`
}

export function createGitHubConnectorHttpController({ service } = {}) {
  if (!service || typeof service !== 'object') throw new TypeError('GitHub connector service is required')

  function status() {
    try {
      return Object.freeze({ status: 200, body: service.getStatus() })
    } catch (error) {
      return publicError(error)
    }
  }

  function startAuth({ redirectUri } = {}) {
    try {
      const started = service.startAuth({ redirectUri })
      return Object.freeze({
        status: 200,
        body: Object.freeze({ authorize_url: started.authorizeUrl }),
      })
    } catch (error) {
      return publicError(error)
    }
  }

  async function callback({ code, state } = {}) {
    try {
      await service.completeAuth({ code, state })
      return Object.freeze({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: callbackHtml({ ok: true }),
      })
    } catch (error) {
      const codeValue = errorCode(error)
      return Object.freeze({
        status: ERROR_STATUS[codeValue] || 500,
        contentType: 'text/html; charset=utf-8',
        body: callbackHtml({ ok: false, code: codeValue }),
      })
    }
  }

  function disconnect() {
    try {
      const disconnected = service.disconnect()
      return Object.freeze({ status: 200, body: Object.freeze({ disconnected: Boolean(disconnected) }) })
    } catch (error) {
      return publicError(error)
    }
  }

  function grantRead({ repository } = {}) {
    try {
      return Object.freeze({ status: 200, body: service.grantRepositoryRead({ repository }) })
    } catch (error) {
      return publicError(error)
    }
  }

  function issueDelegatedRead({ repository, path, ref } = {}) {
    try {
      return Object.freeze({
        status: 200,
        body: service.issueRepositoryFileDelegation({ repository, path, ref }),
      })
    } catch (error) {
      return publicError(error)
    }
  }

  async function readFile({ repository, path, ref } = {}) {
    try {
      const result = await service.readRepositoryFile({ repository, path, ref })
      return Object.freeze({ status: 200, body: result })
    } catch (error) {
      return publicError(error)
    }
  }

  return Object.freeze({
    status,
    startAuth,
    callback,
    disconnect,
    grantRead,
    issueDelegatedRead,
    readFile,
  })
}

export { PUBLIC_MESSAGES, ERROR_STATUS }
