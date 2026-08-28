function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw codedError('credential_vault_invalid', `${field} must be a non-empty string`)
  return value.trim()
}

function safeKey(value, field) {
  const text = requiredString(value, field)
  if (!/^[A-Za-z0-9._:-]+$/.test(text)) throw codedError('credential_vault_invalid', `${field} contains unsupported characters`)
  return text
}

function redactedBackendError() {
  return codedError('credential_vault_unavailable', 'system credential vault is unavailable')
}

function cloneEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('credential_vault_invalid', 'credential envelope must be an object')
  const id = safeKey(value.id, 'credential id')
  const provider = safeKey(value.provider, 'provider')
  if (!value.account || typeof value.account !== 'object' || Array.isArray(value.account)) {
    throw codedError('credential_vault_invalid', 'credential account must be an object')
  }
  const accessToken = requiredString(value.accessToken, 'access token')
  const refreshToken = value.refreshToken == null || value.refreshToken === '' ? null : requiredString(value.refreshToken, 'refresh token')
  return {
    id,
    provider,
    account: { ...value.account },
    accessToken,
    accessExpiresAt: value.accessExpiresAt ?? null,
    refreshToken,
    refreshExpiresAt: value.refreshExpiresAt ?? null,
  }
}

export function createSystemKeyringVault({ EntryClass, service = 'EveGlyph Editor' } = {}) {
  if (typeof EntryClass !== 'function') throw new TypeError('EntryClass is required')
  const serviceName = requiredString(service, 'service')

  function entry(account) {
    try { return new EntryClass(serviceName, account) }
    catch { throw redactedBackendError() }
  }

  function readPassword(account) {
    try { return entry(account).getPassword() }
    catch (error) {
      if (error?.code === 'credential_vault_unavailable') throw error
      throw redactedBackendError()
    }
  }

  function writePassword(account, value) {
    try { entry(account).setPassword(String(value)) }
    catch (error) {
      if (error?.code === 'credential_vault_unavailable') throw error
      throw redactedBackendError()
    }
  }

  function deletePassword(account) {
    try { return Boolean(entry(account).deletePassword()) }
    catch (error) {
      if (error?.code === 'credential_vault_unavailable') throw error
      throw redactedBackendError()
    }
  }

  function credentialAccount(id) {
    return `credential:${safeKey(id, 'credential id')}`
  }

  function activeAccount(provider) {
    return `active:${safeKey(provider, 'provider')}`
  }

  function putCredential(envelope) {
    const normalized = cloneEnvelope(envelope)
    writePassword(credentialAccount(normalized.id), JSON.stringify(normalized))
    return normalized.id
  }

  function getCredential(id) {
    const text = readPassword(credentialAccount(id))
    if (text == null || text === '') return null
    try {
      const parsed = JSON.parse(text)
      const normalized = cloneEnvelope(parsed)
      if (normalized.id !== safeKey(id, 'credential id')) throw new Error('id mismatch')
      return normalized
    } catch {
      throw codedError('credential_vault_corrupt', 'stored credential envelope is invalid')
    }
  }

  function deleteCredential(id) {
    return deletePassword(credentialAccount(id))
  }

  function setActiveCredential(provider, credentialId) {
    const normalizedId = safeKey(credentialId, 'credential id')
    writePassword(activeAccount(provider), normalizedId)
    return normalizedId
  }

  function getActiveCredential(provider) {
    const value = readPassword(activeAccount(provider))
    if (value == null || value === '') return null
    return safeKey(value, 'credential id')
  }

  function clearActiveCredential(provider) {
    return deletePassword(activeAccount(provider))
  }

  return Object.freeze({
    putCredential,
    getCredential,
    deleteCredential,
    setActiveCredential,
    getActiveCredential,
    clearActiveCredential,
  })
}
