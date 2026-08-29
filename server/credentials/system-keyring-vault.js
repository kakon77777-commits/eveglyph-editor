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

  // Account profile, access token, and refresh token each get their own keyring
  // entry, separate from the rest of the envelope: any one of them (a long
  // provider account/profile object, or a token long enough on its own — observed
  // with Google, once include_granted_scopes pulls in a large existing grant) can
  // exceed the ~2560-char native credential blob limit on Windows if bundled
  // together. Splitting keeps every entry comfortably under that cap regardless
  // of how large any individual piece is.
  function credentialAccountProfile(id) {
    return `profile:${safeKey(id, 'credential id')}`
  }

  function credentialAccessAccount(id) {
    return `access:${safeKey(id, 'credential id')}`
  }

  function credentialRefreshAccount(id) {
    return `refresh:${safeKey(id, 'credential id')}`
  }

  function activeAccount(provider) {
    return `active:${safeKey(provider, 'provider')}`
  }

  function putCredential(envelope) {
    const normalized = cloneEnvelope(envelope)
    const core = { id: normalized.id, provider: normalized.provider, refreshExpiresAt: normalized.refreshExpiresAt }
    // picture is display-only (unused anywhere in the app today) and, for some
    // accounts, large enough by itself to blow the per-entry budget below — drop
    // it at the persistence boundary rather than carry it through unused.
    const { picture: _picture, ...accountForStorage } = normalized.account
    const profile = { account: accountForStorage }
    const access = { accessToken: normalized.accessToken, accessExpiresAt: normalized.accessExpiresAt }
    const refresh = { refreshToken: normalized.refreshToken }
    const coreJson = JSON.stringify(core)
    const profileJson = JSON.stringify(profile)
    const accessJson = JSON.stringify(access)
    const refreshJson = JSON.stringify(refresh)
    writePassword(credentialAccount(normalized.id), coreJson)
    writePassword(credentialAccountProfile(normalized.id), profileJson)
    writePassword(credentialAccessAccount(normalized.id), accessJson)
    writePassword(credentialRefreshAccount(normalized.id), refreshJson)
    return normalized.id
  }

  function getCredential(id) {
    const coreText = readPassword(credentialAccount(id))
    const profileText = readPassword(credentialAccountProfile(id))
    const accessText = readPassword(credentialAccessAccount(id))
    const refreshText = readPassword(credentialRefreshAccount(id))
    if ([coreText, profileText, accessText, refreshText].some(text => text == null || text === '')) return null
    try {
      const core = JSON.parse(coreText)
      const profile = JSON.parse(profileText)
      const access = JSON.parse(accessText)
      const refresh = JSON.parse(refreshText)
      const normalized = cloneEnvelope({ ...core, ...profile, ...access, ...refresh })
      if (normalized.id !== safeKey(id, 'credential id')) throw new Error('id mismatch')
      return normalized
    } catch {
      throw codedError('credential_vault_corrupt', 'stored credential envelope is invalid')
    }
  }

  function deleteCredential(id) {
    const removedCore = deletePassword(credentialAccount(id))
    const removedProfile = deletePassword(credentialAccountProfile(id))
    const removedAccess = deletePassword(credentialAccessAccount(id))
    const removedRefresh = deletePassword(credentialRefreshAccount(id))
    return removedCore || removedProfile || removedAccess || removedRefresh
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
