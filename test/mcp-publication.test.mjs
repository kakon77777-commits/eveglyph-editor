import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const fixtureUrl = new URL('./fixtures/publication-zh.md', import.meta.url)

function textJson(result) {
  const text = result.content?.find(item => item.type === 'text')?.text
  assert.ok(text, 'tool result must include JSON text content')
  return JSON.parse(text)
}

test('MCP renders and retrieves an EveGlyph PDF artifact', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-mcp-publication-'))
  const source = await readFile(fixtureUrl, 'utf8')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp-server.js'), workspace],
  })
  const client = new Client({ name: 'eveglyph-publication-test', version: '1.0.0' })

  try {
    await client.connect(transport)

    const capabilities = textJson(await client.callTool({
      name: 'get_publication_capabilities',
      arguments: {},
    }))
    assert.ok(capabilities.profiles.some(p => p.id === 'evemiss-academic-v1'))

    const rendered = textJson(await client.callTool({
      name: 'render_document',
      arguments: {
        source,
        source_format: 'eveglyph-md',
        profile: 'evemiss-academic-v1',
        output_format: 'pdf',
        filename: '中文論文.pdf',
      },
    }))

    assert.match(rendered.artifact_id, /^[0-9a-f-]{36}$/)
    assert.match(rendered.resource_uri, /^eveglyph-artifact:\/\//)
    assert.equal(rendered.mime_type, 'application/pdf')

    const resource = await client.readResource({ uri: rendered.resource_uri })
    const item = resource.contents[0]
    assert.equal(item.mimeType, 'application/pdf')
    const bytes = Buffer.from(item.blob, 'base64')
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-')

    const report = textJson(await client.callTool({
      name: 'get_render_report',
      arguments: { artifact_id: rendered.artifact_id },
    }))
    assert.equal(report.artifact_sha256, rendered.artifact_sha256)
    assert.equal(report.profile, 'evemiss-academic-v1')
  } finally {
    await client.close().catch(() => {})
    await rm(workspace, { recursive: true, force: true })
  }
})
