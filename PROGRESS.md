# EveGlyph Editor — Progress

> AI-readable project state. Doubles as `.eveglyph/memory/recent.md` (the context
> compiler injects mid-memory into every local-agent run). Last updated: 2026-06-18.

## What this is

EveGlyph Editor is a **local-first, agent-native Markdown workspace** (the editor half
of the EveGlyph-MD format). North star: the **workspace ↔ agent ↔ diff-review ↔ human
loop** — humans write clean Markdown, local CLI agents edit files on disk, every
change surfaces as a reviewable git diff. Front-stage minimal, back-stage strong.

Stack: vanilla ES-module frontend + CodeMirror 6, talking to a dev-only Vite plugin
bridge (`vite-agent-bridge.js`) over localhost-gated HTTP/NDJSON. ~17 `src/` modules.

## Milestones

- **v0.1 — prototype** [done]. Editor (CM6 + marked + KaTeX), file tree/tabs,
  Settings, local-agent bridge (claude/codex/gemini), AI presets, agent detection.
- **v0.2 — open-source cleanup** [shipped] (version `0.2.0`). DOMPurify XSS,
  origin/CSRF guard, monitor rotation, encoding (detect + per-file menu + Settings
  default soft-fallback), internal `cogniflow`→`eveglyph` rename, PatchMD git
  diff-review, in-file find/replace, README + SECURITY (fact-checked).
- **v0.3 — agent-native workspace** [in progress] (the main line + front-stage UX).

## v0.3 — completed

- **`.eveglyph/` memory + context compiler** (`src/context.js`) — injects
  `rules.md` + `glossary.md` + `memory/pitfalls.md` + `memory/recent.md` into the
  agent prompt; surfaced in the file tree for in-app editing; per-file scaffold.
- **context-pack.json** — the plan-layer landed to `.eveglyph/context-pack.json`.
- **Agent modes** — Suggest (advise only) / Patch (edit + diff-review, default) /
  Direct (apply + one-click revert). Whitepaper §11.2.
- **8 presets** (whitepaper App. B) — scrollable grouped list: clean / academic-expand
  / preserve-voice / fix-katex / normalize-headings / extract-whitepaper + workspace
  ones (generate-changelog, workspace-audit) + the import-fix preset.
- **Search — find** (`src/search.js`) — visible search panel, exact string/regex/case/
  whole-word, current-file or workspace scope, results list + click-to-jump.
  Human-owned navigator, NOT AI (§5.2 / §12.1).
- **Search — replace** (Phase 2, §12.3 conservative) — in-file = Ctrl+Z undoable;
  workspace = git snapshot + diff + Revert; confirm + regex warning + per-file
  failure tracking.
- **Config layer** (`src/config.js`) — the system's explicit contract: every var +
  default, tagged. State derives from it; bridge has its own `BRIDGE_CONFIG`.
- **Settings UI** — light/dark theme (CSS-var swap), editor font size + family,
  memory master + per-layer toggles, agent permission, run timeout, show-raw-output.
- **Agent permission tiers** — cautious / standard / trusted (prompt capability
  clause; trusted skips the re-confirm). Advisory, not sandboxed.
- **DOCX → MD import** (`src/import.js`) — mammoth + turndown (lazy-loaded), drag a
  `.docx` onto the editor or the "Import DOCX" button → convert → rules cleanup →
  save → open. Three-stage workflow: import → rules pass → optional AI preset.
- **Print / PDF output** — `@media print` + `window.print()` renders just the
  preview as a clean doc (Save-as-PDF). v0.3's only PDF path; Typst/Pandoc deferred.
- **EveGlyph-MD frontmatter schema** (`src/frontmatter.js`) — the document-format layer:
  `type` / `status` / `tags` (supplement memo §4.3, defined now to avoid a corpus
  backfill). Config-first contract (`config.js`: enums + flags). A tiny round-trip-safe
  YAML-subset parser that edits the raw block line-by-line, so a human's block scalars /
  nested maps / comments survive a rewrite untouched. Status-bar chip + popover to set
  the class (warns on out-of-enum); preview schema badges; new `.md` files stamped at
  birth; the active doc's class injected into the agent context as **fenced,
  enum-clamped, sanitized** metadata (treated as data, never instructions).
