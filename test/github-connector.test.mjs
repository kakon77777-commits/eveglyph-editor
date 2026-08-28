import test from 'node:test'
import assert from 'node:assert/strict'

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

function createFakeOAuth({ accountId = 42, login = 'neo', expiresAt = null, refresh } = {}) {
  return {
    configured: () => true,
    start: ({ redirectUri }) => ({ authorizeUrl: `https://github.com/login/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}` }),
    async complete({ broker }) {
      const credentialId = broker.store({
        provider: 'github',
        account: { id: accountId, login, avatar_url: 'https://example/avatar', html_url: `https://github.com/${login}` },
        accessToken: 'ghu_initial_secret',
        accessExpiresAt: expiresAt,
        refreshToken: refresh ? 'ghr_initial_secret' : null,
        refreshExpiresAt: refresh ? '2027-02-01T00:00:00.000Z' : null,
      })
      return { credentialId, account: broker.describe(credentialId).account }
    },
    async refreshCredential({ credentialId, broker }) {
      if (!refresh) {
        const error = new Error('reauthentication required')
        error.code = 'github_reauthentication_required'
        throw error
      }
      await refresh({ credentialId, broker })
      return broker.describe(credentialId)
    },
  }
}

async function createConnectedService({ fetchImpl, now, oauth } = {}) {
  const { createMemoryCredentialBroker } = await requireModule('../server/credentials/memory-broker.js', 'credential broker')
  const { createGitHubConnectorService } = await requireModule('../server/connectors/github-service.js', 'GitHub connector service')
  const broker = createMemoryCredentialBroker({
    now: now || (() => new Date('2026-08-28T05:00:00.000Z')),
    idFactory: () => 'cred-service',
  })
  const service = createGitHubConnectorService({
    broker,
    oauth: oauth || createFakeOAuth(),
    fetchImpl: fetchImpl || (async () => { throw new Error('unexpected network call') }),
    now: now || (() => new Date('2026-08-28T05:00:00.000Z')),
    eventIdFactory: (() => { let i = 0; return () => `audit-${++i}` })(),
  })
  await service.completeAuth({ code: 'fake-code', state: 'fake-state' })
  return { service, broker }
}

test('OAuth connection establishes identity but no repository grant', async () => {
  const { service } = await createConnectedService()
  const status = service.getStatus()
  assert.equal(status.connected, true)
  assert.equal(status.account.id, 42)
  assert.equal(status.account.login, 'neo')
  assert.deepEqual(status.grants, [])
  const serialized = JSON.stringify(status)
  assert.equal(serialized.includes('ghu_initial_secret'), false)
  assert.equal(serialized.includes('refresh'), false)
})

test('repository A grant permits A and does not authorize repository B', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return jsonResponse({
      type: 'file',
      path: 'README.md',
      sha: 'abc123',
      size: 5,
      encoding: 'base64',
      content: Buffer.from('hello', 'utf8').toString('base64'),
    })
  }
  const { service } = await createConnectedService({ fetchImpl })

  const grant = service.grantRepositoryRead({ repository: 'kakon77777-commits/eveglyph-editor' })
  assert.equal(grant.capability, 'connector.github.repository.contents.read')
  assert.equal(grant.repository, 'kakon77777-commits/eveglyph-editor')
  assert.equal(grant.lifetime, 'session')

  const allowed = await service.readRepositoryFile({
    repository: 'kakon77777-commits/eveglyph-editor',
    path: 'README.md',
    ref: 'main',
  })
  assert.equal(allowed.content, 'hello')
  assert.equal(allowed.capability_evidence.decision, 'allow')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ghu_initial_secret')

  await assert.rejects(
    service.readRepositoryFile({ repository: 'other/repo', path: 'README.md' }),
    error => error?.code === 'capability_denied',
  )
  assert.equal(calls.length, 1, 'denied request must fail before credential/network access')
})

