import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024
// Substring match against a normalized (lowercased, separators stripped) key
// name — not an exact-match Set. The original exact-match list (accessToken,
// refreshToken, clientSecret, ...) only caught a result whose key spelling,
// case, and separator style matched one of 8 hardcoded literals exactly:
// 'Authorization' (capital A — the actual HTTP header casing this codebase's
// own fetch calls use), 'API_KEY', 'bearerToken', or any array element/bare
// string value all sailed through untouched. Nothing in this codebase
// currently returns credential-shaped data through a delegated result (the
// GitHub/Google connector reads only ever return { content, size, ... }), so
// this filter is a backstop against a future mistake, not a fix for a live
// leak — but it's the sole safety net for that invariant, so it should catch
// the whole shape family, not one exact spelling of it.
const SENSITIVE_KEY_PATTERNS = [
  'token', 'secret', 'password', 'passwd', 'bearer', 'authorization',
  'privatekey', 'credential', 'apikey', 'clientid',
]
function normalizeKeyForSensitivityCheck(key) {
  return String(key).toLowerCase().replace(/[_\-\s]/g, '')
}
function isSensitiveKey(key) {
  const normalized = normalizeKeyForSensitivityCheck(key)
  return SENSITIVE_KEY_PATTERNS.some(pattern => normalized.includes(pattern))
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function defaultEndpoint() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\eveglyph-credential-broker-${process.pid}`
  return path.join(os.tmpdir(), `eveglyph-credential-broker-${process.pid}.sock`)
}

const PUBLIC_MESSAGES = Object.freeze({
  delegation_not_found: 'Delegation ticket not found.',
  delegation_expired: 'Delegation ticket expired.',
  delegation_mismatch: 'Delegation ticket does not authorize this operation.',
  delegation_invalid: 'Delegation request is invalid.',
  delegation_service_unavailable: 'Delegated connector service is unavailable.',
  capability_denied: 'The delegated connector capability is not currently granted.',
  github_not_connected: 'GitHub is not connected.',
  github_reauthentication_required: 'GitHub must be authenticated again.',
  github_invalid_repository: 'GitHub repository is invalid.',
  github_invalid_path: 'GitHub path is invalid.',
  github_invalid_ref: 'GitHub ref is invalid.',
  github_api_error: 'GitHub API request failed.',
  github_resource_not_file: 'GitHub resource is not a regular file.',
  github_file_too_large: 'GitHub file exceeds the connector size limit.',
  github_file_encoding_unsupported: 'GitHub file is not supported as UTF-8 text.',
  google_drive_not_connected: 'Google Drive is not connected.',
  google_reauthentication_required: 'Google must be authenticated again.',
  google_drive_invalid_page_token: 'Google Drive page token is invalid.',
  google_drive_invalid_file_id: 'Google Drive file id is invalid.',
  google_drive_api_error: 'Google Drive API request failed.',
  google_drive_file_too_large: 'Google Drive file exceeds the connector size limit.',
  google_drive_file_encoding_unsupported: 'Google Drive file is not supported as UTF-8 text.',
  google_drive_export_unsupported: 'Google Workspace file type is not supported by the read-only connector.',
  ipc_invalid_json: 'IPC request must be valid JSON.',
  ipc_request_too_large: 'IPC request exceeds the size limit.',
  ipc_method_not_allowed: 'IPC method is not allowed.',
  ipc_handler_not_found: 'Delegated operation handler is not registered.',
  ipc_sensitive_result_blocked: 'Delegated operation attempted to return sensitive credential material.',
  ipc_internal_error: 'Internal delegation IPC error.',
})

function stableError(error) {
  // Object.hasOwn, not the `in` operator — `in` also walks the prototype
  // chain, so error.code === 'constructor' would resolve PUBLIC_MESSAGES's
  // inherited Object.prototype.constructor instead of failing to the
  // ipc_internal_error fallback. Not independently exploitable (this only
  // controls which fixed, non-secret message string gets echoed back), but
  // the same anti-pattern already fixed in src/capabilities/registry.js.
  const code = typeof error?.code === 'string' && Object.hasOwn(PUBLIC_MESSAGES, error.code)
    ? error.code
    : 'ipc_internal_error'
  return { ok: false, error: { code, message: PUBLIC_MESSAGES[code] } }
}

function containsSensitiveKey(value, seen = new Set()) {
  if (value == null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsSensitiveKey(item, seen))
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) return true
    if (containsSensitiveKey(child, seen)) return true
  }
  return false
}

function write(socket, payload) {
  // Server-initiated full close after writing, never a client-side half-close —
  // Windows named pipes do not reliably support allowHalfOpen's "write then
  // shutdown(SHUT_WR), keep reading" pattern (confirmed empirically: the
  // client's own .end() fires its local 'end'/'close' immediately with zero
  // bytes received, and the server never sees a matching 'end' to respond to).
  // A full bidirectional close initiated by whichever side is actually done
  // (here, the server, once it has written its one response line) works on
  // every platform because it isn't relying on half-duplex shutdown semantics.
  socket.end(`${JSON.stringify(payload)}\n`)
}

export function createDelegationIpcServer({
  delegationBroker,
  handlers = {},
  endpoint = defaultEndpoint(),
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
} = {}) {
  if (!delegationBroker || typeof delegationBroker.consume !== 'function') throw new TypeError('delegationBroker is required')
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) throw new TypeError('handlers must be an object')
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes <= 0) throw new TypeError('maxRequestBytes must be a positive integer')
  let server = null

  function removeStaleSocket() {
    if (process.platform === 'win32') return
    try { fs.unlinkSync(endpoint) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }

  async function handleRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw codedError('ipc_invalid_json', 'invalid request object')
    if (request.method !== 'invoke') throw codedError('ipc_method_not_allowed', 'unsupported method')
    const key = `${String(request.provider || '').trim()}:${String(request.operation || '').trim()}`
    const handler = handlers[key]
    if (typeof handler !== 'function') throw codedError('ipc_handler_not_found', 'handler not found')
    const delegation = delegationBroker.consume({
      ticket: request.ticket,
      provider: request.provider,
      operation: request.operation,
      capability: request.capability,
      resource: request.resource,
    })
    const result = await handler({ delegation, input: request.input ?? null })
    if (containsSensitiveKey(result)) throw codedError('ipc_sensitive_result_blocked', 'sensitive result blocked')
    return { ok: true, result: result ?? null }
  }

  function onConnection(socket) {
    // One newline-delimited JSON request per connection. End-of-request is
    // detected from the framing byte (the first '\n'), never from the client
    // half-closing its write side — see the comment on write() above for why.
    // The client keeps writing/reading on a single still-open connection; the
    // server is the only side that ever calls .end(), after it has a full
    // response to send.
    let bytes = 0
    let tooLarge = false
    let settled = false
    let buffered = ''
    socket.setEncoding('utf8')

    async function respond(payload) {
      if (settled) return
      settled = true
      write(socket, payload)
    }

    socket.on('data', chunk => {
      if (settled || tooLarge) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxRequestBytes) {
        tooLarge = true
        buffered = ''
        respond(stableError(codedError('ipc_request_too_large', 'too large')))
        return
      }
      buffered += chunk
      const newlineIndex = buffered.indexOf('\n')
      if (newlineIndex === -1) return
      const line = buffered.slice(0, newlineIndex).trim()
      let request
      try { request = JSON.parse(line) }
      catch {
        respond(stableError(codedError('ipc_invalid_json', 'invalid json')))
        return
      }
      handleRequest(request).then(respond, error => respond(stableError(error)))
    })
    socket.on('end', () => {
      // Client closed before sending a complete newline-terminated line —
      // an incomplete/empty request, not a valid one to parse.
      if (!settled) respond(stableError(codedError('ipc_invalid_json', 'invalid json')))
    })
    socket.on('error', () => {})
  }

  async function start() {
    if (server) return endpoint
    removeStaleSocket()
    server = net.createServer({ allowHalfOpen: true }, onConnection)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') {
      try { fs.chmodSync(endpoint, 0o600) } catch {}
    }
    return endpoint
  }

  async function stop() {
    if (!server) {
      removeStaleSocket()
      return
    }
    const current = server
    server = null
    await new Promise(resolve => current.close(() => resolve()))
    removeStaleSocket()
  }

  return Object.freeze({ start, stop, endpoint })
}

export { DEFAULT_MAX_REQUEST_BYTES }
