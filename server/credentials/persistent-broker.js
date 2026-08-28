import { createMemoryCredentialBroker } from './memory-broker.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireBroker(value) {
  for (const name of ['store', 'describe', 'withCredential', 'replaceSecrets', 'remove']) {
    if (!value || typeof value[name] !== 'function') throw new TypeError('memoryBroker is invalid')
  }
  return value
}

function requireVault(value) {
  for (const name of ['putCredential', 'getCredential', 'deleteCredential', 'setActiveCredential', 'getActiveCredential', 'clearActiveCredential']) {
    if (!value || typeof value[name] !== 'function') throw new TypeError('vault is invalid')
  }
  return value
}

function envelopeFrom({ id, description, input }) {
  return {
    id,
    provider: description.provider,
    account: description.account,
    accessToken: input.accessToken,
    accessExpiresAt: description.expires_at,
    refreshToken: input.refreshToken ?? null,
    refreshExpiresAt: description.refresh_expires_at,
  }
}

export function createPersistentCredentialBroker({
  vault,
  memoryBroker = createMemoryCredentialBroker(),
} = {}) {
  const store = requireVault(vault)
  const memory = requireBroker(memoryBroker)

  function persistCurrent(id, secretInput) {
    const description = memory.describe(id)
    const envelope = envelopeFrom({ id, description, input: secretInput })
    store.putCredential(envelope)
    store.setActiveCredential(description.provider, id)
    return description
  }

  function put(input = {}) {
    const id = memory.store(input)
    try {
      persistCurrent(id, input)
      return id
    } catch (error) {
      memory.remove(id)
      throw error
    }
  }

  function describe(id) {
    return memory.describe(id)
  }

  async function withCredential(id, fn) {
    return await memory.withCredential(id, fn)
  }

  function replaceSecrets(id, input = {}) {
    const before = store.getCredential(id)
    const description = memory.replaceSecrets(id, input)
    try {
      store.putCredential(envelopeFrom({ id, description, input }))
      store.setActiveCredential(description.provider, id)
      return description
    } catch (error) {
      if (before) {
        try {
          memory.replaceSecrets(id, {
            accessToken: before.accessToken,
            accessExpiresAt: before.accessExpiresAt,
            refreshToken: before.refreshToken,
            refreshExpiresAt: before.refreshExpiresAt,
          })
        } catch {}
      }
      throw error
    }
  }

  function remove(id) {
    let description = null
    try { description = memory.describe(id) }
    catch (error) {
      if (error?.code !== 'credential_not_found') throw error
    }

    const removedMemory = memory.remove(id)
    let removedVault = false
    try { removedVault = store.deleteCredential(id) }
    catch (error) {
      if (removedMemory) throw error
      throw error
    }

    if (description?.provider) {
      const active = store.getActiveCredential(description.provider)
      if (active === id) store.clearActiveCredential(description.provider)
    } else {
      for (const provider of ['github', 'google']) {
        const active = store.getActiveCredential(provider)
        if (active === id) store.clearActiveCredential(provider)
      }
    }
    return removedMemory || removedVault
  }

  function restoreActive(provider) {
    const activeId = store.getActiveCredential(provider)
    if (!activeId) return null
    const envelope = store.getCredential(activeId)
    if (!envelope) {
      store.clearActiveCredential(provider)
      return null
    }
    if (envelope.provider !== provider) {
      store.clearActiveCredential(provider)
      throw codedError('credential_provider_mismatch', 'stored credential provider does not match active provider')
    }

    try {
      memory.store({
        credentialId: envelope.id,
        provider: envelope.provider,
        account: envelope.account,
        accessToken: envelope.accessToken,
        accessExpiresAt: envelope.accessExpiresAt,
        refreshToken: envelope.refreshToken,
        refreshExpiresAt: envelope.refreshExpiresAt,
      })
    } catch (error) {
      if (error?.code !== 'credential_id_collision') throw error
    }
    return memory.describe(envelope.id)
  }

  return Object.freeze({
    store: put,
    describe,
    withCredential,
    replaceSecrets,
    remove,
    restoreActive,
  })
}
