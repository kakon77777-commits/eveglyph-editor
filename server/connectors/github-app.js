import { createHash, randomBytes, randomUUID } from 'node:crypto'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field, code) {
  if (typeof value !== 'string' || !value.trim()) throw codedError(code, `${field} must be a non-empty string`)
  return value.trim()
}

function asDate(value, code = 'github_oauth_clock_error') {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError(code, 'OAuth clock returned an invalid date')
  return date
}

function addSeconds(now, seconds) {
  if (seconds == null || seconds === '') return null
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return null
  return new Date(now.getTime() + value * 1000).toISOString()
}

function normalizeAccount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('github_identity_failed', 'GitHub identity response was invalid')
  }
  const id = Number(value.id)
  const login = typeof value.login === 'string' ? value.login.trim() : ''
  if (!Number.isFinite(id) || !login) throw codedError('github_identity_failed', 'GitHub identity response was incomplete')
  return Object.freeze({
    id,
    login,
    avatar_url: typeof value.avatar_url === 'string' ? value.avatar_url : null,
    html_url: typeof value.html_url === 'string' ? value.html_url : null,
  })
}

function defaultVerifierFactory() {
  return randomBytes(32).toString('base64url')
}

function defaultStateIdFactory() {
  return randomUUID()
}

async function readJsonResponse(response, code, message) {
  if (!response?.ok) throw codedError(code, `${message} (HTTP ${response?.status ?? 'unknown'})`)
  let data
  try { data = await response.json() }
  catch { throw codedError(code, `${message}: invalid JSON response`) }
  return data
}

