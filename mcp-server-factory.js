import { createMcpServer as createBaseMcpServer, resolveWorkspaceRootOrExit } from './mcp-tools.js'
import { registerPublicationMcp } from './mcp-publication.js'

export { resolveWorkspaceRootOrExit }

export function createMcpServer(workspaceRoot) {
  const server = createBaseMcpServer(workspaceRoot)
  registerPublicationMcp(server, { workspaceRoot })
  return server
}
