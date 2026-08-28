import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolveMcpToolCapabilityRequests } from '../src/capabilities/mcp-map.js'

const fixture = name => readFile(path.resolve('.tmp/wasmtime-fixtures', `${name}.wasm`))

function textJson(result) {
  const text = result.content?.find(item => item.type === 'text')?.text
  assert.ok(text, 'tool result must contain JSON text')
  return JSON.parse(text)
}

test('execute_wasm_document capability metadata matches the document Wasm service baseline', () => {
  assert.deepEqual(
    resolveMcpToolCapabilityRequests('execute_wasm_document').map(request => [request.capability, request.resource]),
    [
      ['document.read.self', 'document:self'],
      ['document.compute', 'document:self'],
      ['ephemeral.output', 'execution:wasm'],
    ],
  )
})

test('stdio MCP exposes one Wasmtime document tool with no host-path/capability injection surface', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'eveglyph-mcp-wasmtime-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp-server.js'), workspace],
  })
  const client = new Client({ name: 'eveglyph-wasmtime-test', version: '1.0.0' })

  try {
    await client.connect(transport)
    const listed = await client.listTools()
    const tool = listed.tools.find(item => item.name === 'execute_wasm_document')
    assert.ok(tool, 'execute_wasm_document must be registered once in shared MCP')

    const properties = Object.keys(tool.inputSchema?.properties || {})
    assert.deepEqual(properties.sort(), ['input', 'limits', 'module_base64'].sort())
    for (const forbidden of [
      'module_path', 'workspace_path', 'preopen_dir', 'env', 'network',
      'command', 'shell', 'args', 'credential', 'credential_id', 'delegation_ticket',
    ]) {
      assert.equal(properties.includes(forbidden), false, `MCP schema must not expose ${forbidden}`)
    }

    const moduleBytes = await fixture('echo-json')
    const result = textJson(await client.callTool({
      name: 'execute_wasm_document',
      arguments: {
        module_base64: moduleBytes.toString('base64'),
        input: { n: 7, source: 'mcp' },
      },
    }))

    assert.deepEqual(result.result, { n: 7, source: 'mcp' })
    assert.match(result.module_sha256, /^[0-9a-f]{64}$/)
    assert.equal(result.sandbox.runtime, 'wasmtime')
    assert.equal(result.sandbox.runtime_version, '48.0.0')
    assert.equal(result.sandbox.profile, 'wasi-stdio-json')
    assert.equal(result.sandbox.capability.profile, 'document-only')
  } finally {
    await client.close().catch(() => {})
    await rm(workspace, { recursive: true, force: true })
  }
})
