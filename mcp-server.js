// ─── EveGlyph Editor — MCP server (local, stdio) ───────────────────────────
// Thin stdio entry point. Base workspace tools and the publication runtime
// are composed by mcp-server-factory.js so local and remote transports expose
// the same capability surface without duplicating tool implementations.
//
// Separate from vite-agent-bridge.js on purpose: the bridge is a Vite
// dev-server plugin (HTTP, localhost-gated, only alive while `npm run dev` +
// a browser tab are both running); this is a standalone process an MCP host
// spawns directly. There is no diff-review layer here — an MCP host already
// gates each tool call through its own human-approval UI, which serves the
// same "human in the loop" role the bridge's Accept/Reject diff view serves
// for autonomous CLI agents.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer, resolveWorkspaceRootOrExit } from './mcp-server-factory.js'

const WORKSPACE_ROOT = await resolveWorkspaceRootOrExit(process.argv, 'usage: node mcp-server.js <workspace-root>')

const server = createMcpServer(WORKSPACE_ROOT)
const transport = new StdioServerTransport()
await server.connect(transport)
