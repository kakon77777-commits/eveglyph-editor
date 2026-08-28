import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

async function requireModule(path, label) {
  try { return await import(path) }
  catch (error) { assert.fail(`${label} is not implemented: ${error?.message || error}`) }
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async text() { return JSON.stringify(body) },
  }
}

test('credential broker public descriptions redact access and refresh tokens', async () => {
  const { createMemoryCredentialBroker } = await requireModule('../server/credentials/memory-broker.js', 'credential broker')
  const broker = createMemoryCredentialBroker({
    now: () => new Date('2026-08-28T05:00:00.000Z'),
    idFactory: () => 'cred-1',
  })

  const id = broker.store({
    provider: 'github',
    account: { id: 42, login: 'neo' },
    accessToken: 'ghu_access_secret',
    accessExpiresAt: '2026-08-28T13:00:00.000Z',
    refreshToken: 'ghr_refresh_secret',
    refreshExpiresAt: '2027-02-28T05:00:00.000Z',
  })

  assert.equal(id, 'cred-1')
  const description = broker.describe(id)
  assert.equal(description.credential_id, 'cred-1')
  assert.equal(description.provider, 'github')
  assert.equal(description.account.login, 'neo')
  assert.equal(JSON.stringify(description).includes('ghu_access_secret'), false)
  assert.equal(JSON.stringify(description).includes('ghr_refresh_secret'), false)
  assert.equal(Object.hasOwn(description, 'accessToken'), false)
  assert.equal(Object.hasOwn(description, 'refreshToken'), false)

  const secretSnapshot = await broker.withCredential(id, credential => ({
    accessToken: credential.accessToken,
    refreshToken: credential.refreshToken,
  }))
  assert.deepEqual(secretSnapshot, {
    accessToken: 'ghu_access_secret',
    refreshToken: 'ghr_refresh_secret',
  })
})

test('credential broker removal makes the opaque handle unusable', async () => {
  const { createMemoryCredentialBroker } = await requireModule('../server/credentials/memory-broker.js', 'credential broker')
  const broker = createMemoryCredentialBroker({ idFactory: () => 'cred-2' })
  const id = broker.store({ provider: 'github', account: { id: 7, login: 'gone' }, accessToken: 'secret' })

  assert.equal(broker.remove(id), true)
  assert.throws(() => broker.describe(id), error => error?.code === 'credential_not_found')
  await assert.rejects(
    broker.withCredential(id, async () => 'should not run'),
    error => error?.code === 'credential_not_found',
  )
})

test('GitHub App OAuth start creates a state-bound S256 PKCE authorization URL', async () => {
  const { createGitHubAppOAuth } = await requireModule('../server/connectors/github-app.js', 'GitHub OAuth client')
  const verifier = 'fixed-pkce-verifier-for-test'
  const expectedChallenge = createHash('sha256').update(verifier).digest('base64url')
  const oauth = createGitHubAppOAuth({
    clientId: 'Iv1.test-client',
    clientSecret: 'server-only-secret',
    stateIdFactory: () => 'state-1',
    verifierFactory: () => verifier,
    now: () => new Date('2026-08-28T05:00:00.000Z'),
    fetchImpl: async () => { throw new Error('network must not run during auth start') },
  })

  assert.equal(oauth.configured(), true)
  const started = oauth.start({ redirectUri: 'http://localhost:5173/api/connectors/github/callback' })
  const url = new URL(started.authorizeUrl)
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(url.searchParams.get('client_id'), 'Iv1.test-client')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/api/connectors/github/callback')
  assert.equal(url.searchParams.get('state'), 'state-1')
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(started.state, 'state-1')
  assert.equal(started.expiresAt, '2026-08-28T05:10:00.000Z')
})

