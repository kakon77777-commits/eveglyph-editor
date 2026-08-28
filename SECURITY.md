# Security

EveGlyph Editor is a **local-first developer tool**: it runs on your own machine via the local dev server. This document describes its trust model and the real risks — above all, **local-agent mode**.

## In one line

The bridge is dev-only and localhost-gated. The biggest risk is **by design**: local-agent mode lets a CLI edit your files with auto-approve. You stay in control through a per-workspace confirmation and git-based diff review.

## Capability sandbox foundation

AIMD-C document computation now enters through a provider-neutral capability control plane before the existing pure graph evaluator runs. The default profile is **`document-only`** and contains only:

- `document.read.self` on `document:self`;
- `document.compute` on `document:self`;
- `ephemeral.output` on `execution:*`.

The document runtime does **not** receive filesystem handles, network clients, process-spawn APIs, host environment objects, OAuth credentials, Google credentials, GitHub credentials, or connector clients. Those authorities are represented separately and are denied by default. If a future caller needs authority outside the document boundary, it must make an explicit capability request and obtain a matching resource-scoped grant first.

Capability requests carry a capability id, resource, lifetime, reason, and inert context metadata. Grants require an exact capability match and either an exact resource or a single trailing-`*` prefix scope. Read does not imply write. Unknown capabilities and unknown sandbox profiles fail closed. Expired grants do not authorize, and an explicit `once` grant is consumed after its first successful authorization.

Every allow/deny decision made by a capability session records actor-aware audit evidence: event id, timestamp, actor context, sandbox profile, request, decision, reason, and matching grant source. The actor context can carry the human principal, client, agent, document, and session independently; authentication identity alone is not treated as an execution sandbox.

`src/aimdc/graph.js` intentionally remains a low-level pure evaluator rather than owning security policy. The browser preview and MCP `evaluate_aimdc` call the authority-aware document wrapper. Dynamic Logic projections passed to AIMD-C remain read-only, same-document runtime data and do not become network/provider authority.

`src/capabilities/mcp-map.js` also records the authority requirements of the current base/publication MCP tools. That mapping is **control-plane groundwork**, not a silent behavior change to all existing MCP calls: PR-A does not yet provide a user-facing grant-acquisition/OAuth flow, so workspace tools retain their current transport-level behavior. Remote MCP still uses the bearer-token compatibility model described below. Later OAuth/connector middleware must consume this same capability model rather than introducing a second authorization vocabulary.

This foundation is not itself an OS/process sandbox and does not claim to make arbitrary native code safe. Wasmtime/WASI, Deno permissions, Linux sandbox primitives, gVisor/Firecracker, credential brokerage, and Google/GitHub connectors are separate layers attached behind the capability boundary.

## Persistent credential vault and delegation boundary

GitHub and Google connector credentials can now persist through a provider-neutral OS-keyring broker. `system` is the default credential-store mode; `memory` must be selected explicitly. A system-keyring outage fails closed as `credential_vault_unavailable` and is mapped to a redacted HTTP 503. There is no automatic plaintext, workspace, browser-storage, or in-memory downgrade.

Persistence applies to provider credential envelopes only. EveGlyph connector capability grants are never restored: after restart, provider identity may be restored but GitHub repository and Google Drive metadata/file authority return to zero until the user grants them again.

The delegation broker issues opaque 32-byte tickets but stores only SHA-256 ticket hashes. Tickets exact-match provider, operation, capability and resource; default to one use / 60 seconds; and are bounded to 10 uses / 300 seconds. The local IPC boundary is limited to 16 KiB requests and blocks credential-shaped results. PR-D does not wire this IPC into MCP, so MCP remains outside the credential-owning process.

See [`docs/CREDENTIAL-VAULT-AND-DELEGATION.md`](docs/CREDENTIAL-VAULT-AND-DELEGATION.md) for the complete operator and trust-boundary contract.

## GitHub connector credential boundary

The GitHub connector is the first external-service implementation attached to the capability control plane. Its central rule is:

```text
GitHub OAuth authentication
!=
EveGlyph repository authorization
```

A successful GitHub App user-OAuth callback establishes a GitHub user identity and stores the resulting credential in a Node-side broker. It grants **zero repository authority**. The user must separately choose **Grant read for this session** for a specific `owner/repo` before the connector can read a file from that repository.

The connector uses the empty-baseline `connector-session` profile. Repository access is supplied only by explicit session grants such as:

