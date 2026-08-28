import { createMcpServer as createBaseMcpServer, resolveWorkspaceRootOrExit } from './mcp-tools.js'
import { registerPublicationMcp } from './mcp-publication.js'
import { registerDelegatedConnectorMcp } from './mcp-connectors.js'
import { registerWasmSandboxMcp } from './mcp-wasm-sandbox.js'
import { createDocumentWasmService } from './server/sandbox/document-wasm-service.js'
import { createWasmtimeRuntime } from './server/sandbox/wasmtime-runtime.js'

export { resolveWorkspaceRootOrExit }

export function createMcpServer(workspaceRoot, {
  delegationEndpoint = null,
  wasmService = null,
} = {}) {
  const server = createBaseMcpServer(workspaceRoot)
  registerPublicationMcp(server, { workspaceRoot })
  if (delegationEndpoint) registerDelegatedConnectorMcp(server, { delegationEndpoint })

  const documentWasmService = wasmService || createDocumentWasmService({
    runtime: createWasmtimeRuntime(),
  })
  registerWasmSandboxMcp(server, { wasmService: documentWasmService })
  return server
}
