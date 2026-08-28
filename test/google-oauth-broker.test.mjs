import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'

async function requireGoogleOAuth() {
  try { return await import('../server/connectors/google-oauth.js') }
  catch (error) { assert.fail(`Google OAuth connector is not implemented: ${error?.message || error}`) }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'
const ALL_SCOPES = ['openid', 'email', 'profile', DRIVE_READONLY]

function makeClock(iso = '2026-08-28T06:00:00.000Z') {
  let current = new Date(iso)
  return {
    now: () => new Date(current),
    advance(ms) { current = new Date(current.getTime() + ms) },
  }
}

test('Google OAuth start uses state, S256 PKCE, offline access, and the exact read-only scope set', async () => {
  const { createGoogleOAuth } = await requireGoogleOAuth()
  const clock = makeClock()
  const oauth = createGoogleOAuth({
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    now: clock.now,
    stateIdFactory: () => 'state-123',
    verifierFactory: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    fetchImpl: async () => { throw new Error('network must not run during start') },
  })

  const started = oauth.start({ redirectUri: 'http://localhost:5173/api/connectors/google/callback' })
  const url = new URL(started.authorizeUrl)
  const expectedChallenge = createHash('sha256')
    .update('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~')
    .digest('base64url')

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), 'google-client-id')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/api/connectors/google/callback')
  assert.equal(url.searchParams.get('state'), 'state-123')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge)
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.deepEqual(new Set(url.searchParams.get('scope').split(' ')), new Set(ALL_SCOPES))
  assert.equal(url.searchParams.has('client_secret'), false)
  assert.equal(started.state, 'state-123')
})

test('Google OAuth completion consumes state, validates required scopes, binds stable sub identity, and stores secrets only in broker', async () => {
  const { createGoogleOAuth } = await requireGoogleOAuth()
  const clock = makeClock()
  const calls = []
  const broker = createMemoryCredentialBroker({ now: clock.now, idFactory: () => 'google-credential-1' })
  const oauth = createGoogleOAuth({
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    now: clock.now,
    stateIdFactory: () => 'state-ok',
    verifierFactory: () => 'verifier-with-enough-entropy-abcdefghijklmnopqrstuvwxyz0123456789',
    fetchImpl: async (url, options = {}) => {
      calls.push([String(url), options])
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({
          access_token: 'ya29.access-secret',
          expires_in: 3600,
          refresh_token: '1//refresh-secret',
          scope: ALL_SCOPES.join(' '),
          token_type: 'Bearer',
        })
      }
      if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return jsonResponse({
          sub: '109876543210987654321',
          email: 'neo@example.com',
          email_verified: true,
          name: 'Neo',
          picture: 'https://example.com/avatar.png',
        })
      }
      throw new Error(`unexpected URL ${url}`)
    },
  })

  oauth.start({ redirectUri: 'http://localhost:5173/api/connectors/google/callback' })
  const completed = await oauth.complete({ code: 'oauth-code-secret', state: 'state-ok', broker })

  assert.equal(completed.credentialId, 'google-credential-1')
  assert.deepEqual(completed.account, {
    sub: '109876543210987654321',
    email: 'neo@example.com',
    email_verified: true,
    name: 'Neo',
    picture: 'https://example.com/avatar.png',
  })

  const tokenCall = calls.find(([url]) => url === 'https://oauth2.googleapis.com/token')
  assert.ok(tokenCall)
  const tokenBody = tokenCall[1].body
  assert.equal(tokenBody.get('grant_type'), 'authorization_code')
  assert.equal(tokenBody.get('client_id'), 'google-client-id')
  assert.equal(tokenBody.get('client_secret'), 'google-client-secret')
  assert.equal(tokenBody.get('code'), 'oauth-code-secret')
  assert.equal(tokenBody.get('redirect_uri'), 'http://localhost:5173/api/connectors/google/callback')
  assert.ok(tokenBody.get('code_verifier'))

  const described = broker.describe('google-credential-1')
  assert.equal(described.provider, 'google')
  assert.equal(JSON.stringify(described).includes('ya29.access-secret'), false)
  assert.equal(JSON.stringify(described).includes('1//refresh-secret'), false)
  await broker.withCredential('google-credential-1', credential => {
    assert.equal(credential.accessToken, 'ya29.access-secret')
    assert.equal(credential.refreshToken, '1//refresh-secret')
  })

  await assert.rejects(
    oauth.complete({ code: 'replay', state: 'state-ok', broker }),
    error => error?.code === 'google_invalid_oauth_state',
  )
})

