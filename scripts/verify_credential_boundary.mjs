import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()

async function exists(file) {
  try { await readFile(file); return true } catch { return false }
}

async function collectFiles(dir, predicate) {
  const out = []
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collectFiles(full, predicate))
    else if (predicate(full)) out.push(full)
  }
  return out
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

const publicSettings = [
  path.join(root, 'src', 'githubsettings.js'),
  path.join(root, 'src', 'googledrivesettings.js'),
]
const publicCredentialProperties = [
  /\baccessToken\b/,
  /\brefreshToken\b/,
  /\brefreshExpiresAt\b/,
  /\bclientSecret\b/,
]

for (const file of publicSettings) {
  assert.equal(await exists(file), true, `missing public Settings source: ${relative(file)}`)
  const source = await readFile(file, 'utf8')
  for (const pattern of publicCredentialProperties) {
    assert.equal(pattern.test(source), false, `${relative(file)} exposes raw credential property ${pattern}`)
  }
}

const browserFiles = await collectFiles(path.join(root, 'src'), file => file.endsWith('.js'))
for (const file of browserFiles) {
  const source = await readFile(file, 'utf8')
  for (const needle of [
    '@napi-rs/keyring',
    'system-keyring-vault',
    'persistent-broker',
    'server/credentials/',
    'server\\credentials\\',
  ]) {
    assert.equal(source.includes(needle), false, `${relative(file)} imports or references credential-vault internals: ${needle}`)
  }
}

const rootEntries = await readdir(root, { withFileTypes: true })
const mcpFiles = rootEntries
  .filter(entry => entry.isFile() && /^mcp-.*\.js$/.test(entry.name))
  .map(entry => path.join(root, entry.name))

// PR-E deliberately permits one credential-free local delegation IPC client,
// but MCP must still remain outside credential custody and provider OAuth.
const forbiddenMcpCredentialInternals = [
  '@napi-rs/keyring',
  'system-keyring-vault',
  'persistent-broker',
  'memory-broker',
  'credentials/runtime',
  'credentialRuntime',
  'credential_id',
  'credentialEnvelope',
  'createGitHubAppOAuth',
  'createGoogleOAuth',
]
for (const file of mcpFiles) {
  const source = await readFile(file, 'utf8')
  for (const needle of forbiddenMcpCredentialInternals) {
    assert.equal(source.includes(needle), false, `${relative(file)} crosses credential custody boundary: ${needle}`)
  }
}

const delegatedMcp = path.join(root, 'mcp-connectors.js')
assert.equal(await exists(delegatedMcp), true, 'mcp-connectors.js is required for PR-E')
const delegatedSource = await readFile(delegatedMcp, 'utf8')
assert.match(delegatedSource, /delegation-ipc-client\.js/, 'delegated MCP must use the credential-free local IPC client')
assert.match(delegatedSource, /delegated-contracts\.js/, 'delegated MCP must use the canonical operation contract')
for (const pattern of [/\baccessToken\b/, /\brefreshToken\b/, /\bclientSecret\b/]) {
  assert.equal(pattern.test(delegatedSource), false, `mcp-connectors.js exposes raw credential property ${pattern}`)
}

const distRoot = path.join(root, 'dist')
assert.equal(await exists(path.join(distRoot, 'index.html')), true, 'dist/index.html is required; run npm run build first')
const builtFiles = await collectFiles(distRoot, file => /\.(?:html|js)$/i.test(file))
assert.ok(builtFiles.length > 0, 'build must contain HTML/JavaScript output')

const forbiddenBuiltSecrets = [
  /\baccessToken\b/,
  /\brefreshToken\b/,
  /\brefreshExpiresAt\b/,
  /credential-envelope/i,
]
for (const file of builtFiles) {
  const source = await readFile(file, 'utf8')
  for (const pattern of forbiddenBuiltSecrets) {
    assert.equal(pattern.test(source), false, `${relative(file)} contains credential-envelope material ${pattern}`)
  }
}

console.log(`Credential boundary verification PASS (${browserFiles.length + mcpFiles.length} source files, ${builtFiles.length} built files checked)`)
