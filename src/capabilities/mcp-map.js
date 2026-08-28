import { createCapabilityRequest } from './model.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function workspaceResource(path) {
  if (typeof path !== 'string' || !path.trim()) return 'workspace:*'
  return `workspace:${path.trim()}`
}

function artifactResource(artifactId) {
  if (typeof artifactId !== 'string' || !artifactId.trim()) return 'artifact:*'
  return `artifact:${artifactId.trim()}`
}

const TOOL_REQUEST_BUILDERS = Object.freeze({
  list_files: () => [
    ['workspace.read', 'workspace:*'],
  ],
  read_file: args => [
    ['workspace.read', workspaceResource(args?.path)],
  ],
  write_file: args => [
    ['workspace.write', workspaceResource(args?.path)],
  ],
  evaluate_aimdc: () => [
    ['document.read.self', 'document:self'],
    ['document.compute', 'document:self'],
    ['ephemeral.output', 'execution:aimdc'],
  ],
  validate_world_ir: () => [
    ['document.read.self', 'document:self'],
    ['document.compute', 'document:self'],
  ],
  get_publication_capabilities: () => [
    ['document.read.self', 'document:self'],
  ],
  inspect_document: () => [
    ['document.read.self', 'document:self'],
    ['document.compute', 'document:self'],
  ],
  validate_document: () => [
    ['document.read.self', 'document:self'],
    ['document.compute', 'document:self'],
  ],
  render_document: () => [
    ['document.read.self', 'document:self'],
    ['document.compute', 'document:self'],
    ['ephemeral.output', 'execution:publication'],
  ],
  get_render_artifact: args => [
    ['ephemeral.output', artifactResource(args?.artifact_id)],
  ],
  get_render_report: args => [
    ['ephemeral.output', artifactResource(args?.artifact_id)],
  ],
})

export const MCP_TOOL_CAPABILITY_NAMES = Object.freeze(Object.keys(TOOL_REQUEST_BUILDERS))

export function resolveMcpToolCapabilityRequests(toolName, args = {}) {
  const builder = TOOL_REQUEST_BUILDERS[toolName]
  if (!builder) throw codedError('unknown_mcp_tool', `unknown MCP tool: ${toolName}`)
  return Object.freeze(builder(args).map(([capability, resource]) => createCapabilityRequest({
    capability,
    resource,
    lifetime: 'once',
    reason: `MCP tool ${toolName}`,
    context: { tool: toolName },
  })))
}
