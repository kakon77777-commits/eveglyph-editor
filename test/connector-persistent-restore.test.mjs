import test from 'node:test'
import assert from 'node:assert/strict'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'
import { createGitHubConnectorService } from '../server/connectors/github-service.js'
import { createGoogleDriveConnectorService } from '../server/connectors/google-drive-service.js'

function inertOAuth() {
  return {
    configured: () => true,
    start() { throw new Error('not used') },
    async complete() { throw new Error('not used') },
    async refreshCredential() { throw new Error('not used') },
  }
}

test('GitHub restored credential recreates identity but grants zero repository authority', async () => {
  const broker = createMemoryCredentialBroker({ idFactory: () => 'gh-restored' })
  const credentialId = broker.store({
    provider: 'github',
    account: { id: 77, login: 'neo' },
    accessToken: 'github-secret',
  })
  let fetchCalls = 0
  const service = createGitHubConnectorService({
    broker,
    oauth: inertOAuth(),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not fetch') },
  })
  assert.equal(typeof service.restoreAuth, 'function')
  const status = service.restoreAuth({ credentialId })
  assert.equal(status.connected, true)
  assert.equal(status.account.id, 77)
  assert.deepEqual(status.grants, [])
  await assert.rejects(
    () => service.readRepositoryFile({ repository: 'owner/repo', path: 'README.md' }),
    { code: 'capability_denied' },
  )
  assert.equal(fetchCalls, 0)
})

test('Google restored credential recreates identity but grants zero metadata or file authority', async () => {
  const broker = createMemoryCredentialBroker({ idFactory: () => 'google-restored' })
  const credentialId = broker.store({
    provider: 'google',
    account: { sub: 'google-77', email: 'neo@example.test', name: 'Neo' },
    accessToken: 'google-secret',
  })
  let fetchCalls = 0
  const service = createGoogleDriveConnectorService({
    broker,
    oauth: inertOAuth(),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not fetch') },
  })
  assert.equal(typeof service.restoreAuth, 'function')
  const status = service.restoreAuth({ credentialId })
  assert.equal(status.connected, true)
  assert.equal(status.account.sub, 'google-77')
  assert.deepEqual(status.grants, [])
  await assert.rejects(() => service.listDriveFiles(), { code: 'capability_denied' })
  await assert.rejects(() => service.readDriveFile({ fileId: 'file-a' }), { code: 'capability_denied' })
  assert.equal(fetchCalls, 0)
})

test('connector restoration rejects provider mismatch', () => {
  const broker = createMemoryCredentialBroker({ idFactory: () => 'wrong-provider' })
  const credentialId = broker.store({ provider: 'google', account: { sub: 'g' }, accessToken: 'secret' })
  const github = createGitHubConnectorService({ broker, oauth: inertOAuth(), fetchImpl: async () => null })
  assert.throws(() => github.restoreAuth({ credentialId }), { code: 'credential_provider_mismatch' })
})
