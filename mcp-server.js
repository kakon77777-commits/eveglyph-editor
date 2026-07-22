// ─── EveGlyph Editor — MCP server (local, stdio) ───────────────────────────
// Thin stdio entry point. The actual tool set (list_files/read_file/
// write_file/evaluate_aimdc/validate_world_ir) lives in mcp-tools.js, shared
// with mcp-server-remote.js (the tunnel-reachable HTTP entry point) — the
// two files differ only in *how* a client reaches this server, not in what
// it can do.
//
// Separate from vite-agent-bridge.js on purpose: the bridge is a Vite
// dev-server plugin (HTTP, localhost-gated, only alive while `npm run dev` +
// a browser tab are both running); this is a standalone process an MCP host
// spawns directly. There is no diff-review layer here — an MCP host already
// gates each tool call through its own human-approval UI, which serves the
// same "human in the loop" role the bridge's Accept/Reject diff view serves
// for autonomous CLI agents.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer, resolveWorkspaceRootOrExit } from './mcp-tools.js'

const WORKSPACE_ROOT = await resolveWorkspaceRootOrExit(process.argv, 'usage: node mcp-server.js <workspace-root>')

const server = createMcpServer(WORKSPACE_ROOT)
const transport = new StdioServerTransport()
await server.connect(transport)
