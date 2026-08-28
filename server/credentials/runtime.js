import { createMemoryCredentialBroker } from './memory-broker.js'
import { createPersistentCredentialBroker } from './persistent-broker.js'
import { createSystemKeyringVault } from './system-keyring-vault.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createCredentialRuntime({
  mode = process.env.EVEGLYPH_CREDENTIAL_STORE || 'system',
  EntryClass = null,
  service = 'EveGlyph Editor',
  memoryBroker = null,
} = {}) {
  const normalized = String(mode || '').trim().toLowerCase()
  if (normalized === 'memory') {
    return Object.freeze({
      mode: 'memory',
      persistent: false,
      broker: memoryBroker || createMemoryCredentialBroker(),
    })
  }
  if (normalized !== 'system') {
    throw codedError('credential_store_mode_invalid', 'credential store mode must be system or memory')
  }
  if (typeof EntryClass !== 'function') {
    throw codedError('credential_keyring_binding_required', 'system credential store requires a keyring binding')
  }
  const vault = createSystemKeyringVault({ EntryClass, service })
  const broker = createPersistentCredentialBroker({
    vault,
    memoryBroker: memoryBroker || createMemoryCredentialBroker(),
  })
  return Object.freeze({ mode: 'system', persistent: true, vault, broker })
}
