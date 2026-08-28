import net from 'node:net'

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function invokeDelegatedOperation({
  endpoint,
  request,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return Promise.reject(codedError('delegation_endpoint_unavailable', 'Delegation endpoint is not configured.'))
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return Promise.reject(codedError('delegation_invalid', 'Delegation request is invalid.'))
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    return Promise.reject(new TypeError('maxResponseBytes must be a positive integer'))
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.trim())
    let settled = false
    let bytes = 0
    let text = ''

    const finishReject = error => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch {}
      reject(error)
    }

    const finishResponse = line => {
      if (settled) return
      settled = true
      let payload
      try { payload = JSON.parse(line.trim()) }
      catch {
        reject(codedError('delegation_invalid_response', 'Delegation IPC returned an invalid response.'))
        return
      }
      try { socket.destroy() } catch {}
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        reject(codedError('delegation_invalid_response', 'Delegation IPC returned an invalid response.'))
        return
      }
      if (payload.ok !== true) {
        const code = typeof payload.error?.code === 'string' ? payload.error.code : 'delegation_operation_failed'
        const message = typeof payload.error?.message === 'string' ? payload.error.message : 'Delegated connector operation failed.'
        reject(codedError(code, message))
        return
      }
      resolve(payload.result ?? null)
    }

    socket.setEncoding('utf8')
    // Write the request and keep reading on the SAME still-open connection —
    // never half-close (socket.end() on write). The server is the one that
    // ends the connection, once it has a full response; end-of-response is
    // recognized from the newline framing byte, not from a half-duplex
    // shutdown. See the matching comment in delegation-ipc.js for why: a
    // client-side half-close does not reliably signal "done writing, still
    // reading" over a Windows named pipe the way it does over a Unix domain
    // socket or TCP.
    socket.on('connect', () => {
      try { socket.write(`${JSON.stringify(request)}\n`) }
      catch { finishReject(codedError('delegation_endpoint_unavailable', 'Delegation endpoint is unavailable.')) }
    })
    socket.on('data', chunk => {
      if (settled) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxResponseBytes) {
        finishReject(codedError('delegation_response_too_large', 'Delegation IPC response exceeds the size limit.'))
        return
      }
      text += chunk
      const newlineIndex = text.indexOf('\n')
      if (newlineIndex !== -1) finishResponse(text.slice(0, newlineIndex))
    })
    socket.on('end', () => finishReject(codedError('delegation_invalid_response', 'Delegation IPC returned an invalid response.')))
    socket.on('error', () => finishReject(codedError('delegation_endpoint_unavailable', 'Delegation endpoint is unavailable.')))
  })
}

export { DEFAULT_MAX_RESPONSE_BYTES }
