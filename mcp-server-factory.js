import { createMcpServer as createBaseMcpServer, resolveWorkspaceRootOrExit } from './mcp-tools.js'
import { registerPublicationMcp } from './mcp-publication.js'
import { registerDelegatedConnectorMcp } from './mcp-connectors.js'

export { resolveWorkspaceRootOrExit }

export function createMcpServer(workspaceRoot, { delegationEndpoint = null } = {}) {
  const server = createBaseMcpServer(workspaceRoot)
  registerPublicationMcp(server, { workspaceRoot })
  if (delegationEndpoint) registerDelegatedConnectorMcp(server, { delegationEndpoint })
  return server
}