export function createGitHubAppOAuth({
  clientId = '',
  clientSecret = '',
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  stateIdFactory = defaultStateIdFactory,
  verifierFactory = defaultVerifierFactory,
  stateTtlMs = 10 * 60 * 1000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof stateIdFactory !== 'function') throw new TypeError('stateIdFactory must be a function')
  if (typeof verifierFactory !== 'function') throw new TypeError('verifierFactory must be a function')
  if (!Number.isFinite(stateTtlMs) || stateTtlMs <= 0) throw new TypeError('stateTtlMs must be positive')

  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : ''
  const normalizedClientSecret = typeof clientSecret === 'string' ? clientSecret.trim() : ''
  const pending = new Map()

  function configured() {
    return Boolean(normalizedClientId && normalizedClientSecret)
  }

  function assertConfigured() {
    if (!configured()) throw codedError('github_not_configured', 'GitHub App OAuth is not configured on this server')
  }

  function start({ redirectUri } = {}) {
    assertConfigured()
    const uri = requiredString(redirectUri, 'redirectUri', 'github_invalid_redirect_uri')
    let parsed
    try { parsed = new URL(uri) }
    catch { throw codedError('github_invalid_redirect_uri', 'redirectUri must be an absolute URL') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw codedError('github_invalid_redirect_uri', 'redirectUri must use http or https')

    const state = requiredString(String(stateIdFactory()), 'state', 'github_invalid_oauth_state')
    const verifier = requiredString(String(verifierFactory()), 'PKCE verifier', 'github_invalid_oauth_state')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const created = asDate(now())
    const expires = new Date(created.getTime() + stateTtlMs)

    pending.set(state, Object.freeze({
      verifier,
      redirectUri: parsed.toString(),
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
    }))

    const authorize = new URL(AUTHORIZE_URL)
    authorize.searchParams.set('client_id', normalizedClientId)
    authorize.searchParams.set('redirect_uri', parsed.toString())
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')

    return Object.freeze({
      authorizeUrl: authorize.toString(),
      state,
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
    })
  }

  async function exchangeCode({ code, verifier, redirectUri }) {
    const body = new URLSearchParams()
    body.set('client_id', normalizedClientId)
    body.set('client_secret', normalizedClientSecret)
    body.set('code', requiredString(code, 'code', 'github_oauth_exchange_failed'))
    body.set('redirect_uri', redirectUri)
    body.set('code_verifier', verifier)

    let response
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
    } catch {
      throw codedError('github_oauth_exchange_failed', 'GitHub OAuth token exchange failed')
    }
    const data = await readJsonResponse(response, 'github_oauth_exchange_failed', 'GitHub OAuth token exchange failed')
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw codedError('github_oauth_exchange_failed', 'GitHub OAuth token exchange returned no access token')
    }
    return data
  }

  async function fetchIdentity(accessToken) {
    let response
    try {
      response = await fetchImpl(USER_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'EveGlyph-Editor',
        },
      })
    } catch {
      throw codedError('github_identity_failed', 'GitHub authenticated-user request failed')
    }
    const data = await readJsonResponse(response, 'github_identity_failed', 'GitHub authenticated-user request failed')
    return normalizeAccount(data)
  }

  async function complete({ code, state, broker } = {}) {
    assertConfigured()
    if (!broker || typeof broker.store !== 'function') throw new TypeError('broker is required')
    const stateKey = typeof state === 'string' ? state.trim() : ''
    const record = pending.get(stateKey)
    if (!record) throw codedError('github_invalid_oauth_state', 'GitHub OAuth state is invalid or already used')

    // Consume before any network operation so a failed exchange cannot make the
    // same callback replayable.
    pending.delete(stateKey)
    const current = asDate(now())
    if (current.getTime() >= new Date(record.expiresAt).getTime()) {
      throw codedError('github_oauth_state_expired', 'GitHub OAuth state expired; start authentication again')
    }

    const token = await exchangeCode({ code, verifier: record.verifier, redirectUri: record.redirectUri })
    const account = await fetchIdentity(token.access_token)
    const tokenNow = asDate(now())
    const credentialId = broker.store({
      provider: 'github',
      account,
      accessToken: token.access_token,
      accessExpiresAt: addSeconds(tokenNow, token.expires_in),
      refreshToken: typeof token.refresh_token === 'string' && token.refresh_token ? token.refresh_token : null,
      refreshExpiresAt: addSeconds(tokenNow, token.refresh_token_expires_in),
    })
    return Object.freeze({ credentialId, account })
  }

  async function refreshCredential({ credentialId, broker } = {}) {
    assertConfigured()
    if (!broker || typeof broker.withCredential !== 'function' || typeof broker.replaceSecrets !== 'function') {
      throw new TypeError('broker is required')
    }

    const snapshot = await broker.withCredential(credentialId, credential => ({
      refreshToken: credential.refreshToken,
      refreshExpiresAt: credential.refreshExpiresAt,
    }))
    const current = asDate(now())
    if (!snapshot.refreshToken) {
      throw codedError('github_reauthentication_required', 'GitHub connection must be authenticated again')
    }
    if (snapshot.refreshExpiresAt && current.getTime() >= new Date(snapshot.refreshExpiresAt).getTime()) {
      throw codedError('github_reauthentication_required', 'GitHub refresh credential expired; authenticate again')
    }

    const body = new URLSearchParams()
    body.set('client_id', normalizedClientId)
    body.set('client_secret', normalizedClientSecret)
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', snapshot.refreshToken)

    let response
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
    } catch {
      throw codedError('github_reauthentication_required', 'GitHub token refresh failed; authenticate again')
    }

    let data
    try { data = await readJsonResponse(response, 'github_reauthentication_required', 'GitHub token refresh failed; authenticate again') }
    catch (error) {
      if (error?.code === 'github_reauthentication_required') throw error
      throw codedError('github_reauthentication_required', 'GitHub token refresh failed; authenticate again')
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw codedError('github_reauthentication_required', 'GitHub token refresh returned no access token; authenticate again')
    }

    const updatedAt = asDate(now())
    return broker.replaceSecrets(credentialId, {
      accessToken: data.access_token,
      accessExpiresAt: addSeconds(updatedAt, data.expires_in),
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : snapshot.refreshToken,
      refreshExpiresAt: data.refresh_token_expires_in != null
        ? addSeconds(updatedAt, data.refresh_token_expires_in)
        : snapshot.refreshExpiresAt,
    })
  }

  return Object.freeze({
    configured,
    start,
    complete,
    refreshCredential,
  })
}
