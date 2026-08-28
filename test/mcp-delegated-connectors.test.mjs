import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createDelegationBroker } from '../server/credentials/delegation-broker.js'
import { createDelegationIpcServer } from '../server/credentials/delegation-ipc.js'
import { resolveDelegatedOperation } from '../server/connectors/delegated-contracts.js'

function endpoint() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\eveglyph-mcp-e2e-${process.pid}-${randomUUID()}`
  return path.join(os.tmpdir(), `eveglyph-mcp-e2e-${process.pid}-${randomUUID()}.sock`)
}

function textJson(result) {
  const text = result.content?.find(item => item.type === 'text')?.text
  assert.ok(text, 'tool result must include JSON text content')
  return JSON.parse(text)
}

async function createClient(workspace, delegationEndpoint = null) {
  const env = { ...process.env }
  if (delegationEndpoint) env.EVEGLYPH_DELEGATION_ENDPOINT = delegationEndpoint
  else delete env.EVEGLYPH_DELEGATION_ENDPOINT
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp-server.js'), workspace], env })
  const client = new Client({ name: 'eveglyph-delegation-test', version: '1.0.0' })
  await client.connect(transport)
  return client
}

test('stdio MCP registers delegated tools only with endpoint and one-use ticket executes once', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-mcp-delegated-'))
  const broker = createDelegationBroker()
  let handlerCalls = 0
  const socket = createDelegationIpcServer({
    delegationBroker: broker,
    endpoint: endpoint(),
    handlers: {
      'github:read-file': async ({ delegation, input }) => {
        handlerCalls += 1
        return { repository: input.repository, path: input.path, content: 'delegated hello', actor: delegation.actor }
      },
    },
  })
  await socket.start()
  let client
  try {
    const operation = resolveDelegatedOperation('github_read_file_delegated', { repository: 'owner/repo', path: 'README.md' })
    const issued = broker.issue({
      provider: operation.provider,
      operation: operation.operation,
      capability: operation.capability,
      resource: operation.resource,
      actor: 'github:user:42',
    })

    client = await createClient(workspace, socket.endpoint)
    const names = (await client.listTools()).tools.map(tool => tool.name)
    assert.equal(names.includes('github_read_file_delegated'), true)
    assert.equal(names.includes('google_drive_list_files_delegated'), true)
    assert.equal(names.includes('google_drive_read_file_delegated'), true)

    const first = textJson(await client.callTool({
      name: 'github_read_file_delegated',
      arguments: {
        delegation_ticket: issued.ticket,
        repository: 'owner/repo',
        path: 'README.md',
      },
    }))
    assert.equal(first.content, 'delegated hello')
    assert.equal(JSON.stringify(first).includes(issued.ticket), false)
    assert.equal(handlerCalls, 1)

    const replay = await client.callTool({
      name: 'github_read_file_delegated',
      arguments: {
        delegation_ticket: issued.ticket,
        repository: 'owner/repo',
        path: 'README.md',
      },
    })
    assert.equal(replay.isError, true)
    assert.equal(replay.content[0].text.includes('delegation_not_found'), true)
    assert.equal(handlerCalls, 1)
  } finally {
    await client?.close().catch(() => {})
    await socket.stop()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('stdio MCP without delegation endpoint keeps existing tools but omits connector delegation tools', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-mcp-no-delegation-'))
  let client
  try {
    client = await createClient(workspace)
    const names = (await client.listTools()).tools.map(tool => tool.name)
    assert.equal(names.includes('read_file'), true)
    assert.equal(names.includes('render_document'), true)
    assert.equal(names.includes('github_read_file_delegated'), false)
    assert.equal(names.includes('google_drive_list_files_delegated'), false)
    assert.equal(names.includes('google_drive_read_file_delegated'), false)
  } finally {
    await client?.close().catch(() => {})
    await rm(workspace, { recursive: true, force: true })
  }
})