test('Google OAuth rejects expired state before token exchange', async () => {
  const { createGoogleOAuth } = await requireGoogleOAuth()
  const clock = makeClock()
  let fetchCount = 0
  const oauth = createGoogleOAuth({
    clientId: 'id',
    clientSecret: 'secret',
    now: clock.now,
    stateIdFactory: () => 'state-expired',
    verifierFactory: () => 'verifier-with-enough-entropy-abcdefghijklmnopqrstuvwxyz0123456789',
    stateTtlMs: 1000,
    fetchImpl: async () => { fetchCount += 1; return jsonResponse({}) },
  })
  const broker = createMemoryCredentialBroker({ now: clock.now })

  oauth.start({ redirectUri: 'http://localhost/callback' })
  clock.advance(1000)
  await assert.rejects(
    oauth.complete({ code: 'code', state: 'state-expired', broker }),
    error => error?.code === 'google_oauth_state_expired',
  )
  assert.equal(fetchCount, 0)
})

test('Google OAuth fails closed when Drive readonly scope was not granted', async () => {
  const { createGoogleOAuth } = await requireGoogleOAuth()
  const clock = makeClock()
  const broker = createMemoryCredentialBroker({ now: clock.now })
  const oauth = createGoogleOAuth({
    clientId: 'id',
    clientSecret: 'secret',
    now: clock.now,
    stateIdFactory: () => 'state-partial',
    verifierFactory: () => 'verifier-with-enough-entropy-abcdefghijklmnopqrstuvwxyz0123456789',
    fetchImpl: async (url) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({
          access_token: 'access',
          expires_in: 3600,
          refresh_token: 'refresh',
          scope: 'openid email profile',
        })
      }
      throw new Error('userinfo must not run without required Drive scope')
    },
  })

  oauth.start({ redirectUri: 'http://localhost/callback' })
  await assert.rejects(
    oauth.complete({ code: 'code', state: 'state-partial', broker }),
    error => error?.code === 'google_required_scope_missing',
  )
})

test('Google OAuth refresh uses the broker refresh token and preserves it when Google rotates only the access token', async () => {
  const { createGoogleOAuth } = await requireGoogleOAuth()
  const clock = makeClock()
  const broker = createMemoryCredentialBroker({ now: clock.now, idFactory: () => 'cred-refresh' })
  broker.store({
    provider: 'google',
    account: { sub: '123' },
    accessToken: 'old-access',
    accessExpiresAt: '2026-08-28T06:00:10.000Z',
    refreshToken: 'stable-refresh',
  })

  let body
  const oauth = createGoogleOAuth({
    clientId: 'id',
    clientSecret: 'secret',
    now: clock.now,
    fetchImpl: async (url, options = {}) => {
      assert.equal(String(url), 'https://oauth2.googleapis.com/token')
      body = options.body
      return jsonResponse({ access_token: 'new-access', expires_in: 3600, scope: ALL_SCOPES.join(' ') })
    },
  })

  const updated = await oauth.refreshCredential({ credentialId: 'cred-refresh', broker })
  assert.equal(body.get('grant_type'), 'refresh_token')
  assert.equal(body.get('refresh_token'), 'stable-refresh')
  assert.equal(body.get('client_secret'), 'secret')
  assert.equal(updated.credential_id, 'cred-refresh')
  await broker.withCredential('cred-refresh', credential => {
    assert.equal(credential.accessToken, 'new-access')
    assert.equal(credential.refreshToken, 'stable-refresh')
  })
})
