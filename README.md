# EveGlyph Editor

> A local-first, AI-native Markdown editor and agentic document workspace — humans write clean Markdown, local CLI agents edit on disk, every change lands as a reviewable git diff. Part of **EveMissLab**.

EveGlyph Editor is a Markdown editor built around one idea — the **workspace ↔ agent ↔ diff-review ↔ human loop**. You write clean Markdown; AI assists quietly; local CLI agents edit files on disk; and every agent change surfaces as a reviewable git diff you accept or reject. The front stage stays minimal; the capability lives backstage.

It is the editor half of **EveGlyph-MD**, a semantic-first Markdown format/protocol.

> ⚠️ **Local-agent mode runs a CLI with auto-approve.** When you enable it, the selected agent can read, create, edit, and **delete** files in the workspace folder you point it at — without per-file confirmation; you review the changes afterward as a git diff (Accept / Reject). Point it only at a folder you trust, and read **[SECURITY.md](SECURITY.md)** first. (The Anthropic / OpenAI cloud providers never touch your filesystem.)

## Features

- **Editor** — CodeMirror 6 with Markdown syntax and built-in search & replace (`Ctrl+F`).
- **Live preview** — `marked` + KaTeX math + `:::` callout blocks, sanitized with DOMPurify.
- **Workspace** — file tree, tabs, and a folder browser; open via the browser File System Access API (picker) or the local bridge (absolute path).
- **Encoding-aware** — detects a file's encoding (`jschardet`) and preserves it on save (`iconv-lite`: Big5 / GBK / Shift-JIS / …). A per-file status-bar menu (for bridge-opened files) lets you re-read or convert; a **Settings → Default encoding** acts as the fallback when detection is uncertain and the encoding for new files.
- **AI providers** — Anthropic (Claude), any OpenAI-compatible endpoint, or a **local CLI agent** (Claude Code / Codex / Gemini).
- **Diff-first agent review (PatchMD)** — before an agent runs, the workspace is git-snapshotted; afterwards you review a real diff — grouped into **per-file cards with +/− counts** — and **Accept** (commit) or **Reject** (revert). A live activity panel shows the agent working.
- **Permission tiers** — *Cautious* / *Standard* / *Trusted* map to **real CLI enforcement** (Claude Code tool allow-lists, Codex sandbox levels, Gemini approval modes), not just prompt text.
- **EveGlyph-MD frontmatter** — a lightweight `type` / `status` / `tags` classification with a status-bar chip and preview badges; the active document's class is handed to the agent as sanitized, non-instruction metadata.
- **World Studio draft generation** — opt in with **Settings → Enable World Studio**. The **Studio** tab asks the configured cloud AI for a bounded state-machine draft containing states, variables, optional controlled random ranges, events, language instructions, responses, and transitions. State Machine Preview provides direct visual buffer editing for those records and Runtime mapping review. The result is parsed and validated locally before it can be applied to the editor; **Check with Runtime** can send it to the Runtime's read-only World IR importer, edit the returned mapping draft, and validate it again. It never writes Runtime State or saves a file automatically.
- **Workspace memory (`.eveglyph/`)** — per-workspace `rules.md` / `glossary.md` / `memory/*` injected into every agent run; a back-stage **Monitor** tab reads the diagnostic stream.
- **Capability sandbox foundation** — AIMD-C entry points run through a deny-by-default `document-only` authority profile. Document computation receives only current-document read, bounded compute, and ephemeral-output capability; workspace, network, process, host-environment, Google, GitHub, OAuth-token, and other connector authority are absent unless a caller supplies an explicit resource-scoped grant. Allow/deny decisions carry actor-aware audit evidence.
- **GitHub Connector (read-only MVP)** — a GitHub App user-OAuth + PKCE flow keeps access/refresh credentials in Node process memory, binds the GitHub user as actor identity, and still requires a separate repository-scoped **Grant read for this session** before EveGlyph can read a GitHub Contents file. OAuth identity does not imply repository authority, and no GitHub write surface is exposed. See [`docs/GITHUB-CONNECTOR.md`](docs/GITHUB-CONNECTOR.md).
- **Google Drive Connector (read-only MVP)** — Google web-server OAuth + PKCE keeps access/refresh credentials in the same Node-side broker model, but OAuth still grants zero EveGlyph Drive authority. Metadata browsing requires an explicit session grant; each file then needs its own exact read grant. Stored UTF-8 text is downloaded through Drive v3 and Google Docs are exported as `text/markdown`. No Drive write surface is exposed. See [`docs/GOOGLE-DRIVE-CONNECTOR.md`](docs/GOOGLE-DRIVE-CONNECTOR.md).
- **MCP server** (`mcp-server.js`) — a standalone stdio [MCP](https://modelcontextprotocol.io) server so any MCP-capable client (Claude Desktop, Claude Code, etc.) can read/write a workspace and run AIMD-C/World-IR logic directly, no browser needed. See [below](#mcp-server-for-ai-clients).

## Quick start

### Windows — one double-click

Double-click **`start-eveglyph.bat`**. The first run installs dependencies, then starts the dev server and opens your browser automatically.

### Any platform

```sh
npm install
npm run dev
```

Then open <http://localhost:5173>.

> First time? **Open Folder → `examples/`** for a ready-made workspace — sample EveGlyph-MD docs plus a starter `.eveglyph/` operating manual.

> Requires [Node.js](https://nodejs.org/) (18+). The dev server binds to `localhost` only — **don't run it with `--host`** (which exposes the bridge to your LAN) on an untrusted network.

## Configuration (Settings ⚙ panel)

- **AI Provider** — Anthropic / OpenAI-compatible / Local Agent (CLI).
- Cloud providers: API key + model id.
- Local agent: choose the agent, set an **absolute workspace path** (the browser cannot expose the picked folder's real path to the agent), and an optional command override.
- **Default encoding** — fallback used when auto-detection is uncertain, and the encoding applied to newly created files.
- **Enable World Studio** — reveals the advanced Runtime, World, Studio, and editable World IR views. It is off by default so the normal surface remains an AI-native Markdown editor; source files remain plain YAML and disk Save is always explicit.
- **GitHub Connector** — when the server-side GitHub App environment is configured, Settings can connect a GitHub identity, explicitly grant one repository read authority for the current session, and read one UTF-8 text file through the GitHub Contents API. Tokens/client secrets are never entered in Settings.
- **Google Drive Connector** — when the server-side Google OAuth environment is configured, Settings can connect a Google identity, explicitly grant Drive metadata browsing for the session, list files, and explicitly grant/read one selected file. OAuth access/refresh tokens and the Google client secret are never entered in Settings.

## GitHub Connector quickstart

This connector uses a **GitHub App** rather than a legacy OAuth App. For this MVP, configure the GitHub App with:

```text
Repository permissions
  Contents: Read-only
```

Register the normal local callback URL:

```text
http://localhost:5173/api/connectors/github/callback
```

Set these environment variables before starting EveGlyph:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
```

Optional callback override:

```text
EVEGLYPH_GITHUB_REDIRECT_URI
```

Then start/restart the dev server and open **Settings → GitHub Connector**.

The user flow is deliberately two-stage:

```text
Connect GitHub
→ identity established, zero repository grants
→ enter owner/repo
→ Grant read for this session
→ enter path/ref
→ Read file
```

The access/refresh token remains in the Node-side process-memory credential broker. Restarting the Vite dev server disconnects GitHub and requires authentication again. This first broker is not shared with the separate MCP server processes.

See [`docs/GITHUB-CONNECTOR.md`](docs/GITHUB-CONNECTOR.md) and [`SECURITY.md`](SECURITY.md) for the complete trust model.

## Google Drive Connector quickstart

Create a Google Cloud project, enable the **Google Drive API**, configure the OAuth consent screen, and create a **Web application** OAuth client.

Register this exact local redirect URI (or your exact Vite localhost variant):

```text
http://localhost:5173/api/connectors/google/callback
```

Set these environment variables before starting EveGlyph:

```text
EVEGLYPH_GOOGLE_CLIENT_ID
EVEGLYPH_GOOGLE_CLIENT_SECRET
```

Optional callback override:

```text
EVEGLYPH_GOOGLE_REDIRECT_URI
```

Then restart the dev server and open **Settings → Google Drive Connector**.

The user flow intentionally has three authority stages:

```text
Connect Google
→ identity established, zero EveGlyph Drive grants
→ Grant metadata browse for this session
→ List Drive files
→ select one file
→ Grant read for selected file
→ Read selected file
```

PR-C requests `openid email profile` plus `https://www.googleapis.com/auth/drive.readonly`. The provider credential can therefore read Drive content, but EveGlyph's broker still requires the explicit internal grants above before it will call Drive. Google currently treats broad Drive scopes such as `drive.readonly` as restricted for production applications; public deployment can require OAuth verification and, depending on how restricted data is handled, a security assessment. This local MVP does not claim that production approval has been completed.

Google Docs are exported through Drive v3 as `text/markdown`; other Google Workspace object types currently fail closed rather than guessing an export format. Stored text and exported Markdown are capped at 1 MiB and decoded as strict UTF-8.

See [`docs/GOOGLE-DRIVE-CONNECTOR.md`](docs/GOOGLE-DRIVE-CONNECTOR.md) and [`SECURITY.md`](SECURITY.md) for the complete trust model.

## Persistent credential vault and delegation

Connector credentials now use a provider-neutral credential runtime. The default `EVEGLYPH_CREDENTIAL_STORE=system` stores GitHub/Google OAuth credential envelopes in the operating-system keyring through `@napi-rs/keyring`; `EVEGLYPH_CREDENTIAL_STORE=memory` is the only supported explicit non-persistent fallback. Keyring failure fails closed — EveGlyph does not silently write tokens to plaintext files, browser storage, the workspace, or `.eveglyph/`.

Restart restoration brings back provider identity only. GitHub repository grants and Google Drive metadata/file grants remain session-only and must be explicitly granted again.

PR-D also adds short-lived, exact provider/operation/capability/resource delegation tickets and a local `node:net` IPC operation boundary. Raw tickets are not stored (only SHA-256 hashes), default to one use / 60 seconds, and are capped at 10 uses / 300 seconds. **MCP is not connected to this delegation path yet**, so standalone MCP processes still receive no GitHub/Google credentials or persistent broker.

See [`docs/CREDENTIAL-VAULT-AND-DELEGATION.md`](docs/CREDENTIAL-VAULT-AND-DELEGATION.md) and [`SECURITY.md`](SECURITY.md).

## How it works

- **Frontend** — vanilla ES modules + CodeMirror, with all mutable state in a single `S` singleton (`src/`).
- **Bridge** — a **dev-only** Vite plugin (`vite-agent-bridge.js`) exposing `/api/*` for filesystem I/O, encoding detection, git diff-review, and agent spawning. It runs only under `npm run dev` (`apply: 'serve'`), and every endpoint is gated to local requests.
- **GitHub connector bridge** — `vite-github-connector.js` is a separate local Node/Vite plugin. It owns GitHub OAuth callback handling and a process-memory credential broker; browser Settings receives only redacted account/grant/read data.
- **Google Drive connector bridge** — `vite-google-drive-connector.js` is another separate local Node/Vite plugin using the same broker/capability vocabulary. Browser Settings receives only redacted identity, grants, bounded Drive metadata, and read results.

```text
browser frontend  ⇄  Vite local bridges  ⇄  filesystem · git · CLI agent · GitHub · Google Drive
```

## MCP server (for AI clients)

`mcp-server.js` is a separate, standalone [MCP](https://modelcontextprotocol.io) server — a stdio process any MCP-capable client (Claude Desktop, Claude Code, or any other MCP host) can connect to directly, without a browser tab or `npm run dev` running. It operates on a workspace folder you point it at and exposes:

- `list_files` — every text file in the workspace
- `read_file` / `write_file` — read/write a file by relative path (encoding-aware on read)
- `evaluate_aimdc` — parse and evaluate a document's AIMD-C blocks through the `document-only` capability profile; the result includes sandbox/audit evidence
- `validate_world_ir` — validate a World IR YAML document (state machine / entity / entity list)

The capability control plane also defines transport-neutral mappings for these base tools and the publication tools. The mapping is groundwork for later identity-aware MCP authorization; **the capability-foundation PR does not silently put existing workspace MCP tools behind a new grant-acquisition flow**, and the remote HTTP transport still uses its existing bearer-token compatibility mode.

The GitHub and Google Drive connector process-memory credentials are deliberately **not** shared into these MCP processes. A later broker IPC/keychain or unified authenticated gateway must define that boundary explicitly rather than copying raw tokens between processes.

Run it directly:

```sh
node mcp-server.js /absolute/path/to/your/workspace
# or: npm run mcp -- /absolute/path/to/your/workspace
```

Point an MCP client at it — for example, in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eveglyph-editor": {
      "command": "node",
      "args": ["/absolute/path/to/eveglyph-editor/mcp-server.js", "/absolute/path/to/your/workspace"]
    }
  }
}
```

### Remote access (over a tunnel)

`mcp-server-remote.js` is the same tool set over HTTP + bearer-token auth, for a client that isn't on this machine (e.g. a remote MCP connector, or a chat client you're using away from your desk):

```sh
export EVEGLYPH_MCP_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
npm run mcp:remote -- /absolute/path/to/your/workspace
# listens on http://127.0.0.1:8787/mcp — set EVEGLYPH_MCP_PORT to change the port
```

It only ever binds to `127.0.0.1` — reach it from outside by tunneling a public hostname to that port yourself, e.g. with [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```sh
cloudflared tunnel --url http://127.0.0.1:8787
```

Then point a remote MCP client at the tunnel's `https://.../mcp` URL with header `Authorization: Bearer <your token>`. Keep the token secret — anyone who has it can read/write the workspace you pointed the server at. See [SECURITY.md](SECURITY.md) for the full trust model (no diff-review layer here either, and what a leaked token means).

### Or just flip the switch in Settings

Settings ⚙ → **Enable remote MCP server** does the same `mcp-server-remote.js` start/stop for you — the app's own bridge spawns and kills the process, generates a token (with a copy button), and shows the local URL once it's running. You still need to tunnel it yourself for real remote reachability; Settings also shows the ready-to-copy **Local MCP (stdio)** command for the current workspace, for an MCP client on this same machine. Off by default, and the checkbox always reflects whether the process is actually running — not a remembered preference, so a page reload never lies about it.

## Security

AIMD-C document computation in the live preview and MCP `evaluate_aimdc` enters through `src/capabilities/document-runtime.js`. Its default `document-only` profile grants only `document.read.self` on `document:self`, `document.compute` on `document:self`, and `ephemeral.output` on `execution:*`. It has no filesystem, network, process, host-environment, OAuth credential, Google, or GitHub object to call. External access must be represented as an explicit capability request and authorized against a resource-scoped grant before a connector broker performs the action.

The GitHub connector follows that rule directly: OAuth creates actor identity plus an opaque server-side credential handle, not repository authority. A matching `connector.github.repository.contents.read` grant is required before token access/network fetch, and the current service has no GitHub write method.

The Google Drive connector follows the same control-plane ordering. Google OAuth creates identity plus an opaque credential, but no EveGlyph Drive grants. Metadata listing requires `connector.google.drive.metadata.list`; reading requires an exact `connector.google.drive.file.read` grant for the selected `fileId`. Capability denial occurs before broker credential access and provider network I/O. The current service has no Drive write method.

Local-agent mode is a separate, intentionally broader trust boundary: it runs a CLI **with auto-approve** and lets it read, create, edit, and delete files in the workspace folder. Every file, git, and agent operation is confined server-side to the one folder you opened. You stay in control through a per-workspace confirmation and a git-snapshot **diff review** (Accept / Reject).

If a workspace contains a **`.eveglyph/rules.md`**, EveGlyph Editor injects it into every agent run with elevated authority (plus `.eveglyph/glossary.md` and the `.eveglyph/memory/*` notes) — review it before running an agent in an unfamiliar workspace.

Read **[SECURITY.md](SECURITY.md)** for the full trust model — capability boundaries, connector credential custody, localhost gating, the `--host` caveat, plaintext AI-provider API-key storage, and the `.eveglyph/` risk — before enabling local-agent mode or remote MCP.

## Status

**v0.5.0** — local prototype, pre-1.0. `EG-MD-2026`. Built by Neo.K under **EveMissLab**.

## 關於本專案 (About & License)

本專案由 **EVEMISS TECHNOLOGY CO., LTD. (一言諾科技有限公司)** 研發與維護。

- **系統架構師 / 作者：** Neo.K (許筌崴)
- **營運總部：** 台灣 台北市 (Taipei City, Taiwan)
- **商業與授權聯繫：** kakon77777@evemisslab.com
- **產品編號：** EveGlyph-MD · `EG-MD-2026`

本專案採用 [MIT License](LICENSE) 開源授權。我們鼓勵任何形式的學術探討、商業應用與代碼修改，但所有衍生版本與散佈行為，均必須保留原作者出處與授權聲明。

> **免責與專利保留聲明：** 本開源釋出僅針對當前代碼與邏輯結構。EVEMISS TECHNOLOGY 保留未來進階演算模組與相關架構之專利申請權利。
