import { z } from 'zod'

import { resolveDelegatedOperation } from './server/connectors/delegated-contracts.js'
import { invokeDelegatedOperation } from './server/credentials/delegation-ipc-client.js'

const jsonResult = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] })
const errorResult = error => ({
  content: [{
    type: 'text',
    text: `Error [${typeof error?.code === 'string' ? error.code : 'delegation_operation_failed'}]: ${error?.message || 'Delegated connector operation failed.'}`,
  }],
  isError: true,
})

async function invoke(endpoint, toolName, args) {
  const operation = resolveDelegatedOperation(toolName, args)
  return invokeDelegatedOperation({
    endpoint,
    request: {
      method: 'invoke',
      ticket: args.delegation_ticket,
      provider: operation.provider,
      operation: operation.operation,
      capability: operation.capability,
      resource: operation.resource,
      input: operation.input,
    },
  })
}

export function registerDelegatedConnectorMcp(server, { delegationEndpoint } = {}) {
  if (!delegationEndpoint) return false

  server.registerTool('github_read_file_delegated', {
    title: 'Read a GitHub file with one-use delegation',
    description: 'Use a short-lived EveGlyph delegation ticket to read one UTF-8 GitHub repository file without exposing the provider credential to MCP.',
    inputSchema: {
      delegation_ticket: z.string().min(20).describe('Short-lived one-use delegation ticket issued by EveGlyph Settings'),
      repository: z.string().describe('GitHub repository in owner/repo form'),
      path: z.string().describe('Repository-relative file path'),
      ref: z.string().optional().describe('Optional Git ref'),
    },
  }, async args => {
    try { return jsonResult(await invoke(delegationEndpoint, 'github_read_file_delegated', args)) }
    catch (error) { return errorResult(error) }
  })

  server.registerTool('google_drive_list_files_delegated', {
    title: 'List Google Drive files with one-use delegation',
    description: 'Use a short-lived EveGlyph delegation ticket to list bounded Google Drive metadata without exposing the provider credential to MCP.',
    inputSchema: {
      delegation_ticket: z.string().min(20).describe('Short-lived one-use delegation ticket issued by EveGlyph Settings'),
      page_token: z.string().optional().describe('Optional Google Drive pagination token'),
    },
  }, async args => {
    try { return jsonResult(await invoke(delegationEndpoint, 'google_drive_list_files_delegated', args)) }
    catch (error) { return errorResult(error) }
  })

  server.registerTool('google_drive_read_file_delegated', {
    title: 'Read a Google Drive file with one-use delegation',
    description: 'Use a short-lived EveGlyph delegation ticket to read one exact Google Drive file without exposing the provider credential to MCP.',
    inputSchema: {
      delegation_ticket: z.string().min(20).describe('Short-lived one-use delegation ticket issued by EveGlyph Settings'),
      file_id: z.string().describe('Exact Google Drive file id'),
    },
  }, async args => {
    try { return jsonResult(await invoke(delegationEndpoint, 'google_drive_read_file_delegated', args)) }
    catch (error) { return errorResult(error) }
  })

  return true
}
