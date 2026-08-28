import { readFile, writeFile } from 'node:fs/promises'

async function replaceExact(file, from, to) {
  let text = await readFile(file, 'utf8')
  if (text.includes(to)) return false
  if (!text.includes(from)) throw new Error(`${file}: migration source not found`)
  text = text.replace(from, to)
  await writeFile(file, text, 'utf8')
  return true
}

async function insertBefore(file, marker, heading, block) {
  let text = await readFile(file, 'utf8')
  if (text.includes(heading)) return false
  if (!text.includes(marker)) throw new Error(`${file}: insertion marker not found`)
  text = text.replace(marker, `${block}\n\n${marker}`)
  await writeFile(file, text, 'utf8')
  return true
}

const changed = new Set()

if (await replaceExact(
  'README.md',
  'PR-D also adds short-lived, exact provider/operation/capability/resource delegation tickets and a local `node:net` IPC operation boundary. Raw tickets are not stored (only SHA-256 hashes), default to one use / 60 seconds, and are capped at 10 uses / 300 seconds. **MCP is not connected to this delegation path yet**, so standalone MCP processes still receive no GitHub/Google credentials or persistent broker.',
  'PR-D adds short-lived, exact provider/operation/capability/resource delegation tickets and a local `node:net` IPC operation boundary. PR-E now lets MCP use three read-only connector operations through that boundary without receiving GitHub/Google credentials or the persistent broker. Raw tickets are not stored (only SHA-256 hashes), default to one use / 60 seconds, and every delegated execution re-checks the live connector-session grant.'
)) changed.add('README.md')

if (await replaceExact(
  'README.md',
  'The GitHub and Google Drive connector credentials are deliberately **not** shared into these MCP processes. PR-D now provides hash-only delegation tickets plus a local operation-IPC primitive, but no connector operation is registered with MCP yet; raw provider tokens are never copied into MCP processes.',
  'The GitHub and Google Drive connector credentials are deliberately **not** shared into these MCP processes. When `EVEGLYPH_DELEGATION_ENDPOINT` is configured, PR-E conditionally registers `github_read_file_delegated`, `google_drive_list_files_delegated`, and `google_drive_read_file_delegated`. Those tools carry a short-lived one-use ticket over local IPC; raw provider tokens, keyring objects, and the persistent credential broker never enter MCP. See [`docs/MCP-DELEGATED-CONNECTORS.md`](docs/MCP-DELEGATED-CONNECTORS.md).'
)) changed.add('README.md')

if (await replaceExact(
  'SECURITY.md',
  'The delegation broker issues opaque 32-byte tickets but stores only SHA-256 ticket hashes. Tickets exact-match provider, operation, capability and resource; default to one use / 60 seconds; and are bounded to 10 uses / 300 seconds. The local IPC boundary is limited to 16 KiB requests and blocks credential-shaped results. PR-D does not wire this IPC into MCP, so MCP remains outside the credential-owning process.',
  'The delegation broker issues opaque 32-byte tickets but stores only SHA-256 ticket hashes. Tickets exact-match provider, operation, capability and resource; default to one use / 60 seconds; and are bounded to 10 uses / 300 seconds. The local IPC boundary is limited to 16 KiB requests and blocks credential-shaped results. PR-E permits MCP to use only the credential-free local IPC client for three read-only delegated connector operations; MCP still remains outside credential custody and receives no keyring, persistent broker, access token, refresh token, or provider OAuth client.'
)) changed.add('SECURITY.md')

if (await replaceExact(
  'SECURITY.md',
  'The persistent credential broker is **not shared with `mcp-server.js` or `mcp-server-remote.js`**. Those are separate processes. PR-D adds a local delegation-ticket/IPC primitive but registers no connector operation with MCP, so raw credentials are not copied across that boundary merely to make MCP calls work.',
  'The persistent credential broker is **not shared with `mcp-server.js` or `mcp-server-remote.js`**. Those are separate processes. PR-E registers only three read-only delegated MCP operations when a local delegation endpoint is configured. MCP sends a short-lived ticket plus canonical operation input to the local broker; the credential-owning process recomputes the resource, consumes the ticket, re-checks the live connector grant, and performs the provider request. Raw credentials are never copied across the process boundary.'
)) changed.add('SECURITY.md')

const section = `## MCP delegated connector boundary

PR-E adds exactly three read-only delegated MCP tools: \`github_read_file_delegated\`, \`google_drive_list_files_delegated\`, and \`google_drive_read_file_delegated\`. They are registered only when \`EVEGLYPH_DELEGATION_ENDPOINT\` points to the live local delegation server owned by EveGlyph.

A delegated execution requires both a valid short-lived ticket and the matching live connector-session grant. The IPC handler normalizes the tool input again and recomputes the canonical resource before calling the live connector service, preventing a ticket issued for file A from being paired with input for file B. The connector service then performs its normal capability decision again before credential access or provider network I/O.

The MCP process may import the credential-free delegated-operation contract and local IPC client. It must not import or receive the OS keyring, persistent credential broker, provider OAuth clients, access tokens, refresh tokens, client secrets, or credential envelopes. Settings may show a newly issued one-use ticket in live DOM state, but EveGlyph does not persist it. Third-party MCP hosts may log tool arguments, so tickets should be treated as temporary operation authority.

Remote MCP keeps its existing bearer-token transport authentication; PR-E does not upgrade it to OAuth. See [\`docs/MCP-DELEGATED-CONNECTORS.md\`](docs/MCP-DELEGATED-CONNECTORS.md) for the operator flow and full boundary.`

if (await insertBefore('SECURITY.md', '## GitHub connector credential boundary\n', '## MCP delegated connector boundary\n', section)) changed.add('SECURITY.md')

console.log(changed.size ? `Updated: ${[...changed].join(', ')}` : 'PR-E docs already current')
