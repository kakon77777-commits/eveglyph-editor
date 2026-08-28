import test from 'node:test'
import assert from 'node:assert/strict'

async function requireController() {
  try { return await import('../server/connectors/github-http.js') }
  catch (error) { assert.fail(`GitHub HTTP controller is not implemented: ${error?.message || error}`) }
}

function serialize(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function secretFree(value) {
  const text = serialize(value)
  for (const secret of ['ghu_fake_secret', 'ghr_fake_refresh', 'client-secret-value', 'oauth-code-secret', 'pkce-verifier-secret']) {
    assert.equal(text.includes(secret), false, `serialized response leaked ${secret}`)
  }
}

test('GitHub HTTP controller serializes status/start/grant/read/disconnect without credentials', async () => {
  const { createGitHubConnectorHttpController } = await requireController()
  const calls = []
  const service = {
    getStatus() {
      calls.push('status')
      return {
        configured: true,
        connected: true,
        credential_id: 'cred-opaque',
        account: { id: 42, login: 'neo' },
        expires_at: '2026-08-28T13:00:00.000Z',
        grants: [],
      }
    },
    startAuth({ redirectUri }) {
      calls.push(['start', redirectUri])
      return { authorizeUrl: 'https://github.com/login/oauth/authorize?state=public-state' }
    },
    disconnect() { calls.push('disconnect'); return true },
    grantRepositoryRead({ repository }) {
      calls.push(['grant', repository])
      return { capability: 'connector.github.repository.contents.read', repository, lifetime: 'session' }
    },
    async readRepositoryFile({ repository, path, ref }) {
      calls.push(['read', repository, path, ref])
      return {
        repository,
        path,
        ref,
        sha: 'abc',
        size: 5,
        encoding: 'utf-8',
        content: 'hello',
        capability_evidence: { decision: 'allow', profile: 'connector-session' },
      }
    },
  }
  const controller = createGitHubConnectorHttpController({ service })

  const responses = [
    await controller.status(),
    await controller.startAuth({ redirectUri: 'http://localhost:5173/api/connectors/github/callback' }),
    await controller.grantRead({ repository: 'owner/repo' }),
    await controller.readFile({ repository: 'owner/repo', path: 'README.md', ref: 'main' }),
    await controller.disconnect(),
  ]
  for (const response of responses) {
    assert.equal(response.status >= 200 && response.status < 300, true)
    secretFree(response.body)
  }
  assert.deepEqual(calls, [
    'status',
    ['start', 'http://localhost:5173/api/connectors/github/callback'],
    ['grant', 'owner/repo'],
    ['read', 'owner/repo', 'README.md', 'main'],
    'disconnect',
  ])
})

test('OAuth callback returns a small token-free HTML page', async () => {
  const { createGitHubConnectorHttpController } = await requireController()
  let received
  const service = {
    async completeAuth(input) {
      received = input
      return {
        configured: true,
        connected: true,
        credential_id: 'cred-opaque',
        account: { id: 42, login: 'neo' },
        expires_at: null,
        grants: [],
      }
    },
  }
  const controller = createGitHubConnectorHttpController({ service })
  const response = await controller.callback({ code: 'oauth-code-secret', state: 'state-public' })

  assert.equal(response.status, 200)
  assert.equal(response.contentType, 'text/html; charset=utf-8')
  assert.match(response.body, /GitHub connected/i)
  secretFree(response.body)
  assert.deepEqual(received, { code: 'oauth-code-secret', state: 'state-public' })
})

test('controller maps connector failures to stable redacted public errors', async () => {
  const { createGitHubConnectorHttpController } = await requireController()
  const secretError = code => {
    const error = new Error(`internal failure ghu_fake_secret ghr_fake_refresh client-secret-value pkce-verifier-secret`)
    error.code = code
    return error
  }
  const controller = createGitHubConnectorHttpController({
    service: {
      getStatus() { throw secretError('github_api_error') },
      startAuth() { throw secretError('github_not_configured') },
      async completeAuth() { throw secretError('github_invalid_oauth_state') },
      disconnect() { throw secretError('github_not_connected') },
      grantRepositoryRead() { throw secretError('github_invalid_repository') },
      async readRepositoryFile() { throw secretError('capability_denied') },
    },
  })

  const cases = [
    [await controller.status(), 502, 'github_api_error'],
    [await controller.startAuth({ redirectUri: 'http://localhost/callback' }), 503, 'github_not_configured'],
    [await controller.callback({ code: 'oauth-code-secret', state: 'bad' }), 400, 'github_invalid_oauth_state'],
    [await controller.disconnect(), 401, 'github_not_connected'],
    [await controller.grantRead({ repository: 'bad/repo' }), 400, 'github_invalid_repository'],
    [await controller.readFile({ repository: 'owner/repo', path: 'x' }), 403, 'capability_denied'],
  ]

  for (const [response, status, code] of cases) {
    assert.equal(response.status, status)
    const serialized = serialize(response.body)
    assert.match(serialized, new RegExp(code))
    secretFree(serialized)
  }
})
