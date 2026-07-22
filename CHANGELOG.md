# Changelog

All notable changes to EveGlyph Editor are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/) — newest first.

## [Unreleased]

### Added
- **Remote MCP server** (`mcp-server-remote.js`) — the same MCP tool set as
  `mcp-server.js`, over HTTP + a required bearer token instead of stdio, so a client that
  isn't on this machine can reach it too (tunnel it with something like `cloudflared` to
  get a public URL). Binds to `127.0.0.1` only — it's never directly internet-facing by
  itself. Run with `npm run mcp:remote -- /path/to/workspace` (needs `EVEGLYPH_MCP_TOKEN`
  set). See SECURITY.md — this has a meaningfully different trust model than the local
  version (no second gate beyond the token once tunneled).
- **MCP server** (`mcp-server.js`) — a standalone, local stdio [MCP](https://modelcontextprotocol.io)
  server, so any MCP-capable client (Claude Desktop, Claude Code, etc.) can work with an
  EveGlyph workspace directly, no browser tab required. Five tools: `list_files`,
  `read_file`, `write_file`, `evaluate_aimdc` (same engine the live preview/PDF export
  use), and `validate_world_ir` (same validator the World IR views use). Run with
  `npm run mcp -- /path/to/workspace`.
- **PDF theme & layout** — PDF export now supports named themes
  (`typst_theme:` in frontmatter — `evemiss-serif-light`, the default, or
  `evemiss-classic-light`) and layout profiles (`typst_layout:` —
  `technical-whitepaper`, the default, `academic-paper`, or
  `long-form-book`), controlling font, scale, colors, page size/margins, and
  whether equations get numbered. Leave both unset and export is unchanged
  from before. Theorem/Lemma/Definition callouts in exported PDFs are now
  sequentially numbered (Theorem 1, Theorem 2, ...).
- **AIMD-C blocks now export to PDF as real typeset output** — values,
  functions, compute results, assertions, tables, and formula/number/table
  views all render properly in PDF export (previously a plain placeholder
  box). `{{ id.field }}` inline references resolve in PDF export too, same
  as in the live preview.
- **AIMD-C computable document blocks** — replaces the earlier `::: aimd :::`
  `Logic_Node`/`Coupling Node` syntax with typed values, pure functions, a
  real dependency graph, assertions, and computed results that re-evaluate
  live as you type. Reference any block's result from anywhere in the
  document (`@id.field`), or inline in prose (`{{ id.field }}`). Wrong types
  and circular references are caught and reported honestly, not silently
  ignored. See `examples/aimd-demo.md` for a full worked walkthrough.
- **Automatic MathJax fallback** — a formula KaTeX can't render gets one more
  try through MathJax before being reported as failed. Not everything KaTeX
  can't do, MathJax can — but real gaps like the `multline` environment or
  chemistry notation (`\ce{...}`) now render correctly instead of showing a
  diagnostic. Loads lazily (only when there's an actual failure to retry),
  and a rescued formula gets a subtle marker so it's clear it took a
  fallback path.
- **Math auto-normalization (Safe Rewrite)** — some formulas that look like a
  KaTeX gap are really just a syntax alias KaTeX doesn't recognize by name
  (e.g. `split`, which means the same as `aligned`). Those now get quietly
  rewritten before rendering instead of failing — a small note appears above
  the preview when this happens, logged to the Monitor tab.
- **Math diagnostics panel** — a formula that fails to render (or partially
  degrades — an unsupported command inside an otherwise-valid formula) used to
  disappear silently. Now it shows up as a diagnostics panel above the
  preview, and is logged to the Monitor tab. See `examples/math-corpus.md`
  for a demo of passing, auto-normalized, and intentionally-failing formulas.
- **Resizable panes + full-width panel tabs** — the sidebar and right panel
  can now be drag-resized (a splitter between each pane and its neighbor),
  and the panel-tab row (Preview/Runtime/World/Studio/AI/Search/Monitor/
  Docs/Settings) moved to its own full-width row under the topbar instead of
  being squeezed into the right panel, where 9 tabs no longer fit legibly.
  Widths persist across reloads.
- **Language setting + real translation (i18n Phase 1–3)** — a new
  **Language** selector in Settings ⚙ (English / 繁體中文 so far, easy to
  extend). No framework, plain per-locale dictionaries (`src/i18n/`), English
  as fallback. Coverage now spans both `index.html`'s static UI chrome
  (topbar, sidebar, every panel tab, Settings, status bar) **and**
  dynamically-generated content across the rest of the app — file tree/tabs,
  context menus, the agent diff-review UI, AI preset labels, search/AI-search
  results, Studio/Runtime/Overview/Monitor panels, and `alert()` messages
  (~202 translation keys, zero gaps as of Phase 3). AI prompt text sent to
  providers, Monitor diagnostic payload content, and document/Markdown
  content itself intentionally stay untranslated regardless of the Language
  setting.
- **Controlled Studio randomness** — variable drafts can now declare bounded
  boolean, integer, number, or choice random specs. Limits and invalid ranges
  are diagnosed locally; generated random data remains reviewable draft data.
- **PDF export (Typst)** — a new **PDF** button in the topbar compiles the active
  Markdown document into a real typeset PDF (proper math layout, real page
  breaks — not just the browser's Save-as-PDF, which **Print** still does).
  Runs entirely client-side via a WebAssembly build of the
  [Typst](https://typst.app) compiler, bundled as an ordinary dependency and
  served from this app — nothing is uploaded anywhere. Handles headings,
  bold/italic/strikethrough, code, links, nested/ordered lists, blockquotes,
  tables, math (via `tex2typst`), callouts (colored boxes matching the preview's
  colors), and AIMD blocks (a static print rendering — no compute buttons or
  folded Coupling Nodes, just the last-known state as written). Traditional
  Chinese text renders correctly (Noto Serif TC). A document-level style pass
  sets a real page/font/heading/code/link/table look rather than raw Typst
  defaults. First export in a session downloads ~51MB (compiler + fonts),
  cached after.
- **RigorLoop audit preset** — a new "🧪 RigorLoop audit (AMEP)" quick action in
  the AI panel. Unlike the other presets, this doesn't call your configured AI
  provider — it calls [AMEP](https://evemisstechnology.com/amep/), a separate
  open method-pack project, directly in your browser (no server round-trip, no
  API key needed). RigorLoop scans your selection/document for compressed proof
  language, unclear equivalence claims, and missing citations, and returns
  concrete findings with recommendations. It's a heuristic keyword/marker
  scanner, not a theorem prover or an LLM — the result panel says so plainly.
  First use in a session downloads ~14 MB (cached after).
- **World IR mode (CompilableWorld)** — open a `.yaml`/`.yml` file starting with
  `kind: state_machine` / `kind: entity` / `kind: entity_list` and the preview
  pane renders it visually instead of Markdown: state machines as a clickable
  SVG diagram (add/delete states and transitions right from the diagram),
  entities as an editable field form, entity lists as a table. Every view runs
  a validator (missing/undefined states, conflicting transitions, unreachable
  states, missing/duplicate ids) and shows the result inline. A new **🌐 World**
  tab scans the whole open workspace and inventories every recognized document
  at once, click-to-jump to any of them. The file itself always stays plain
  YAML text — this is a different way of viewing/editing it, not a separate
  save format. See `examples/village-inn/` for real examples. (Originally
  built as a separate fork, `compilableworld-studio` — folded back in here
  once it became clear nothing about it actually needed a separate codebase.)
- **Studio AI draft panel** — a new **Studio** tab generates bounded
  `kind: state_machine` YAML drafts with variables, events, language instructions,
  responses, and transitions. The response is parsed and validated locally with
  hard size limits; invalid drafts cannot be applied, and applying a valid draft
  only changes the editor until the user explicitly saves it. No Runtime State is
  mutated and unknown semantics remain reviewable.
- **AIMD computable-math blocks** — a new `::: aimd … :::` block type for
  Markdown documents. Write a spreadsheet-style formula (`SUM`, `AVERAGE`, `IF`,
  `AND`/`OR`/`NOT`, comparisons, trig/log/sqrt, …) and click **▶** to actually
  compute it — no `eval`, no shell-out, runs through a small sandboxed evaluator.
  Also supports lightweight "status light" nodes and collapsible **Coupling
  Node** blocks that only materialize their content when you open them (and free
  it again when you close them).
- **Changelog & User Guide tabs** — this changelog and a full walkthrough of the
  app are now readable inside EveGlyph Editor itself (the 📖 tab, or the link
  next to the version number).
- **AI semantic search** — a second mode in the 🔍 tab (**✨ AI**, next to the
  existing **🔍 Exact**), for asking a plain-language question instead of matching
  exact text — "where do we handle authentication?" instead of guessing the exact
  wording. Uses whichever cloud AI provider is set in Settings; ranks and quotes
  the most relevant passages with a one-line reason, click a result to jump right
  to it. Kept as a clearly separate mode from exact search, not blended in — exact
  search stays a plain, predictable, non-AI tool.

### Fixed
- `examples/typst-export-demo.md`'s `split`-environment math formula has
  silently failed to render in the preview (not the PDF export) since it was
  added — KaTeX has never supported `\begin{split}`. Kept as a deliberate
  diagnostics-panel example now, with a working `aligned` companion added.
- A `::: note` / `::: warning` callout whose body was a single paragraph used to
  render a stray, visible `</div>` code block underneath it. Fixed.

## [0.4.0] — 2026-06-27

### Added
- **Diff-review UX** — an agent's changes now show as per-file cards with
  +/− line counts (shared by the agent panel and workspace-wide "Replace all"),
  collapsible, fully escaped.
- **Real permission tiers** — Cautious / Standard / Trusted now map to actual
  CLI enforcement (Claude Code tool allow-lists, Codex sandbox levels, Gemini
  approval modes), not just wording in the prompt.
- **Live agent activity panel** — see the agent's output stream while it works,
  replaced by the diff once it's done.
- **Onboarding** — a three-step empty state for a fresh clone, plus a bundled
  `examples/` workspace so there's something to open immediately.

### Fixed
- CJK text in agent output no longer shows as mojibake (the decoder now
  handles UTF-8 sequences split across stream chunks).
- A failed diff read now shows a warning instead of silently claiming
  "no changes."
- Whole-word search now correctly groups multi-word patterns.

## [0.3.0] — 2026-06-18

### Added
- **`.eveglyph/` workspace memory** — `rules.md`, `glossary.md`, and
  `memory/pitfalls.md` / `memory/recent.md` get woven into every local-agent
  run automatically, editable right in the file tree.
- **Agent modes** — Suggest (advice only) / Patch (edit + diff review,
  default) / Direct (apply immediately, one-click revert).
- **8 built-in AI presets** — clean up AI residue, academic expand,
  preserve-voice rewrite, fix KaTeX, normalize headings, extract a whitepaper
  draft, generate a changelog, audit a workspace.
- **Search & replace** — exact string/regex, current-file or workspace-wide;
  workspace replace snapshots to git first so it's always revertible.
- **EveGlyph-MD frontmatter** — a lightweight `type` / `status` / `tags`
  classification layer with a status-bar chip and preview badges.
- **DOCX import** — drag a `.docx` in, it converts to Markdown and gets a
  cleanup pass.
- **Print / Save-as-PDF** for the rendered preview.
- **Monitor tab** — a diagnostic stream of what the app and agent are doing,
  for when something needs debugging.

## [0.2.0] — open-source cleanup

### Added
- DOMPurify sanitization on all rendered Markdown (XSS hardening).
- Origin/CSRF gating on the local dev bridge — every `/api/*` request must
  look like it came from `localhost`.
- Per-file encoding detection and menu (Big5 / GBK / Shift-JIS / UTF-8 …),
  with a Settings-level fallback default.
- PatchMD git diff-review (accept/reject an agent's changes as a commit or a
  revert).
- In-file find/replace.

## [0.1.0] — prototype

### Added
- The first working editor: CodeMirror 6 + `marked` + KaTeX, a file tree and
  tabs, a Settings panel, and the local-agent bridge (Claude Code / Codex /
  Gemini detection and invocation).
