function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredString(value, field, code = 'invalid_credential') {
  if (typeof value !== 'string' || !value.trim()) throw codedError(code, `${field} must be a non-empty string`)
  return value.trim()
}

function normalizeTimestamp(value, field) {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('invalid_credential', `${field} must be a valid timestamp`)
  return date.toISOString()
}

function normalizeNow(now) {
  const value = now()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('invalid_credential_clock', 'credential broker clock returned an invalid date')
  return date
}

function cloneAccount(account) {
  if (account == null || typeof account !== 'object' || Array.isArray(account)) {
    throw codedError('invalid_credential', 'account must be an object')
  }
  return Object.freeze({ ...account })
}

let fallbackId = 0
function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `credential-${Date.now().toString(36)}-${fallbackId.toString(36)}`
}

export function createMemoryCredentialBroker({
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function')

  const records = new Map()

  function requireRecord(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    const record = records.get(key)
    if (!record) throw codedError('credential_not_found', 'credential handle not found')
    return record
  }

  function publicDescription(record) {
    return Object.freeze({
      credential_id: record.id,
      provider: record.provider,
      account: record.account,
      expires_at: record.accessExpiresAt,
      refresh_expires_at: record.refreshExpiresAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    })
  }

  function store({
    provider,
    account,
    accessToken,
    accessExpiresAt = null,
    refreshToken = null,
    refreshExpiresAt = null,
  } = {}) {
    const id = requiredString(String(idFactory()), 'credential id')
    if (records.has(id)) throw codedError('credential_id_collision', 'credential id already exists')
    const timestamp = normalizeNow(now).toISOString()
    const record = {
      id,
      provider: requiredString(provider, 'provider'),
      account: cloneAccount(account),
      accessToken: requiredString(accessToken, 'accessToken'),
      accessExpiresAt: normalizeTimestamp(accessExpiresAt, 'accessExpiresAt'),
      refreshToken: refreshToken == null || refreshToken === '' ? null : requiredString(refreshToken, 'refreshToken'),
      refreshExpiresAt: normalizeTimestamp(refreshExpiresAt, 'refreshExpiresAt'),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    records.set(id, record)
    return id
  }

  function describe(id) {
    return publicDescription(requireRecord(id))
  }

  async function withCredential(id, fn) {
    if (typeof fn !== 'function') throw new TypeError('credential callback must be a function')
    const record = requireRecord(id)
    return await fn(record)
  }

  function replaceSecrets(id, {
    accessToken,
    accessExpiresAt = null,
    refreshToken = null,
    refreshExpiresAt = null,
  } = {}) {
    const record = requireRecord(id)
    record.accessToken = requiredString(accessToken, 'accessToken')
    record.accessExpiresAt = normalizeTimestamp(accessExpiresAt, 'accessExpiresAt')
    record.refreshToken = refreshToken == null || refreshToken === '' ? null : requiredString(refreshToken, 'refreshToken')
    record.refreshExpiresAt = normalizeTimestamp(refreshExpiresAt, 'refreshExpiresAt')
    record.updatedAt = normalizeNow(now).toISOString()
    return publicDescription(record)
  }

  function remove(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!records.has(key)) return false
    records.delete(key)
    return true
  }

  return Object.freeze({
    store,
    describe,
    withCredential,
    replaceSecrets,
    remove,
  })
}
