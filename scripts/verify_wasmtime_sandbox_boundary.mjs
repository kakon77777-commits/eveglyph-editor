import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { buildWasmtimeArgs, buildWasmtimeChildEnv } from '../server/sandbox/wasmtime-runtime.js'
import { WASI_STDIO_JSON_ALLOWED_IMPORTS } from '../server/sandbox/wasi-import-policy.js'
import { normalizeSandboxLimits } from '../server/sandbox/limits.js'
import { registerWasmSandboxMcp } from '../mcp-wasm-sandbox.js'

const root = process.cwd()
const read = relative => readFile(path.join(root, relative), 'utf8')

const limits = normalizeSandboxLimits({})
const args = buildWasmtimeArgs('module.wasm', limits)
const joinedArgs = args.join(' ')

for (const forbidden of [
  '--dir', '--env', 'inherit-env', 'inherit-network', '--tcplisten', '--allow-precompiled',
]) {
  assert.equal(joinedArgs.includes(forbidden), false, `Wasmtime argv exposes forbidden authority flag ${forbidden}`)
}
for (const required of [
  'fuel=10000000',
  'max-memory-size=33554432',
  'max-wasm-stack=1048576',
  'max-instances=1',
  'max-memories=1',
  'max-tables=1',
  'trap-on-grow-failure=y',
  'timeout=2000ms',
]) {
  assert.equal(joinedArgs.includes(required), true, `Wasmtime argv is missing ${required}`)
}
assert.equal(args.at(-1), 'module.wasm')

const parentEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/secret-user',
  USERPROFILE: 'C:\\Users\\secret',
  EVEGLYPH_GITHUB_CLIENT_SECRET: 'github-secret',
  EVEGLYPH_GOOGLE_CLIENT_SECRET: 'google-secret',
  EVEGLYPH_MCP_TOKEN: 'mcp-secret',
  OPENAI_API_KEY: 'openai-secret',
  GITHUB_TOKEN: 'github-token',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AZURE_CLIENT_SECRET: 'azure-secret',
  SSH_AUTH_SOCK: '/secret/socket',
  ARBITRARY_PARENT_VALUE: 'forbidden',
}
const linuxEnv = buildWasmtimeChildEnv(parentEnv, '/private/eveglyph-run', 'linux', { includePath: true })
assert.deepEqual(linuxEnv, { PATH: '/usr/bin:/bin', TMPDIR: '/private/eveglyph-run' })
const explicitLinuxEnv = buildWasmtimeChildEnv(parentEnv, '/private/eveglyph-run', 'linux', { includePath: false })
assert.deepEqual(explicitLinuxEnv, { TMPDIR: '/private/eveglyph-run' })

assert.deepEqual([...WASI_STDIO_JSON_ALLOWED_IMPORTS].sort(), [
  'wasi_snapshot_preview1.fd_read',
  'wasi_snapshot_preview1.fd_write',
  'wasi_snapshot_preview1.proc_exit',
].sort())

const sandboxDir = path.join(root, 'server', 'sandbox')
const sandboxFiles = (await readdir(sandboxDir))
  .filter(name => name.endsWith('.js'))
  .sort()

const forbiddenSandboxNeedles = [
  '@napi-rs/keyring',
  'persistent-broker',
  'memory-broker',
  'github-service',
  'google-drive-service',
  'delegation-broker',
  'delegation-ipc',
  'api.github.com',
  'googleapis.com',
  'oauth',
]
for (const name of sandboxFiles) {
  const source = await read(`server/sandbox/${name}`)
  for (const needle of forbiddenSandboxNeedles) {
    assert.equal(source.toLowerCase().includes(needle.toLowerCase()), false, `server/sandbox/${name} references forbidden authority ${needle}`)
  }
}

const runtimeSource = await read('server/sandbox/wasmtime-runtime.js')
assert.match(runtimeSource, /shell:\s*false/)
assert.match(runtimeSource, /mkdtemp/)
assert.match(runtimeSource, /finally\s*\{[\s\S]*?fs\.rm\(runDir/)
assert.doesNotMatch(runtimeSource, /https?:\/\//)
assert.doesNotMatch(runtimeSource, /download|curl\s|wget\s/i)

let captured = null
const fakeServer = {
  registerTool(name, config, handler) {
    if (name === 'execute_wasm_document') captured = { config, handler }
  },
}
registerWasmSandboxMcp(fakeServer, { wasmService: { execute: async () => ({}) } })
assert.ok(captured, 'execute_wasm_document registration missing')
const schemaKeys = Object.keys(captured.config.inputSchema || {}).sort()
assert.deepEqual(schemaKeys, ['input', 'limits', 'module_base64'])
for (const forbidden of [
  'module_path', 'workspace_path', 'preopen_dir', 'env', 'network',
  'command', 'shell', 'args', 'credential', 'credential_id', 'delegation_ticket',
]) {
  assert.equal(schemaKeys.includes(forbidden), false, `MCP sandbox schema exposes ${forbidden}`)
}

const mcpSource = await read('mcp-wasm-sandbox.js')
for (const forbidden of ['@napi-rs/keyring', 'persistent-broker', 'memory-broker', 'github-service', 'google-drive-service']) {
  assert.equal(mcpSource.includes(forbidden), false, `mcp-wasm-sandbox.js references ${forbidden}`)
}

const srcDir = path.join(root, 'src')
const browserFiles = (await readdir(srcDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
for (const entry of browserFiles) {
  const source = await read(`src/${entry.name}`)
  assert.equal(source.includes('execute_wasm_document'), false, `browser source ${entry.name} unexpectedly wires Wasmtime execution`)
}

console.log(`Wasmtime physical sandbox boundary verification PASS (${sandboxFiles.length} sandbox modules checked)`)
