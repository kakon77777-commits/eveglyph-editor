import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { githubConnectorBridge } from '../vite-github-connector.js'
import { googleDriveConnectorBridge } from '../vite-google-drive-connector.js'

function fakeServer() {
  return { middlewares: { use() {} } }
}

function fakePersistentBroker(provider) {
  const calls = []
  const credentialId = `${provider}-persisted-id`
  const description = provider === 'github'
    ? { credential_id: credentialId, provider, account: { id: 77, login: 'neo' }, expires_at: null, refresh_expires_at: null }
    : { credential_id: credentialId, provider, account: { sub: 'google-77', email: 'neo@example.test' }, expires_at: null, refresh_expires_at: null }
  return {
    calls,
    store() { throw new Error('not used') },
    describe(id) { assert.equal(id, credentialId); return description },
    async withCredential() { throw new Error('not used') },
    replaceSecrets() { throw new Error('not used') },
    remove() { return true },
    restoreActive(requestedProvider) {
      calls.push(requestedProvider)
      assert.equal(requestedProvider, provider)
      return description
    },
  }
}

test('GitHub Vite bridge restores persisted identity through an injected broker at server startup', () => {
  const broker = fakePersistentBroker('github')
  const plugin = githubConnectorBridge({ broker, clientId: 'client', clientSecret: 'secret', fetchImpl: async () => null })
  plugin.configureServer(fakeServer())
  assert.deepEqual(broker.calls, ['github'])
})

test('Google Vite bridge restores persisted identity through an injected broker at server startup', () => {
  const broker = fakePersistentBroker('google')
  const plugin = googleDriveConnectorBridge({ broker, clientId: 'client', clientSecret: 'secret', fetchImpl: async () => null })
  plugin.configureServer(fakeServer())
  assert.deepEqual(broker.calls, ['google'])
})

test('Vite composition creates one credential runtime and injects the same broker into both connector bridges', async () => {
  const source = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8')
  assert.match(source, /createCredentialRuntime/)
  assert.match(source, /credentialRuntime\s*=\s*createCredentialRuntime/)
  assert.match(source, /githubConnectorBridge\(\{[^}]*broker:\s*credentialRuntime\.broker/s)
  assert.match(source, /googleDriveConnectorBridge\(\{[^}]*broker:\s*credentialRuntime\.broker/s)
})
