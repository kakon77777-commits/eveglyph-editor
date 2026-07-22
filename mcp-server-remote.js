// ─── EveGlyph Editor — MCP server (remote, HTTP + bearer token) ────────────
// Same tool set as mcp-server.js (see mcp-tools.js), reachable over HTTP
// instead of stdio — so a client that isn't on this machine (a remote MCP
// connector, a cheap chat client, etc.) can reach it too, per Neo's request
// (2026-07-22): "遠端連線要做的" (remote connectivity needs to be built).
//
// This process only ever binds to 127.0.0.1 — it is never directly
// internet-facing. Reachability from outside this machine comes from
// tunneling a public hostname to this port yourself (e.g. `cloudflared
// tunnel --url http://127.0.0.1:8787`), the same "don't bind 0.0.0.0"
// discipline vite-agent-bridge.js's own SECURITY.md already documents for
// the dev server (--host caveat) — the tunnel is the one intended path in,
// not an open listener.
//
// Bearer-token auth is REQUIRED (the process refuses to start without
// EVEGLYPH_MCP_TOKEN set) — unlike stdio mode, anyone who reaches this port
// isn't already implied to be "you, on your own machine": once tunneled,
// the URL is internet-reachable, so the token is the only thing standing
// between "an MCP client you configured" and "anyone who finds the URL."
// There is still no diff-review layer (same reasoning as mcp-server.js) —
// worth remembering that a leaked token now means direct, un-reviewed
// remote file writes, a real trade-off documented in SECURITY.md, not
// glossed over.
import http from 'node:http'
import crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer, resolveWorkspaceRootOrExit } from './mcp-tools.js'

const WORKSPACE_ROOT = await resolveWorkspaceRootOrExit(process.argv, 'usage: node mcp-server-remote.js <workspace-root>')

const TOKEN = process.env.EVEGLYPH_MCP_TOKEN
if (!TOKEN || TOKEN.length < 16) {
  console.error('EVEGLYPH_MCP_TOKEN env var is required (16+ chars) — generate one with:')
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  process.exit(1)
}
const PORT = Number(process.env.EVEGLYPH_MCP_PORT) || 8787

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : undefined) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function rpcError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

// Constant-time compare so a wrong-length or wrong-content guess can't be
// timed to narrow down the real token.
function tokenMatches(presented) {
  const a = Buffer.from(String(presented))
  const b = Buffer.from(TOKEN)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const httpServer = http.createServer(async (req, res) => {
  if (req.url !== '/mcp') { res.writeHead(404).end(); return }

  const authHeader = req.headers['authorization'] || ''
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!presented || !tokenMatches(presented)) {
    rpcError(res, 401, -32000, 'Unauthorized')
    return
  }

  if (req.method !== 'POST') {
    rpcError(res, 405, -32000, 'Method not allowed — this server only accepts POST /mcp (stateless mode, no session-based GET/DELETE stream).')
    return
  }

  // Stateless mode, one fresh server+transport per request (mirrors the
  // SDK's own simpleStatelessStreamableHttp example): this is a
  // single-tunnel, single-user deployment, not a multi-session service —
  // no session map to manage or leak.
  let server, transport
  try {
    const body = await readJsonBody(req)
    server = createMcpServer(WORKSPACE_ROOT)
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    res.on('close', () => { transport.close(); server.close() })
  } catch (e) {
    console.error('MCP request error:', e)
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error')
  }
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.error(`EveGlyph MCP remote server listening on http://127.0.0.1:${PORT}/mcp`)
  console.error(`Workspace: ${WORKSPACE_ROOT}`)
  console.error('This binds to loopback only — expose it with a tunnel (e.g. cloudflared) to reach it from elsewhere.')
})
