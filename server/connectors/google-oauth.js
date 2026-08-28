import { createHash, randomBytes, randomUUID } from 'node:crypto'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DEFAULT_SCOPES = Object.freeze(['openid', 'email', 'profile', DRIVE_READONLY_SCOPE])

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field, code) {
  if (typeof value !== 'string' || !value.trim()) throw codedError(code, `${field} must be a non-empty string`)
  return value.trim()
}

function asDate(value, code = 'google_oauth_clock_error') {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError(code, 'Google OAuth clock returned an invalid date')
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
    throw codedError('google_identity_failed', 'Google identity response was invalid')
  }
  const sub = typeof value.sub === 'string' ? value.sub.trim() : ''
  if (!sub) throw codedError('google_identity_failed', 'Google identity response did not include a stable subject id')
  return Object.freeze({
    sub,
    email: typeof value.email === 'string' && value.email.trim() ? value.email.trim() : null,
    email_verified: value.email_verified === true,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null,
    picture: typeof value.picture === 'string' && value.picture.trim() ? value.picture.trim() : null,
  })
}

function defaultVerifierFactory() {
  return randomBytes(48).toString('base64url')
}

function defaultStateIdFactory() {
  return randomUUID()
}

async function readJsonResponse(response, code, message) {
  if (!response?.ok) throw codedError(code, `${message} (HTTP ${response?.status ?? 'unknown'})`)
  try { return await response.json() }
  catch { throw codedError(code, `${message}: invalid JSON response`) }
}

function normalizeScopes(value) {
  if (typeof value !== 'string') return new Set()
  return new Set(value.split(/\s+/).map(scope => scope.trim()).filter(Boolean))
}

function requireDriveScope(value) {
  const granted = normalizeScopes(value)
  if (!granted.has(DRIVE_READONLY_SCOPE)) {
    throw codedError('google_required_scope_missing', 'Google Drive read-only scope was not granted')
  }
  return granted
}

export function createGoogleOAuth({
  clientId = '',
  clientSecret = '',
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  stateIdFactory = defaultStateIdFactory,
  verifierFactory = defaultVerifierFactory,
  stateTtlMs = 10 * 60 * 1000,
  scopes = DEFAULT_SCOPES,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof stateIdFactory !== 'function') throw new TypeError('stateIdFactory must be a function')
  if (typeof verifierFactory !== 'function') throw new TypeError('verifierFactory must be a function')
  if (!Number.isFinite(stateTtlMs) || stateTtlMs <= 0) throw new TypeError('stateTtlMs must be positive')

  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : ''
  const normalizedClientSecret = typeof clientSecret === 'string' ? clientSecret.trim() : ''
  const normalizedScopes = Object.freeze(Array.from(new Set((Array.isArray(scopes) ? scopes : []).map(scope => String(scope).trim()).filter(Boolean))))
  if (!normalizedScopes.includes(DRIVE_READONLY_SCOPE)) throw new TypeError('Google OAuth scopes must include Drive read-only')
  const pending = new Map()

  function configured() {
    return Boolean(normalizedClientId && normalizedClientSecret)
  }

  function assertConfigured() {
    if (!configured()) throw codedError('google_not_configured', 'Google OAuth is not configured on this server')
  }

  function start({ redirectUri } = {}) {
    assertConfigured()
    const uri = requiredString(redirectUri, 'redirectUri', 'google_invalid_redirect_uri')
    let parsed
    try { parsed = new URL(uri) }
    catch { throw codedError('google_invalid_redirect_uri', 'redirectUri must be an absolute URL') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw codedError('google_invalid_redirect_uri', 'redirectUri must use http or https')

    const state = requiredString(String(stateIdFactory()), 'state', 'google_invalid_oauth_state')
    const verifier = requiredString(String(verifierFactory()), 'PKCE verifier', 'google_invalid_oauth_state')
    if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) {
      throw codedError('google_invalid_oauth_state', 'PKCE verifier must be 43-128 unreserved characters')
    }
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
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
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', normalizedScopes.join(' '))
    authorize.searchParams.set('access_type', 'offline')
    authorize.searchParams.set('include_granted_scopes', 'true')
    authorize.searchParams.set('prompt', 'consent')
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
    body.set('code', requiredString(code, 'code', 'google_oauth_exchange_failed'))
    body.set('grant_type', 'authorization_code')
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
      throw codedError('google_oauth_exchange_failed', 'Google OAuth token exchange failed')
    }
    const data = await readJsonResponse(response, 'google_oauth_exchange_failed', 'Google OAuth token exchange failed')
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw codedError('google_oauth_exchange_failed', 'Google OAuth token exchange returned no access token')
    }
    requireDriveScope(data.scope)
    return data
  }

  async function fetchIdentity(accessToken) {
    let response
    try {
      response = await fetchImpl(USERINFO_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'EveGlyph-Editor',
        },
      })
    } catch {
      throw codedError('google_identity_failed', 'Google UserInfo request failed')
    }
    const data = await readJsonResponse(response, 'google_identity_failed', 'Google UserInfo request failed')
    return normalizeAccount(data)
  }

  async function complete({ code, state, broker } = {}) {
    assertConfigured()
    if (!broker || typeof broker.store !== 'function') throw new TypeError('broker is required')
    const stateKey = typeof state === 'string' ? state.trim() : ''
    const record = pending.get(stateKey)
    if (!record) throw codedError('google_invalid_oauth_state', 'Google OAuth state is invalid or already used')

    // Consume before any provider request so failed callbacks cannot be replayed.
    pending.delete(stateKey)
    const current = asDate(now())
    if (current.getTime() >= new Date(record.expiresAt).getTime()) {
      throw codedError('google_oauth_state_expired', 'Google OAuth state expired; start authentication again')
    }

    const token = await exchangeCode({ code, verifier: record.verifier, redirectUri: record.redirectUri })
    const account = await fetchIdentity(token.access_token)
    const tokenNow = asDate(now())
    const credentialId = broker.store({
      provider: 'google',
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
      throw codedError('google_reauthentication_required', 'Google connection must be authenticated again')
    }
    if (snapshot.refreshExpiresAt && current.getTime() >= new Date(snapshot.refreshExpiresAt).getTime()) {
      throw codedError('google_reauthentication_required', 'Google refresh credential expired; authenticate again')
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
      throw codedError('google_reauthentication_required', 'Google token refresh failed; authenticate again')
    }

    const data = await readJsonResponse(response, 'google_reauthentication_required', 'Google token refresh failed; authenticate again')
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw codedError('google_reauthentication_required', 'Google token refresh returned no access token; authenticate again')
    }
    if (data.scope != null) requireDriveScope(data.scope)

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

export { DEFAULT_SCOPES, DRIVE_READONLY_SCOPE }