test('GitHub OAuth state is consumed once and successful exchange binds public user metadata', async () => {
  const { createMemoryCredentialBroker } = await requireModule('../server/credentials/memory-broker.js', 'credential broker')
  const { createGitHubAppOAuth } = await requireModule('../server/connectors/github-app.js', 'GitHub OAuth client')
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      const body = String(options.body || '')
      assert.match(body, /client_id=Iv1.test-client/)
      assert.match(body, /client_secret=server-only-secret/)
      assert.match(body, /code=oauth-code/)
      assert.match(body, /code_verifier=fixed-verifier/)
      return jsonResponse({
        access_token: 'ghu_access_secret',
        expires_in: 28800,
        refresh_token: 'ghr_refresh_secret',
        refresh_token_expires_in: 15552000,
        token_type: 'bearer',
      })
    }
    if (String(url) === 'https://api.github.com/user') {
      assert.equal(options.headers.Authorization, 'Bearer ghu_access_secret')
      return jsonResponse({ id: 42, login: 'neo', avatar_url: 'https://example/avatar', html_url: 'https://github.com/neo' })
    }
    throw new Error(`unexpected URL ${url}`)
  }

  const broker = createMemoryCredentialBroker({
    now: () => new Date('2026-08-28T05:00:00.000Z'),
    idFactory: () => 'cred-oauth',
  })
  const oauth = createGitHubAppOAuth({
    clientId: 'Iv1.test-client',
    clientSecret: 'server-only-secret',
    stateIdFactory: () => 'state-once',
    verifierFactory: () => 'fixed-verifier',
    now: () => new Date('2026-08-28T05:00:00.000Z'),
    fetchImpl,
  })
  oauth.start({ redirectUri: 'http://localhost:5173/api/connectors/github/callback' })

  const completed = await oauth.complete({ code: 'oauth-code', state: 'state-once', broker })
  assert.equal(completed.credentialId, 'cred-oauth')
  assert.deepEqual(completed.account, {
    id: 42,
    login: 'neo',
    avatar_url: 'https://example/avatar',
    html_url: 'https://github.com/neo',
  })

  const description = broker.describe('cred-oauth')
  assert.equal(description.expires_at, '2026-08-28T13:00:00.000Z')
  assert.equal(description.refresh_expires_at, '2027-02-24T05:00:00.000Z')
  assert.equal(JSON.stringify(description).includes('ghu_access_secret'), false)

  await assert.rejects(
    oauth.complete({ code: 'oauth-code-again', state: 'state-once', broker }),
    error => error?.code === 'github_invalid_oauth_state',
  )
  assert.equal(calls.filter(call => call.url === 'https://github.com/login/oauth/access_token').length, 1)
})

test('expired GitHub OAuth state fails closed before token exchange', async () => {
  const { createMemoryCredentialBroker } = await requireModule('../server/credentials/memory-broker.js', 'credential broker')
  const { createGitHubAppOAuth } = await requireModule('../server/connectors/github-app.js', 'GitHub OAuth client')
  let now = new Date('2026-08-28T05:00:00.000Z')
  let fetchCalls = 0
  const oauth = createGitHubAppOAuth({
    clientId: 'Iv1.test-client',
    clientSecret: 'server-only-secret',
    stateIdFactory: () => 'state-expire',
    verifierFactory: () => 'fixed-verifier',
    now: () => now,
    fetchImpl: async () => { fetchCalls += 1; throw new Error('expired state must not fetch') },
  })
  const broker = createMemoryCredentialBroker()
  oauth.start({ redirectUri: 'http://localhost:5173/api/connectors/github/callback' })
  now = new Date('2026-08-28T05:10:00.001Z')

  await assert.rejects(
    oauth.complete({ code: 'too-late', state: 'state-expire', broker }),
    error => error?.code === 'github_oauth_state_expired',
  )
  assert.equal(fetchCalls, 0)
  await assert.rejects(
    oauth.complete({ code: 'replay', state: 'state-expire', broker }),
    error => error?.code === 'github_invalid_oauth_state',
  )
})
