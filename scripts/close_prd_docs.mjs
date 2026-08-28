import { readFile, writeFile } from 'node:fs/promises'

async function insertBefore(file, heading, marker, block) {
  let text = await readFile(file, 'utf8')
  if (text.includes(heading)) return false
  if (!text.includes(marker)) throw new Error(`${file}: insertion marker not found`)
  text = text.replace(marker, `${block}\n\n${marker}`)
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

const changed = []
if (await insertBefore('README.md', '## Persistent credential vault and delegation\n', '## How it works\n', readmeBlock)) changed.push('README.md')
if (await insertBefore('SECURITY.md', '## Persistent credential vault and delegation boundary\n', '## GitHub connector credential boundary\n', securityBlock)) changed.push('SECURITY.md')

console.log(changed.length ? `Updated: ${changed.join(', ')}` : 'PR-D documentation markers already present')
