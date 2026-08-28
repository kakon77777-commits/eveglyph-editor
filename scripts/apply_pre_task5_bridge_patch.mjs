import { readFile, writeFile } from 'node:fs/promises'

const file = 'vite-agent-bridge.js'
let text = await readFile(file, 'utf8')

const oldSignature = 'export function agentBridge() {'
const newSignature = 'export function agentBridge({ delegationEndpoint = null } = {}) {'
if (text.includes(oldSignature)) {
  text = text.replace(oldSignature, newSignature)
} else if (!text.includes(newSignature)) {
  throw new Error('agentBridge signature marker not found')
}

const oldSpawn = `        const scriptPath = path.join(BRIDGE_DIR, 'mcp-server-remote.js')
        let child
        try {
          child = spawn(process.execPath, [scriptPath, cwd], {
            env: { ...process.env, EVEGLYPH_MCP_TOKEN: token, EVEGLYPH_MCP_PORT: String(port) },
          })
        } catch (e) {`

const newSpawn = `        const scriptPath = path.join(BRIDGE_DIR, 'mcp-server-remote.js')
        const childEnv = {
          ...process.env,
          EVEGLYPH_MCP_TOKEN: token,
          EVEGLYPH_MCP_PORT: String(port),
          ...(delegationEndpoint ? { EVEGLYPH_DELEGATION_ENDPOINT: delegationEndpoint } : {}),
        }
        let child
        try {
          child = spawn(process.execPath, [scriptPath, cwd], { env: childEnv })
        } catch (e) {`

if (text.includes(oldSpawn)) {
  text = text.replace(oldSpawn, newSpawn)
} else if (!text.includes(newSpawn)) {
  throw new Error('remote MCP spawn marker not found')
}

await writeFile(file, text, 'utf8')
console.log('PR-E remote MCP delegation endpoint patch applied')
