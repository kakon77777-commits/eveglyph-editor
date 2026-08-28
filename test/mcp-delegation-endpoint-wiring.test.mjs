import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('remote MCP lifecycle receives delegation endpoint explicitly without provider credentials', async () => {
  const bridge = await read('vite-agent-bridge.js')
  const config = await read('vite.config.js')

  assert.match(bridge, /export function agentBridge\(\{[\s\S]*?delegationEndpoint/)
  assert.match(bridge, /EVEGLYPH_DELEGATION_ENDPOINT/)
  assert.match(config, /agentBridge\(\{\s*delegationEndpoint:\s*delegationRuntime\.endpoint\s*\}\)/)

  const remoteSpawn = bridge.match(/spawn\(process\.execPath, \[scriptPath, cwd\],[\s\S]{0,1200}?\n\s*\}\)/)?.[0] || ''
  assert.match(remoteSpawn, /EVEGLYPH_DELEGATION_ENDPOINT/)
  assert.doesNotMatch(remoteSpawn, /accessToken|refreshToken|credential_id|EVEGLYPH_GITHUB_CLIENT_SECRET|EVEGLYPH_GOOGLE_CLIENT_SECRET/)
})

test('GitHub Settings exposes one-use MCP read ticket issuance without persistence', async () => {
  const source = await read('src/githubsettings.js')
  const ui = await read('vite-github-settings-ui.js')
  assert.match(source, /export async function githubIssueMcpReadTicket/)
  assert.match(source, /delegation\/read-file/)
  assert.match(ui, /btn-github-issue-mcp-read/)
  assert.match(ui, /s-github-delegation-result/)
  assert.doesNotMatch(source, /localStorage[\s\S]{0,160}delegation|delegation[\s\S]{0,160}localStorage/)
  assert.doesNotMatch(source, /sessionStorage[\s\S]{0,160}delegation|delegation[\s\S]{0,160}sessionStorage/)
})

test('Google Settings exposes list/file one-use MCP ticket issuance without persistence', async () => {
  const source = await read('src/googledrivesettings.js')
  const ui = await read('vite-google-drive-settings-ui.js')
  assert.match(source, /export async function googleIssueMcpListTicket/)
  assert.match(source, /export async function googleIssueMcpFileReadTicket/)
  assert.match(source, /delegation\/list-files/)
  assert.match(source, /delegation\/read-file/)
  assert.match(ui, /btn-google-issue-mcp-list/)
  assert.match(ui, /btn-google-issue-mcp-file-read/)
  assert.match(ui, /s-google-delegation-result/)
  assert.doesNotMatch(source, /localStorage[\s\S]{0,160}delegation|delegation[\s\S]{0,160}localStorage/)
  assert.doesNotMatch(source, /sessionStorage[\s\S]{0,160}delegation|delegation[\s\S]{0,160}sessionStorage/)
})
