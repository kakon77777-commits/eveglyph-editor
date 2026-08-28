// ─── EveGlyph Editor — MCP server (local, stdio) ───────────────────────────
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer, resolveWorkspaceRootOrExit } from './mcp-server-factory.js'

const WORKSPACE_ROOT = await resolveWorkspaceRootOrExit(process.argv, 'usage: node mcp-server.js <workspace-root>')
const DELEGATION_ENDPOINT = String(process.env.EVEGLYPH_DELEGATION_ENDPOINT || '').trim() || null

const server = createMcpServer(WORKSPACE_ROOT, { delegationEndpoint: DELEGATION_ENDPOINT })
const transport = new StdioServerTransport()
await server.connect(transport)
