import { createMemoryCredentialBroker } from './server/credentials/memory-broker.js'
import { createGoogleOAuth } from './server/connectors/google-oauth.js'
import { createGoogleDriveConnectorService } from './server/connectors/google-drive-service.js'
import { createGoogleDriveConnectorHttpController } from './server/connectors/google-drive-http.js'

const ROUTE_PREFIX = '/api/connectors/google/'
const MAX_JSON_BODY_BYTES = 64 * 1024

function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function isLocalRequest(req) {
  const rawHost = String(req.headers.host || '')
  let hostname = ''
  try { hostname = new URL(`http://${rawHost}`).hostname }
  catch { hostname = rawHost.split(':')[0] }
  if (!isLocalHost(hostname)) return false

  const origin = req.headers.origin
  if (!origin) return true
  try { return isLocalHost(new URL(origin).hostname) }
  catch { return false }
}

function writeJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function writeControllerResponse(res, response) {
  res.statusCode = response.status
  if (response.contentType) {
    res.setHeader('Content-Type', response.contentType)
    res.end(String(response.body ?? ''))
    return
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(response.body ?? {}))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks = []
    req.on('data', chunk => {
      bytes += chunk.length
      if (bytes > MAX_JSON_BODY_BYTES) {
        const error = new Error('request body too large')
        error.code = 'request_body_too_large'
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (bytes > MAX_JSON_BODY_BYTES) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        const error = new Error('invalid JSON body')
        error.code = 'invalid_json'
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function requestRedirectUri(req) {
  const configured = String(process.env.EVEGLYPH_GOOGLE_REDIRECT_URI || '').trim()
  if (configured) return configured
  const host = String(req.headers.host || '').trim()
  return `http://${host}/api/connectors/google/callback`
}

function methodNotAllowed(res) {
  writeJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } })
}

function badRequest(res, code, message) {
  writeJson(res, 400, { error: { code, message } })
}

export function googleDriveConnectorBridge({
  clientId = process.env.EVEGLYPH_GOOGLE_CLIENT_ID || '',
  clientSecret = process.env.EVEGLYPH_GOOGLE_CLIENT_SECRET || '',
  fetchImpl = globalThis.fetch,
  broker: injectedBroker = null,
} = {}) {
  const broker = injectedBroker || createMemoryCredentialBroker()
  const oauth = createGoogleOAuth({ clientId, clientSecret, fetchImpl })
  const service = createGoogleDriveConnectorService({ broker, oauth, fetchImpl })
  const controller = createGoogleDriveConnectorHttpController({ service })

  return {
    name: 'eveglyph-google-drive-connector',
    apply: 'serve',
    configureServer(server) {
      // Persistent identity restoration is provider-scoped and intentionally
      // restores no metadata/file session grants.
      if (typeof broker.restoreActive === 'function') {
        try {
          const restored = broker.restoreActive('google')
          if (restored?.credential_id) service.restoreAuth({ credentialId: restored.credential_id })
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'credential_restore_failed'
          console.warn(`[EveGlyph] Google credential restore unavailable (${code})`)
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const parsed = new URL(req.url || '/', 'http://localhost')
        if (!parsed.pathname.startsWith(ROUTE_PREFIX)) return next()

        if (!isLocalRequest(req)) {
          writeJson(res, 403, { error: { code: 'local_request_required', message: 'Google Drive connector API is local-only.' } })
          return
        }

        try {
          if (parsed.pathname === '/api/connectors/google/status') {
            if (req.method !== 'GET') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.status())
          }

          if (parsed.pathname === '/api/connectors/google/auth/start') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.startAuth({ redirectUri: requestRedirectUri(req) }))
          }

          if (parsed.pathname === '/api/connectors/google/callback') {
            if (req.method !== 'GET') return methodNotAllowed(res)
            return writeControllerResponse(res, await controller.callback({
              code: parsed.searchParams.get('code') || '',
              state: parsed.searchParams.get('state') || '',
            }))
          }

          if (parsed.pathname === '/api/connectors/google/disconnect') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.disconnect())
          }

          if (parsed.pathname === '/api/connectors/google/grant-metadata') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.grantMetadata())
          }

          if (parsed.pathname === '/api/connectors/google/list-files') {
            if (req.method !== 'GET') return methodNotAllowed(res)
            return writeControllerResponse(res, await controller.listFiles({
              pageToken: parsed.searchParams.get('page_token') || null,
            }))
          }

          if (parsed.pathname === '/api/connectors/google/grant-file-read') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            const body = await readJsonBody(req)
            return writeControllerResponse(res, controller.grantFileRead({ fileId: body.file_id }))
          }

          if (parsed.pathname === '/api/connectors/google/read-file') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            const body = await readJsonBody(req)
            return writeControllerResponse(res, await controller.readFile({ fileId: body.file_id }))
          }

          writeJson(res, 404, { error: { code: 'not_found', message: 'Google Drive connector route not found.' } })
        } catch (error) {
          if (error?.code === 'request_body_too_large') {
            writeJson(res, 413, { error: { code: 'request_body_too_large', message: 'Request body too large.' } })
            return
          }
          if (error?.code === 'invalid_json') {
            badRequest(res, 'invalid_json', 'Request body must be valid JSON.')
            return
          }
          writeJson(res, 500, { error: { code: 'internal_error', message: 'Internal Google Drive connector error.' } })
        }
      })
    },
  }
}
