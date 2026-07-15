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
- **World Studio draft generation** — the **Studio** tab asks the configured cloud AI for a bounded state-machine draft containing states, variables, optional controlled random ranges, events, language instructions, responses, and transitions. The result is parsed and validated locally before it can be applied to the editor; **Check with Runtime** can send it to the Runtime's read-only World IR importer, edit the returned mapping draft, and validate it again. It never writes Runtime State or saves a file automatically.
- **Workspace memory (`.eveglyph/`)** — per-workspace `rules.md` / `glossary.md` / `memory/*` injected into every agent run; a back-stage **Monitor** tab reads the diagnostic stream.

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

## How it works

- **Frontend** — vanilla ES modules + CodeMirror, with all mutable state in a single `S` singleton (`src/`).
- **Bridge** — a **dev-only** Vite plugin (`vite-agent-bridge.js`) exposing `/api/*` for filesystem I/O, encoding detection, git diff-review, and agent spawning. It runs only under `npm run dev` (`apply: 'serve'`), and every endpoint is gated to local requests.

```
browser frontend  ⇄  vite-agent-bridge (/api)  ⇄  filesystem · git · CLI agent
```

## Security

Local-agent mode runs a CLI **with auto-approve** and lets it read, create, edit, and delete files in the workspace folder. Every file, git, and agent operation is confined server-side to the one folder you opened. You stay in control through a per-workspace confirmation and a git-snapshot **diff review** (Accept / Reject).

If a workspace contains a **`.eveglyph/rules.md`**, EveGlyph Editor injects it into every agent run with elevated authority (plus `.eveglyph/glossary.md` and the `.eveglyph/memory/*` notes) — review it before running an agent in an unfamiliar workspace.

Read **[SECURITY.md](SECURITY.md)** for the full trust model — localhost gating, the `--host` caveat, plaintext API-key storage, and the `.eveglyph/` risk — before enabling local-agent mode.

## Status

**v0.4.0** — local prototype, pre-1.0. `EG-MD-2026`. Built by Neo.K under **EveMissLab**.

## 關於本專案 (About & License)

本專案由 **EVEMISS TECHNOLOGY CO., LTD. (一言諾科技有限公司)** 研發與維護。

- **系統架構師 / 作者：** Neo.K (許筌崴)
- **營運總部：** 台灣 台北市 (Taipei City, Taiwan)
- **商業與授權聯繫：** kakon77777@evemisslab.com
- **產品編號：** EveGlyph-MD · `EG-MD-2026`

本專案採用 [MIT License](LICENSE) 開源授權。我們鼓勵任何形式的學術探討、商業應用與代碼修改，但所有衍生版本與散佈行為，均必須保留原作者出處與授權聲明。

> **免責與專利保留聲明：** 本開源釋出僅針對當前代碼與邏輯結構。EVEMISS TECHNOLOGY 保留未來進階演算模組與相關架構之專利申請權利。
