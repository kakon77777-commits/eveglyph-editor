import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const read = file => readFile(path.join(root, file), 'utf8')

async function collectFiles(dir, predicate) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collectFiles(full, predicate))
    else if (predicate(full)) out.push(full)
  }
  return out
}

const delegatedFiles = [
  'mcp-connectors.js',
  'server/credentials/delegation-ipc-client.js',
  'server/connectors/delegated-contracts.js',
]

for (const file of delegatedFiles) {
  const source = await read(file)
  for (const needle of [
    '@napi-rs/keyring',
    'system-keyring-vault',
    'persistent-broker',
    'memory-broker',
    'createGitHubAppOAuth',
    'createGoogleOAuth',
    'api.github.com',
    'googleapis.com',
    'accessToken',
    'refreshToken',
    'clientSecret',
    'credentialEnvelope',
  ]) {
    assert.equal(source.includes(needle), false, `${file} crosses delegated-operation boundary: ${needle}`)
  }
}

const mcpConnectors = await read('mcp-connectors.js')
for (const tool of [
  'github_read_file_delegated',
  'google_drive_list_files_delegated',
  'google_drive_read_file_delegated',
]) {
  assert.equal(mcpConnectors.includes(tool), true, `missing delegated MCP tool: ${tool}`)
}
assert.equal(mcpConnectors.includes('delegation_ticket'), true, 'delegated tools must require a delegation ticket')
assert.equal(/jsonResult\([^)]*delegation_ticket/.test(mcpConnectors), false, 'delegation ticket must never be echoed in MCP result')

const factory = await read('mcp-server-factory.js')
assert.match(factory, /if \(delegationEndpoint\) registerDelegatedConnectorMcp/, 'delegated tools must be conditional on endpoint')
const stdio = await read('mcp-server.js')
const remote = await read('mcp-server-remote.js')
assert.match(stdio, /EVEGLYPH_DELEGATION_ENDPOINT/)
assert.match(remote, /EVEGLYPH_DELEGATION_ENDPOINT/)

for (const [file, source] of [['mcp-server.js', stdio], ['mcp-server-remote.js', remote]]) {
  for (const needle of ['@napi-rs/keyring', 'persistent-broker', 'system-keyring-vault', 'accessToken', 'refreshToken', 'credentialEnvelope']) {
    assert.equal(source.includes(needle), false, `${file} crosses credential boundary: ${needle}`)
  }
}

const bridge = await read('vite-agent-bridge.js')
const spawnStart = bridge.indexOf("const scriptPath = path.join(BRIDGE_DIR, 'mcp-server-remote.js')")
assert.notEqual(spawnStart, -1, 'remote MCP spawn block missing')
const spawnBlock = bridge.slice(spawnStart, spawnStart + 1500)
assert.match(spawnBlock, /EVEGLYPH_DELEGATION_ENDPOINT/)
for (const needle of ['accessToken', 'refreshToken', 'credential_id', 'EVEGLYPH_GITHUB_CLIENT_SECRET', 'EVEGLYPH_GOOGLE_CLIENT_SECRET']) {
  assert.equal(spawnBlock.includes(needle), false, `remote MCP child environment leaks provider material: ${needle}`)
}

for (const file of ['src/githubsettings.js', 'src/googledrivesettings.js']) {
  const source = await read(file)
  assert.equal(/localStorage[\s\S]{0,200}delegation|delegation[\s\S]{0,200}localStorage/.test(source), false, `${file} persists delegation in localStorage`)
  assert.equal(/sessionStorage[\s\S]{0,200}delegation|delegation[\s\S]{0,200}sessionStorage/.test(source), false, `${file} persists delegation in sessionStorage`)
}

const distRoot = path.join(root, 'dist')
const builtFiles = await collectFiles(distRoot, file => /\.(?:html|js)$/i.test(file))
assert.ok(builtFiles.length > 0, 'run npm run build before MCP delegation boundary verification')
for (const file of builtFiles) {
  const source = await readFile(file, 'utf8')
  for (const pattern of [/\baccessToken\b/, /\brefreshToken\b/, /credentialEnvelope/, /@napi-rs\/keyring/]) {
    assert.equal(pattern.test(source), false, `${path.relative(root, file)} contains credential material ${pattern}`)
  }
}

console.log(`MCP delegation boundary verification PASS (${delegatedFiles.length} delegated sources, ${builtFiles.length} built files checked)`)
