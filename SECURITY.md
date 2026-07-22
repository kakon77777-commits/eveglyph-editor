# Security

EveGlyph Editor is a **local-first developer tool**: it runs on your own machine via the local dev server. This document describes its trust model and the real risks — above all, **local-agent mode**.

## In one line

The bridge is dev-only and localhost-gated. The biggest risk is **by design**: local-agent mode lets a CLI edit your files with auto-approve. You stay in control through a per-workspace confirmation and git-based diff review.

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
- **`evaluate_aimdc` runs on untrusted expression text**, same as the in-app preview — it uses the same closed-grammar, no-`eval`/`Function` evaluator (`src/aimdc/evaluator.js`), so a malformed or adversarial AIMD-C block can only produce a parse/type error, never arbitrary code execution.
- **Known, not-applicable advisory**: `npm audit` flags a moderate path-traversal issue in `@hono/node-server` (a transitive dependency of `@modelcontextprotocol/sdk`'s HTTP-transport code, `GHSA-frvp-7c67-39w9`). The specific vulnerable export is Hono's `serve-static` middleware; the SDK's `StreamableHTTPServerTransport` only imports `getRequestListener` (a plain Node↔Web-standard request/response adapter) — confirmed by reading the SDK's own source, not assumed — so the vulnerable code path is never loaded by either `mcp-server.js` or `mcp-server-remote.js` below. Noted here rather than silently ignored, not treated as urgent.

## The remote MCP server (`mcp-server-remote.js`)

Same tool set as `mcp-server.js` above, reachable over HTTP instead of stdio — built 2026-07-22 on Neo's explicit request to complete the "not always local" piece the stdio-only v1 deferred. **A meaningfully different trust model from everything above — read this before tunneling it to a public URL.**

- **Binds to `127.0.0.1` only, never `0.0.0.0`.** This process is not directly internet-facing by itself; reachability from outside this machine requires *you* to tunnel a public hostname to this port (e.g. `cloudflared tunnel --url http://127.0.0.1:8787`). Same discipline as the bridge's own `--host` caveat — the tunnel is the one intended path in, not an open listener.
- **Bearer-token auth is mandatory, checked with a constant-time comparison** (`crypto.timingSafeEqual`, so a wrong guess can't be timed to narrow down the real token character-by-character). The process refuses to start without `EVEGLYPH_MCP_TOKEN` set (16+ chars). This is a deliberate, appropriately-scoped choice for a single-user personal deployment — not full OAuth, which would be real added complexity for a server with exactly one intended caller.
- **A leaked token means direct, un-reviewed remote read/write access to the workspace**, with no diff-review layer standing between the request and the file write (same "no diff-review, relies on the client's own approval UI" design as `mcp-server.js` — but stdio mode has an implicit second gate: someone has to already be running code *on your machine* to reach it at all. Tunneled HTTP mode does not have that implicit gate — the token is the *only* thing standing between "an MCP client you configured" and "anyone on the internet who has the URL and the token." Treat the token like a password: don't commit it, don't paste it somewhere logged, regenerate it if you suspect it leaked.
- **Stateless per-request** (`sessionIdGenerator: undefined`, mirroring the SDK's own stateless example) — a fresh `McpServer` + transport per HTTP request, no session state held in memory between calls. Appropriate for a single-tunnel personal deployment; a busier or multi-client deployment would want the SDK's stateful/session-ID mode instead, not built here since it isn't needed yet.
- **No CORS handling.** Remote MCP clients (Claude.ai's remote connector, ChatGPT's MCP support, etc.) typically call the URL server-side, not from a user's own browser JS, so a same-origin restriction wouldn't add anything here — if a specific client needs CORS headers, that's a small, separate addition once there's a concrete need.

## API keys

- Cloud-provider API keys are stored in the browser's **`localStorage`, in plaintext** (key `eveglyph_cfg`). This is convenient for local dev but is **not** secure storage. Don't use it on a shared or untrusted machine. A future desktop build would move keys to the OS keychain.
- Calling Anthropic directly from the browser requires the `anthropic-dangerous-direct-browser-access` header; for stricter setups, route through an OpenAI-compatible proxy instead.

## Preview sanitization

The Markdown preview is rendered with `marked` and sanitized with **DOMPurify** (default configuration — script / iframe / event-handler attributes stripped). Even so, only open Markdown you trust — sanitization narrows, but never fully eliminates, the HTML-in-Markdown surface.

## Telemetry

A best-effort diagnostic stream is appended to a local JSONL file (`../PHOSPHOR/eveglyph-monitor.jsonl`, rolled at 5 MB). It records file / workspace / agent events — paths, byte counts, short output samples — **locally only**. Nothing is sent over the network. Delete the file to clear it.

## Reporting

EveGlyph Editor is an EveMissLab prototype. Please report security issues to the maintainer (Neo.K) directly rather than filing a public issue.
