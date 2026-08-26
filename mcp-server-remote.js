// ─── EveGlyph Editor — MCP server (remote, HTTP + bearer token) ────────────
// Same capability set as mcp-server.js, reachable over HTTP instead of stdio.
// Base workspace tools and publication tools are composed by
// mcp-server-factory.js so transports cannot drift apart.
//
// This process only ever binds to 127.0.0.1 — it is never directly
// internet-facing. Reachability from outside this machine comes from
// tunneling a public hostname to this port yourself (e.g. `cloudflared
// tunnel --url http://127.0.0.1:8787`).
//
// Bearer-token auth is REQUIRED. Once tunneled, a leaked token means direct
// access to every MCP capability exposed for the selected workspace, so keep
// the token secret and review SECURITY.md before remote use.
import http from 'node:http'
import crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer, resolveWorkspaceRootOrExit } from './mcp-server-factory.js'

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

  // Stateless HTTP transport: one server instance per request. Publication
  // artifacts live in a module/process-scoped store, not inside this server
  // instance, so a later resources/read request can retrieve a prior render
  // while this MCP process remains alive.
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