test('GitHub read normalizes URL safely and rejects traversal before fetch', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return jsonResponse({
      type: 'file', path: 'docs/hello world.md', sha: 'sha1', size: 2, encoding: 'base64', content: 'aGk=',
    })
  }
  const { service } = await createConnectedService({ fetchImpl })
  service.grantRepositoryRead({ repository: 'owner/repo.name' })

  const result = await service.readRepositoryFile({ repository: 'owner/repo.name', path: 'docs/hello world.md', ref: 'feature/x' })
  assert.equal(result.content, 'hi')
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/owner/repo.name/contents/docs/hello%20world.md?ref=feature%2Fx',
  )

  for (const badPath of ['../secret', 'docs/../secret', '/rooted', 'docs//file.md', '.', '']) {
    await assert.rejects(
      service.readRepositoryFile({ repository: 'owner/repo.name', path: badPath }),
      error => error?.code === 'github_invalid_path',
      `expected invalid path: ${badPath}`,
    )
  }
  assert.equal(calls.length, 1)
})

test('expiring GitHub user token refreshes before repository read', async () => {
  const now = () => new Date('2026-08-28T05:00:00.000Z')
  let refreshed = 0
  const oauth = createFakeOAuth({
    expiresAt: '2026-08-28T05:00:20.000Z',
    refresh: async ({ credentialId, broker }) => {
      refreshed += 1
      broker.replaceSecrets(credentialId, {
        accessToken: 'ghu_refreshed_secret',
        accessExpiresAt: '2026-08-28T13:00:00.000Z',
        refreshToken: 'ghr_rotated_secret',
        refreshExpiresAt: '2027-02-01T00:00:00.000Z',
      })
    },
  })
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return jsonResponse({ type: 'file', path: 'a.txt', sha: 'sha2', size: 1, encoding: 'base64', content: 'eA==' })
  }
  const { service } = await createConnectedService({ fetchImpl, now, oauth })
  service.grantRepositoryRead({ repository: 'owner/repo' })

  await service.readRepositoryFile({ repository: 'owner/repo', path: 'a.txt' })
  assert.equal(refreshed, 1)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ghu_refreshed_secret')
})

test('disconnect destroys credentials and repository grants', async () => {
  let calls = 0
  const { service, broker } = await createConnectedService({
    fetchImpl: async () => { calls += 1; throw new Error('must not fetch while disconnected') },
  })
  service.grantRepositoryRead({ repository: 'owner/repo' })
  const before = service.getStatus()
  assert.equal(before.grants.length, 1)
  const credentialId = before.credential_id

  assert.equal(service.disconnect(), true)
  assert.equal(service.getStatus().connected, false)
  assert.deepEqual(service.getStatus().grants, [])
  assert.throws(() => broker.describe(credentialId), error => error?.code === 'credential_not_found')
  await assert.rejects(
    service.readRepositoryFile({ repository: 'owner/repo', path: 'README.md' }),
    error => error?.code === 'github_not_connected',
  )
  assert.equal(calls, 0)
})

test('GitHub file read rejects non-file, unsupported encoding, API errors, and files over 1 MiB', async () => {
  const responses = [
    jsonResponse([{ type: 'file', path: 'child.txt' }]),
    jsonResponse({ type: 'file', path: 'x.txt', sha: '1', size: 1, encoding: 'utf-8', content: 'x' }),
    jsonResponse({ message: 'Not Found' }, { status: 404 }),
    jsonResponse({
      type: 'file', path: 'big.txt', sha: '2', size: 1024 * 1024 + 1, encoding: 'base64',
      content: Buffer.alloc(1024 * 1024 + 1, 0x61).toString('base64'),
    }),
  ]
  const { service } = await createConnectedService({
    fetchImpl: async () => responses.shift(),
  })
  service.grantRepositoryRead({ repository: 'owner/repo' })

  await assert.rejects(service.readRepositoryFile({ repository: 'owner/repo', path: 'dir' }), error => error?.code === 'github_resource_not_file')
  await assert.rejects(service.readRepositoryFile({ repository: 'owner/repo', path: 'x.txt' }), error => error?.code === 'github_file_encoding_unsupported')
  await assert.rejects(service.readRepositoryFile({ repository: 'owner/repo', path: 'missing.txt' }), error => error?.code === 'github_api_error')
  await assert.rejects(service.readRepositoryFile({ repository: 'owner/repo', path: 'big.txt' }), error => error?.code === 'github_file_too_large')
})

test('GitHub connector public service exposes no write surface', async () => {
  const { service } = await createConnectedService()
  for (const name of ['writeFile', 'createFile', 'deleteFile', 'commit', 'request']) {
    assert.equal(name in service, false, `${name} must not exist in PR-B public service`)
  }
})
