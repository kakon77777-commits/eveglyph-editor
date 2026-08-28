import { createMemoryCredentialBroker } from './server/credentials/memory-broker.js'
import { createGitHubAppOAuth } from './server/connectors/github-app.js'
import { createGitHubConnectorService } from './server/connectors/github-service.js'
import { createGitHubConnectorHttpController } from './server/connectors/github-http.js'

const ROUTE_PREFIX = '/api/connectors/github/'
const MAX_JSON_BODY_BYTES = 64 * 1024

function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

// Same trust posture as vite-agent-bridge.js: the connector is a local dev
// surface, never a public listener. GitHub redirects are top-level navigations
// and usually carry no Origin header, so Host remains the primary callback gate.
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
  const configured = String(process.env.EVEGLYPH_GITHUB_REDIRECT_URI || '').trim()
  if (configured) return configured
  const host = String(req.headers.host || '').trim()
  return `http://${host}/api/connectors/github/callback`
}

function methodNotAllowed(res) {
  writeJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } })
}

function badRequest(res, code, message) {
  writeJson(res, 400, { error: { code, message } })
}

export function githubConnectorBridge({
  clientId = process.env.EVEGLYPH_GITHUB_CLIENT_ID || '',
  clientSecret = process.env.EVEGLYPH_GITHUB_CLIENT_SECRET || '',
  fetchImpl = globalThis.fetch,
  broker: injectedBroker = null,
} = {}) {
  const broker = injectedBroker || createMemoryCredentialBroker()
  const oauth = createGitHubAppOAuth({ clientId, clientSecret, fetchImpl })
  const service = createGitHubConnectorService({ broker, oauth, fetchImpl })
  const controller = createGitHubConnectorHttpController({ service })

  return {
    name: 'eveglyph-github-connector',
    apply: 'serve',
    configureServer(server) {
      // Persistent brokers can restore provider identity at process startup.
      // Session capability grants are intentionally not persisted by the
      // service, so restoreAuth always comes back with grants=[].
      if (typeof broker.restoreActive === 'function') {
        try {
          const restored = broker.restoreActive('github')
          if (restored?.credential_id) service.restoreAuth({ credentialId: restored.credential_id })
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'credential_restore_failed'
          console.warn(`[EveGlyph] GitHub credential restore unavailable (${code})`)
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const parsed = new URL(req.url || '/', 'http://localhost')
        if (!parsed.pathname.startsWith(ROUTE_PREFIX)) return next()

        if (!isLocalRequest(req)) {
          writeJson(res, 403, { error: { code: 'local_request_required', message: 'GitHub connector API is local-only.' } })
          return
        }

        try {
          if (parsed.pathname === '/api/connectors/github/status') {
            if (req.method !== 'GET') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.status())
          }

          if (parsed.pathname === '/api/connectors/github/auth/start') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.startAuth({ redirectUri: requestRedirectUri(req) }))
          }

          if (parsed.pathname === '/api/connectors/github/callback') {
            if (req.method !== 'GET') return methodNotAllowed(res)
            return writeControllerResponse(res, await controller.callback({
              code: parsed.searchParams.get('code') || '',
              state: parsed.searchParams.get('state') || '',
            }))
          }

          if (parsed.pathname === '/api/connectors/github/disconnect') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            return writeControllerResponse(res, controller.disconnect())
          }

          if (parsed.pathname === '/api/connectors/github/grant-read') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            const body = await readJsonBody(req)
            return writeControllerResponse(res, controller.grantRead({ repository: body.repository }))
          }

          if (parsed.pathname === '/api/connectors/github/read-file') {
            if (req.method !== 'POST') return methodNotAllowed(res)
            const body = await readJsonBody(req)
            return writeControllerResponse(res, await controller.readFile({
              repository: body.repository,
              path: body.path,
              ref: body.ref,
            }))
          }

          writeJson(res, 404, { error: { code: 'not_found', message: 'GitHub connector route not found.' } })
        } catch (error) {
          if (error?.code === 'request_body_too_large') {
            writeJson(res, 413, { error: { code: 'request_body_too_large', message: 'Request body too large.' } })
            return
          }
          if (error?.code === 'invalid_json') {
            badRequest(res, 'invalid_json', 'Request body must be valid JSON.')
            return
          }
          writeJson(res, 500, { error: { code: 'internal_error', message: 'Internal GitHub connector error.' } })
        }
      })
    },
  }
}
