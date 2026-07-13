# Changelog

All notable changes to EveGlyph Editor are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/) — newest first.

## [Unreleased]

### Added
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