```text
connector.github.repository.contents.read
on github:repository:<owner>/<repo>:contents:*
```

A repository A grant cannot authorize repository B, and read never implies write.

### Credential custody

GitHub credentials are kept in a process-scoped in-memory Node broker. Raw access tokens, refresh tokens, the GitHub client secret, OAuth authorization codes, PKCE verifiers, and Authorization headers are not returned to the browser and are not persisted to:

- `localStorage`;
- `sessionStorage`;
- workspace files;
- `.eveglyph/` files;
- Git history;
- publication artifacts;
- MCP payloads.

The broker exposes redacted descriptions plus a server-side callback interface for trusted connector code; it does not expose a public `getToken()` API. Restarting the Vite dev process destroys the broker state and requires GitHub authentication again.

The GitHub client id/secret are read from server-side environment variables:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
```

An optional callback override may be set through:

```text
EVEGLYPH_GITHUB_REDIRECT_URI
```

There is deliberately no GitHub client-secret/access-token field in Settings.

### OAuth replay protection and refresh

Authentication start creates a cryptographically random `state` plus an S256 PKCE challenge. Pending state expires after 10 minutes and is consumed before token exchange, so the same state cannot be replayed even if exchange fails.

If GitHub returns expiring user access tokens, EveGlyph refreshes them server-side when within 30 seconds of expiry. Missing/expired refresh authority fails closed as `github_reauthentication_required`; token values are never placed in public error messages.

### Repository read boundary

The current GitHub connector supports regular UTF-8 text files obtained through the GitHub Contents API only. Every read follows:

```text
validate owner/repo and path
→ require connected GitHub identity
→ require matching EveGlyph repository read grant
→ refresh credential if necessary
→ access credential inside broker callback
→ perform GitHub Contents request
→ validate file/base64 response
→ enforce 1 MiB decoded limit
→ strict UTF-8 decode
→ return content + capability evidence
```

The capability decision occurs **before credential access and before network fetch**. A denied request therefore cannot use the GitHub credential to probe another repository.

Paths reject leading `/`, empty segments, `.`/`..` traversal segments, and NUL characters. Directories, non-file resources, unsupported encodings, invalid UTF-8, and files larger than 1 MiB fail explicitly.

PR-B exposes **no GitHub write/create/update/delete/commit/generic-authenticated-request surface**. Configure the GitHub App with **Contents: Read-only** for this implementation as defense in depth.

### Local bridge and MCP separation

The GitHub connector routes live in a separate local Vite plugin, `vite-github-connector.js`, rather than the filesystem/CLI agent bridge. They retain the same localhost Host/Origin posture and bounded JSON request bodies.

The process-memory GitHub credential broker is **not shared with `mcp-server.js` or `mcp-server-remote.js`**. Those are separate processes. Raw credentials are not copied across that boundary merely to make MCP calls work. A later design may introduce deliberate broker IPC/keychain storage or place remote MCP behind the same authenticated gateway.

See [`docs/GITHUB-CONNECTOR.md`](docs/GITHUB-CONNECTOR.md) for operator setup, callback configuration, and the complete read-only flow.

## The local bridge

- The `/api/*` bridge (`vite-agent-bridge.js`) is a Vite plugin declared **`apply: 'serve'`** — it exists only under `npm run dev`, never in a production build.
- Every `/api` request is gated by `isLocalRequest`: the `Host` must be `localhost` / `127.0.0.1` / `::1`, and if an `Origin` header is present its hostname must also be local — otherwise the request is rejected with **403**. This blocks CSRF and DNS-rebinding from a malicious web page.
- Vite's dev server binds to localhost by default, so it is not reachable from your LAN. Note that the `isLocalRequest` gate is **header-based** (it inspects `Host` / `Origin`): that defends against CSRF and DNS-rebinding from a web page, but it is *not* a substitute for network isolation. If you start the server with `--host` (binding all interfaces), a device on your LAN could reach the bridge by sending a `localhost` `Host` header. **Do not run the dev server with `--host` on an untrusted network.**
- File reads/writes confine the target path with `resolveInside` (any path that escapes the workspace root is rejected). Beyond that, **every workspace-scoped operation — file I/O, the git snapshot / diff / accept / reject, and the agent spawn — is pinned to the single folder you opened**: the bridge records that folder when you open it, and a later request whose working directory isn't that folder (or a descendant) is rejected. This keeps a crafted `/api` request from pointing a destructive `git reset --hard` / `clean -fd`, or an auto-approve agent, at an arbitrary directory.

## Local-agent mode — read this

When the provider is **Local Agent (CLI)**:

- The selected CLI (Claude Code / Codex / Gemini) is spawned **in your workspace folder with auto-approve**, and can **read, create, and edit files** there.
- **Per-workspace confirmation.** The first agent run for a given folder asks you to confirm, and the gate keys on the confirmed working directory — confirming one workspace never authorizes edits in another, and switching to a new folder re-asks before any edit. The confirmation lives in the browser session and is not persisted, so a page reload also clears it and re-asks.
- **The prompt is delivered over stdin, never on the command line** — so prompt text is never interpreted as command-line arguments or shell syntax.
- **The command runs through a shell** (`shell: true`, required to resolve Windows `.cmd` shims). The command template comes from the built-in agent definition or **your own Settings override**. Only set the override to a command you trust — it is your input running on your machine.
- **Hard 180-second timeout.** The child process is killed on timeout, and also if you press Stop or close the connection.
- **Diff review (PatchMD).** Before the agent runs, the workspace is git-snapshotted (a repo is initialized if needed). Afterwards you review a real `git diff` and:
  - **Accept** → commits the agent's changes (`agent: <message>`).
  - **Reject** → `git reset --hard HEAD` + `git clean -fd`, discarding **all** agent edits *and* untracked files.

  Reject is destructive to uncommitted work in the workspace. Keep your own changes committed or backed up before running an agent.

## `.eveglyph/` workspace rules

If the workspace contains a `.eveglyph/rules.md`, EveGlyph Editor injects it **verbatim, with elevated authority** ("follow these before anything else") into the agent's prompt on *every* run — plus `.eveglyph/glossary.md` if present. Treat these as **trusted but attacker-controllable configuration**: when you open an unfamiliar workspace, review `.eveglyph/rules.md` before running an agent. This does not widen the core risk (the agent already has auto-approve over the same files), but the rules are auto-loaded without re-prompting, so a malicious one could steer the agent silently.

## The MCP server (`mcp-server.js`)

A separate trust model from the bridge above — read this before pointing an MCP client at it.

- **stdio only, no network exposure.** The server communicates over stdin/stdout with whatever process spawned it (your MCP client) — it never opens a TCP port, so there is no localhost-gating story to get right or wrong, and no LAN-exposure risk analogous to the bridge's `--host` caveat. This is deliberately the v1 scope (Neo's call, 2026-07-22): local stdio only, no remote/tunnel reachability — that would need its own, separate security design (real authentication, not just "the process is local") before being built.
- **Workspace root is explicit and required.** The server refuses to start without a workspace-root argument (`node mcp-server.js <path>`) — there is no implicit "confine to cwd" fallback. Every file operation resolves the target path against that root and rejects anything that would escape it (mirrors the bridge's `resolveInside`), verified with an explicit `../../..` escape-attempt test during development.
- **No diff-review layer of its own.** Unlike local-agent mode, `write_file` here does not snapshot/diff/require an Accept step — it writes immediately. This is intentional, not an oversight: an MCP host (Claude Desktop, Claude Code, etc.) already gates each tool call through its own human-approval UI before it runs, which fills the same "a human sees this before it happens" role the bridge's Accept/Reject view fills for an autonomous CLI agent. If the workspace is a git repo, your normal `git diff`/`git log` still works exactly as before — nothing about this server changes how git sees the files.
- **`evaluate_aimdc` runs on untrusted expression text**, same as the in-app preview — it uses the same closed-grammar, no-`eval`/`Function` evaluator (`src/aimdc/evaluator.js`) and now enters through the `document-only` capability wrapper first. A malformed or adversarial AIMD-C block can only produce a parse/type error within the evaluator; it is not handed workspace/network/process/credential authority.
- **Known, not-applicable advisory**: `npm audit` flags a moderate path-traversal issue in `@hono/node-server` (a transitive dependency of `@modelcontextprotocol/sdk`'s HTTP-transport code, `GHSA-frvp-7c67-39w9`). The specific vulnerable export is Hono's `serve-static` middleware; the SDK's `StreamableHTTPServerTransport` only imports `getRequestListener` (a plain Node↔Web-standard request/response adapter) — confirmed by reading the SDK's own source, not assumed — so the vulnerable code path is never loaded by either `mcp-server.js` or `mcp-server-remote.js` below. Noted here rather than silently ignored, not treated as urgent.

## The remote MCP server (`mcp-server-remote.js`)

Same tool set as `mcp-server.js` above, reachable over HTTP instead of stdio — built 2026-07-22 on Neo's explicit request to complete the "not always local" piece the stdio-only v1 deferred. **A meaningfully different trust model from everything above — read this before tunneling it to a public URL.**

- **Binds to `127.0.0.1` only, never `0.0.0.0`.** This process is not directly internet-facing by itself; reachability from outside this machine requires *you* to tunnel a public hostname to this port (e.g. `cloudflared tunnel --url http://127.0.0.1:8787`). Same discipline as the bridge's own `--host` caveat — the tunnel is the one intended path in, not an open listener.
- **Bearer-token auth is mandatory, checked with a constant-time comparison** (`crypto.timingSafeEqual`, so a wrong guess can't be timed to narrow down the real token character-by-character). The process refuses to start without `EVEGLYPH_MCP_TOKEN` set (16+ chars). This is a deliberate, appropriately-scoped choice for a single-user personal deployment — not full OAuth, which would be real added complexity for a server with exactly one intended caller.
- **A leaked token means direct, un-reviewed remote read/write access to the workspace**, with no diff-review layer standing between the request and the file write (same "no diff-review, relies on the client's own approval UI" design as `mcp-server.js` — but stdio mode has an implicit second gate: someone has to already be running code *on your machine* to reach it at all. Tunneled HTTP mode does not have that implicit gate — the token is the *only* thing standing between "an MCP client you configured" and "anyone on the internet who has the URL and the token." Treat the token like a password: don't commit it, don't paste it somewhere logged, regenerate it if you suspect it leaked.
- **Stateless per-request** (`sessionIdGenerator: undefined`, mirroring the SDK's own stateless example) — a fresh `McpServer` + transport per HTTP request, no session state held in memory between calls. Appropriate for a single-tunnel personal deployment; a busier or multi-client deployment would want the SDK's stateful/session-ID mode instead, not built here since it isn't needed yet.
- **No CORS handling.** Remote MCP clients (Claude.ai's remote connector, ChatGPT's MCP support, etc.) typically call the URL server-side, not from a user's own browser JS, so a same-origin restriction wouldn't add anything here — if a specific client needs CORS headers, that's a small, separate addition once there's a concrete need.
- **Settings ⚙ → Enable remote MCP server** lets the bridge spawn/kill `mcp-server-remote.js` for you instead of running it from a terminal yourself — everything above still applies exactly the same (loopback-only bind, mandatory token, no diff-review). Two things specific to this path: (1) the new `/api/mcp/start`/`/api/mcp/stop`/`/api/mcp/status` bridge endpoints are gated by the same `isLocalRequest` check as every other `/api/*` endpoint (CSRF/DNS-rebinding protection), and confined to the currently-opened workspace via the existing `assertWorkspace` check — a malicious page reachable only via the bridge's own CSRF gate still couldn't read the token it would need to actually use the server it started, since the token lives in this page's own `localStorage`/in-memory state, unreadable cross-origin. (2) The bridge kills any running MCP-remote process when the dev server itself stops (`server.httpServer.on('close', ...)`), so it doesn't linger as an orphaned background process across `npm run dev` restarts.

## API keys

- Cloud-provider API keys are stored in the browser's **`localStorage`, in plaintext** (key `eveglyph_cfg`). This is convenient for local dev but is **not** secure storage. Don't use it on a shared or untrusted machine. A future desktop build would move keys to the OS keychain.
- Calling Anthropic directly from the browser requires the `anthropic-dangerous-direct-browser-access` header; for stricter setups, route through an OpenAI-compatible proxy instead.

## Preview sanitization

The Markdown preview is rendered with `marked` and sanitized with **DOMPurify** (default configuration — script / iframe / event-handler attributes stripped). Even so, only open Markdown you trust — sanitization narrows, but never fully eliminates, the HTML-in-Markdown surface.

## Telemetry

A best-effort diagnostic stream is appended to a local JSONL file (`../PHOSPHOR/eveglyph-monitor.jsonl`, rolled at 5 MB). It records file / workspace / agent events — paths, byte counts, short output samples — **locally only**. Nothing is sent over the network. Delete the file to clear it.

## Reporting

EveGlyph Editor is an EveMissLab prototype. Please report security issues to the maintainer (Neo.K) directly rather than filing a public issue.
