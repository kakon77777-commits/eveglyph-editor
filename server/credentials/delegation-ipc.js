import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024
const SENSITIVE_KEYS = new Set([
  'accessToken', 'refreshToken', 'clientSecret', 'access_token', 'refresh_token', 'client_secret', 'authorization', 'credentialEnvelope',
])

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function defaultEndpoint() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\eveglyph-credential-broker-${process.pid}`
  return path.join(os.tmpdir(), `eveglyph-credential-broker-${process.pid}.sock`)
}

function stableError(error) {
  const known = new Set([
    'delegation_not_found', 'delegation_expired', 'delegation_mismatch', 'delegation_invalid',
    'ipc_invalid_json', 'ipc_request_too_large', 'ipc_method_not_allowed', 'ipc_handler_not_found', 'ipc_sensitive_result_blocked',
  ])
  const code = known.has(error?.code) ? error.code : 'ipc_internal_error'
  const messages = {
    delegation_not_found: 'Delegation ticket not found.',
    delegation_expired: 'Delegation ticket expired.',
    delegation_mismatch: 'Delegation ticket does not authorize this operation.',
    delegation_invalid: 'Delegation request is invalid.',
    ipc_invalid_json: 'IPC request must be valid JSON.',
    ipc_request_too_large: 'IPC request exceeds the size limit.',
    ipc_method_not_allowed: 'IPC method is not allowed.',
    ipc_handler_not_found: 'Delegated operation handler is not registered.',
    ipc_sensitive_result_blocked: 'Delegated operation attempted to return sensitive credential material.',
    ipc_internal_error: 'Internal delegation IPC error.',
  }
  return { ok: false, error: { code, message: messages[code] } }
}

function containsSensitiveKey(value, seen = new Set()) {
  if (value == null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsSensitiveKey(item, seen))
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) return true
    if (containsSensitiveKey(child, seen)) return true
  }
  return false
}

function write(socket, payload) {
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
    let bytes = 0
    let tooLarge = false
    const chunks = []
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      if (tooLarge) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxRequestBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    socket.on('end', async () => {
      if (tooLarge) {
        write(socket, stableError(codedError('ipc_request_too_large', 'too large')))
        return
      }
      const text = chunks.join('').trim()
      let request
      try { request = JSON.parse(text) }
      catch {
        write(socket, stableError(codedError('ipc_invalid_json', 'invalid json')))
        return
      }
      try { write(socket, await handleRequest(request)) }
      catch (error) { write(socket, stableError(error)) }
    })
    socket.on('error', () => {})
  }

  async function start() {
    if (server) return endpoint
    removeStaleSocket()
    // Keep the server's writable side open after a client half-closes its
    // request stream. The protocol reads until client FIN, then replies.
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
