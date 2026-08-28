import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

function textJson(result) {
  const text = result.content?.find(item => item.type === 'text')?.text
  assert.ok(text, 'tool result must include JSON text content')
  return JSON.parse(text)
}

test('MCP evaluate_aimdc returns document-only sandbox evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-mcp-capability-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp-server.js'), workspace],
  })
  const client = new Client({ name: 'eveglyph-capability-test', version: '1.0.0' })

  try {
    await client.connect(transport)
    const result = textJson(await client.callTool({
      name: 'evaluate_aimdc',
      arguments: {
        content: '::: aimd-value {id="x" type="Number"}\n2\n:::',
      },
    }))

    assert.equal(result.blocks, 1)
    assert.equal(result.sandbox.profile, 'document-only')
    assert.equal(result.sandbox.actor.client, 'eveglyph-mcp')
    assert.equal(result.sandbox.actor.document, 'inline:evaluate_aimdc')
    assert.deepEqual(result.sandbox.audit.map(entry => entry.request.capability), [
      'document.read.self',
      'document.compute',
      'ephemeral.output',
    ])
    assert.equal(result.sandbox.audit.every(entry => entry.decision === 'allow'), true)
  } finally {
    await client.close().catch(() => {})
    await rm(workspace, { recursive: true, force: true })
  }
})