- **Monitor log viewer** (`src/monitorview.js`) — a back-stage "◷ Log" panel tab that
  reads back the PHOSPHOR diagnostic stream. The bridge gains a GET branch on
  `/api/monitor` that **tail-reads** (last 512 KB) the JSONL file (it lives outside the
  workspace, so this is the only safe read path), parses + caps to `limit`; the panel
  renders color-coded rows (agent/git/file/ui/error) via `textContent`, with a substring
  filter + manual/auto refresh, degrading gracefully on an old/offline bridge.
- **Gemini CLI parity** — `vite-agent-bridge.js` `findLocalGeminiExe()` resolves the
  npm-global shim (`%APPDATA%\npm\gemini.cmd`) so Gemini is detected even off-PATH,
  matching the claude/codex resolvers. (`gemini --yolo`, prompt via stdin.)
- **Cloud-AI path readiness** — Anthropic/OpenAI `fetch` path in `ai.js` reviewed against
  the Claude API reference (current model `claude-opus-4-8`, correct browser headers) and
  hardened: a `refusal` stop reason is surfaced (not blank), and OpenAI errors show the
  provider's message. Ready for real API keys.
- **Product identity / licensing** — `CONFIG.product` single source → an **About** panel
  in Settings (version, `EG-MD-2026`, author, company, license) + a `v0.3.0` topbar
  badge (`src/about.js`). MIT **LICENSE**, real `package.json` metadata (author/license),
  README "About & License" section. (EVEMISS TECHNOLOGY CO., LTD. / Neo.K, MIT, v0.3.0.)

## v0.3 — next

- (optional) make permission tiers vary the real CLI flags, not just the prompt.
- (optional) bundle for open-source: strip `node_modules` from the release zip.

After these, v0.3 nears closing → open-source push, then v0.4 (Tauri desktop — large
bridge rewrite, decide after v0.3 is stable).

## Open-source readiness (from the 2026-06-18 multi-agent audit)

**Verdict: legally + architecturally publishable today.** Licensing is clean (own MIT
+ all deps permissive/installed-via-npm with LICENSE files intact — `node_modules`/`dist`
already gitignored, so no NOTICE file gates publication). The one true gate is scrubbing
internal strategy memos before the first public commit.

**BLOCKER — DONE.** The three internal strategy memos (`當前開發狀態_v0.3`, `補充建議備忘錄`,
`novel-agent_參考提取備忘`) were deleted by Neo.K. (The whitepaper was also removed; the
broken README reference to it was fixed.)

**SHOULD-FIX — DONE 2026-06-18:**
- **Bridge `cwd` hardening** — `vite-agent-bridge.js` now pins one `confirmedWorkspace`
  (set by `/api/workspace`) and `assertWorkspace(cwd)` confines file I/O + all four
  `/api/git/*` + `/api/agent` to that folder (or a descendant). Verified: in-workspace
  reads 200; foreign `cwd` on file/git-reject/agent all 400 before any op. `SECURITY.md`
  updated to describe it accurately.
- **Deleted** `EveGlyph.html` + `Test.md`.
- **`.gitignore`** — added `.eveglyph/`, `.env*`, `*.key/*.pem/*.p12/*.pfx`; kept
  `package-lock.json` tracked.
- **README** — auto-approve-agent warning front-loaded (top), `--host` + `.eveglyph/`
  documented.

**NICE-TO-HAVE:** ~~surface diff-fetch failures (`agent.js` swallow → false "no
changes")~~ **DONE 2026-06-18** — `fetchAgentDiff()` now distinguishes a real diff-read
failure from a legit no-changes; a failure shows a "⚠ couldn't load the diff — verify
manually" warning (not "✓ no changes"). Remaining: stop empty `pre-agent` commits (drop
`--allow-empty`) + Direct-mode authorship folding; guard workspace replace while a diff
is pending; API-key persist checkbox + wire/remove the dead `persistKeys`; harden the
command-override shell path; add `engines.node>=18` + CONTRIBUTING/CHANGELOG + optional
`THIRD-PARTY-LICENSES.md`.

**Confirmed strengths:** dev-only + localhost-gated bridge (CSRF/DNS-rebind closed),
honest SECURITY.md, clean MIT licensing, stdin-fed prompts, DOMPurify XSS guard,
human-in-the-loop git diff-review. The cogniflow→eveglyph rename is complete on disk
(only stale doc text remains).

## Pending action

Restart `start-eveglyph.bat` once — to pick up the bridge changes (`BRIDGE_CONFIG`,
agent-timeout passthrough) and the new `mammoth` / `turndown` dependencies.
Everything else is already live via Vite hot-reload.
