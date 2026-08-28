import { readFile, writeFile } from 'node:fs/promises'

async function insertBefore(file, heading, marker, block) {
  let text = await readFile(file, 'utf8')
  if (text.includes(heading)) return false
  if (!text.includes(marker)) throw new Error(`${file}: insertion marker not found`)
  text = text.replace(marker, `${block}\n\n${marker}`)
  await writeFile(file, text, 'utf8')
  return true
}

async function replaceExact(file, from, to) {
  let text = await readFile(file, 'utf8')
  if (text.includes(to)) return false
  if (!text.includes(from)) throw new Error(`${file}: migration source not found: ${from.slice(0, 80)}`)
  text = text.replace(from, to)
  await writeFile(file, text, 'utf8')
  return true
}

const readmeBlock = `## Persistent credential vault and delegation

Connector credentials now use a provider-neutral credential runtime. The default \`EVEGLYPH_CREDENTIAL_STORE=system\` stores GitHub/Google OAuth credential envelopes in the operating-system keyring through \`@napi-rs/keyring\`; \`EVEGLYPH_CREDENTIAL_STORE=memory\` is the only supported explicit non-persistent fallback. Keyring failure fails closed — EveGlyph does not silently write tokens to plaintext files, browser storage, the workspace, or \`.eveglyph/\`.

Restart restoration brings back provider identity only. GitHub repository grants and Google Drive metadata/file grants remain session-only and must be explicitly granted again.

PR-D also adds short-lived, exact provider/operation/capability/resource delegation tickets and a local \`node:net\` IPC operation boundary. Raw tickets are not stored (only SHA-256 hashes), default to one use / 60 seconds, and are capped at 10 uses / 300 seconds. **MCP is not connected to this delegation path yet**, so standalone MCP processes still receive no GitHub/Google credentials or persistent broker.

See [\`docs/CREDENTIAL-VAULT-AND-DELEGATION.md\`](docs/CREDENTIAL-VAULT-AND-DELEGATION.md) and [\`SECURITY.md\`](SECURITY.md).`

const securityBlock = `## Persistent credential vault and delegation boundary

GitHub and Google connector credentials can now persist through a provider-neutral OS-keyring broker. \`system\` is the default credential-store mode; \`memory\` must be selected explicitly. A system-keyring outage fails closed as \`credential_vault_unavailable\` and is mapped to a redacted HTTP 503. There is no automatic plaintext, workspace, browser-storage, or in-memory downgrade.

Persistence applies to provider credential envelopes only. EveGlyph connector capability grants are never restored: after restart, provider identity may be restored but GitHub repository and Google Drive metadata/file authority return to zero until the user grants them again.

The delegation broker issues opaque 32-byte tickets but stores only SHA-256 ticket hashes. Tickets exact-match provider, operation, capability and resource; default to one use / 60 seconds; and are bounded to 10 uses / 300 seconds. The local IPC boundary is limited to 16 KiB requests and blocks credential-shaped results. PR-D does not wire this IPC into MCP, so MCP remains outside the credential-owning process.

See [\`docs/CREDENTIAL-VAULT-AND-DELEGATION.md\`](docs/CREDENTIAL-VAULT-AND-DELEGATION.md) for the complete operator and trust-boundary contract.`

const changed = new Set()
if (await insertBefore('README.md', '## Persistent credential vault and delegation\n', '## How it works\n', readmeBlock)) changed.add('README.md')
if (await insertBefore('SECURITY.md', '## Persistent credential vault and delegation boundary\n', '## GitHub connector credential boundary\n', securityBlock)) changed.add('SECURITY.md')

const migrations = [
  ['README.md',
    'The access/refresh token remains in the Node-side process-memory credential broker. Restarting the Vite dev server disconnects GitHub and requires authentication again. This first broker is not shared with the separate MCP server processes.',
    'The provider credential remains inside EveGlyph’s shared credential runtime. In the default `system` mode it is persisted in the OS keyring; after restart GitHub identity can be restored but repository grants return to zero and must be granted again. The credential runtime is still not shared with the separate MCP server processes.'],
  ['README.md',
    '- **GitHub connector bridge** — `vite-github-connector.js` is a separate local Node/Vite plugin. It owns GitHub OAuth callback handling and a process-memory credential broker; browser Settings receives only redacted account/grant/read data.',
    '- **GitHub connector bridge** — `vite-github-connector.js` is a separate local Node/Vite plugin. It uses the shared provider-neutral credential runtime for GitHub OAuth custody; browser Settings receives only redacted account/grant/read data.'],
  ['README.md',
    'The GitHub and Google Drive connector process-memory credentials are deliberately **not** shared into these MCP processes. A later broker IPC/keychain or unified authenticated gateway must define that boundary explicitly rather than copying raw tokens between processes.',
    'The GitHub and Google Drive connector credentials are deliberately **not** shared into these MCP processes. PR-D now provides hash-only delegation tickets plus a local operation-IPC primitive, but no connector operation is registered with MCP yet; raw provider tokens are never copied into MCP processes.'],
  ['SECURITY.md',
    'GitHub credentials are kept in a process-scoped in-memory Node broker. Raw access tokens, refresh tokens, the GitHub client secret, OAuth authorization codes, PKCE verifiers, and Authorization headers are not returned to the browser and are not persisted to:',
    'GitHub credentials are held by the provider-neutral credential runtime. In default `system` mode, the credential envelope is persisted only through the OS keyring and is hot-cached in the Node process. Raw access tokens, refresh tokens, the GitHub client secret, OAuth authorization codes, PKCE verifiers, and Authorization headers are not returned to the browser and are not persisted to:'],
  ['SECURITY.md',
    'The broker exposes redacted descriptions plus a server-side callback interface for trusted connector code; it does not expose a public `getToken()` API. Restarting the Vite dev process destroys the broker state and requires GitHub authentication again.',
    'The broker exposes redacted descriptions plus a server-side callback interface for trusted connector code; it does not expose a public `getToken()` API. In default `system` mode, restarting the Vite dev process can restore GitHub identity from the keyring, but connector-session grants are reset to zero. In explicit `memory` mode, restart still requires authentication again.'],
  ['SECURITY.md',
    'The process-memory GitHub credential broker is **not shared with `mcp-server.js` or `mcp-server-remote.js`**. Those are separate processes. Raw credentials are not copied across that boundary merely to make MCP calls work. A later design may introduce deliberate broker IPC/keychain storage or place remote MCP behind the same authenticated gateway.',
    'The persistent credential broker is **not shared with `mcp-server.js` or `mcp-server-remote.js`**. Those are separate processes. PR-D adds a local delegation-ticket/IPC primitive but registers no connector operation with MCP, so raw credentials are not copied across that boundary merely to make MCP calls work.'],
]

for (const [file, from, to] of migrations) {
  if (await replaceExact(file, from, to)) changed.add(file)
}

console.log(changed.size ? `Updated: ${[...changed].join(', ')}` : 'PR-D documentation already current')
