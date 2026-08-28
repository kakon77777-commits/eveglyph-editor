import test from 'node:test'
import assert from 'node:assert/strict'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'

async function importOrFail(path, label) {
  try { return await import(path) }
  catch (error) { assert.fail(`${label} is not implemented: ${error.message}`) }
}

class FakeEntry {
  static values = new Map()
  static fail = false
  constructor(service, account) {
    this.key = `${service}::${account}`
  }
  setPassword(value) {
    if (FakeEntry.fail) throw new Error('backend-secret-failure')
    FakeEntry.values.set(this.key, String(value))
  }
  getPassword() {
    if (FakeEntry.fail) throw new Error('backend-secret-failure')
    return FakeEntry.values.get(this.key) ?? null
  }
  deletePassword() {
    if (FakeEntry.fail) throw new Error('backend-secret-failure')
    return FakeEntry.values.delete(this.key)
  }
}

function credential(provider = 'github') {
  return {
    provider,
    account: provider === 'github' ? { id: 7, login: 'neo' } : { sub: 'g-7', email: 'neo@example.test' },
    accessToken: `${provider}-access-secret`,
    accessExpiresAt: '2026-08-28T08:00:00.000Z',
    refreshToken: `${provider}-refresh-secret`,
    refreshExpiresAt: '2026-09-28T08:00:00.000Z',
  }
}

test('memory broker can restore an exact credential id without changing normal random-id behavior', () => {
  const broker = createMemoryCredentialBroker({ idFactory: () => 'random-id' })
  assert.equal(broker.store(credential()), 'random-id')
  assert.equal(broker.store({ credentialId: 'restored-id', ...credential('google') }), 'restored-id')
  assert.equal(broker.describe('restored-id').provider, 'google')
})

test('system keyring vault stores credential envelopes and active provider pointers without enumeration', async () => {
  FakeEntry.values.clear(); FakeEntry.fail = false
  const { createSystemKeyringVault } = await importOrFail('../server/credentials/system-keyring-vault.js', 'system keyring vault')
  const vault = createSystemKeyringVault({ EntryClass: FakeEntry, service: 'test-eveglyph' })
  const envelope = { id: 'cred-1', ...credential('google') }
  vault.putCredential(envelope)
  assert.deepEqual(vault.getCredential('cred-1'), envelope)
  vault.setActiveCredential('google', 'cred-1')
  assert.equal(vault.getActiveCredential('google'), 'cred-1')
  assert.equal('listCredentials' in vault, false)
  assert.equal(vault.deleteCredential('cred-1'), true)
  vault.clearActiveCredential('google')
  assert.equal(vault.getActiveCredential('google'), null)
})

test('system keyring backend errors are redacted and fail closed', async () => {
  FakeEntry.values.clear(); FakeEntry.fail = true
  const { createSystemKeyringVault } = await importOrFail('../server/credentials/system-keyring-vault.js', 'system keyring vault')
  const vault = createSystemKeyringVault({ EntryClass: FakeEntry, service: 'test-eveglyph' })
  assert.throws(() => vault.getActiveCredential('github'), error => {
    assert.equal(error.code, 'credential_vault_unavailable')
    assert.equal(String(error.message).includes('backend-secret-failure'), false)
    return true
  })
  FakeEntry.fail = false
})

test('persistent broker restores exact provider credential and persists secret replacement/removal', async () => {
  FakeEntry.values.clear(); FakeEntry.fail = false
  const { createSystemKeyringVault } = await importOrFail('../server/credentials/system-keyring-vault.js', 'system keyring vault')
  const { createPersistentCredentialBroker } = await importOrFail('../server/credentials/persistent-broker.js', 'persistent credential broker')
  const vault = createSystemKeyringVault({ EntryClass: FakeEntry, service: 'test-eveglyph' })
  const firstMemory = createMemoryCredentialBroker({ idFactory: () => 'persisted-id' })
  const first = createPersistentCredentialBroker({ vault, memoryBroker: firstMemory })
  const id = first.store(credential('google'))
  assert.equal(id, 'persisted-id')
  assert.equal(vault.getActiveCredential('google'), id)

  first.replaceSecrets(id, {
    accessToken: 'new-access',
    accessExpiresAt: '2026-08-28T09:00:00.000Z',
    refreshToken: 'new-refresh',
    refreshExpiresAt: '2026-09-28T09:00:00.000Z',
  })

  const restarted = createPersistentCredentialBroker({ vault, memoryBroker: createMemoryCredentialBroker() })
  const restored = restarted.restoreActive('google')
  assert.equal(restored.credential_id, id)
  const secrets = await restarted.withCredential(id, item => ({ access: item.accessToken, refresh: item.refreshToken }))
  assert.deepEqual(secrets, { access: 'new-access', refresh: 'new-refresh' })

  assert.equal(restarted.remove(id), true)
  assert.equal(vault.getActiveCredential('google'), null)
  assert.equal(vault.getCredential(id), null)
})

test('credential runtime defaults to system, supports explicit memory, and rejects unknown modes', async () => {
  FakeEntry.values.clear(); FakeEntry.fail = false
  const { createCredentialRuntime } = await importOrFail('../server/credentials/runtime.js', 'credential runtime')
  const system = createCredentialRuntime({ mode: 'system', EntryClass: FakeEntry, service: 'test-eveglyph' })
  assert.equal(system.mode, 'system')
  assert.equal(system.persistent, true)
  const memory = createCredentialRuntime({ mode: 'memory' })
  assert.equal(memory.mode, 'memory')
  assert.equal(memory.persistent, false)
  assert.throws(() => createCredentialRuntime({ mode: 'plaintext' }), { code: 'credential_store_mode_invalid' })
})
