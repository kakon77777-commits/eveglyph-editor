# EveGlyph Editor — Progress

> AI-readable project state. Doubles as `.eveglyph/memory/recent.md` (the context
> compiler injects mid-memory into every local-agent run). Last updated: 2026-07-14
> (Typst export: all 3 phases + callout/AIMD conversion + typesetting polish).

## What this is

EveGlyph Editor is a **local-first, agent-native Markdown workspace** (the editor half
of the EveGlyph-MD format). North star: the **workspace ↔ agent ↔ diff-review ↔ human
loop** — humans write clean Markdown, local CLI agents edit files on disk, every
change surfaces as a reviewable git diff. Front-stage minimal, back-stage strong.

Stack: vanilla ES-module frontend + CodeMirror 6, talking to a dev-only Vite plugin
bridge (`vite-agent-bridge.js`) over localhost-gated HTTP/NDJSON. ~22 `src/` modules.

## Milestones

- **v0.1 — prototype** [done]. Editor (CM6 + marked + KaTeX), file tree/tabs,
  Settings, local-agent bridge (claude/codex/gemini), AI presets, agent detection.
- **v0.2 — open-source cleanup** [shipped] (version `0.2.0`). DOMPurify XSS,
  origin/CSRF guard, monitor rotation, encoding (detect + per-file menu + Settings
  default soft-fallback), internal `cogniflow`→`eveglyph` rename, PatchMD git
  diff-review, in-file find/replace, README + SECURITY (fact-checked).
- **v0.3 — agent-native workspace** [shipped] (`0.3.0`). The main line + front-stage UX.
- **v0.4 — review UX + real enforcement** [shipped] (`0.4.0`, 2026-06-27). See below.
- **v0.5 — AIMD / Cogni-Flow computable math** [in progress]. Phases 1–3 (syntax,
  two-tier compute, real mount/unmount) landed 2026-07-12, unreleased. See below.

## AMEP RigorLoop preset (whitepaper §3, resolved 2026-07-14)

§3 was a long-open three-way decision (keep the 8 presets as-is / fold 1-2 AMEP
method packs into the preset system / build a full local run-pack layer). Resolved
as a variant of option 2: **don't reimplement Method Pack logic here at all — call
Neo's already-shipped AMEP project (`evemisstechnology.com/amep`) directly.**

- New preset kind `'amep'` (`src/ai.js`'s `rigorloop` entry) — parallel to
  `'text'`/`'workspace'`, but doesn't route through `S.cfg.provider` at all (not a
  cloud API call, not a local-agent spawn).
- New `src/amep.js`: dynamically `import()`s AMEP's `runtime/browser.js` (its own
  docs state this is designed for external-site use; CORS confirmed open on every
  asset it needs before writing any code) and calls `runAMEP()` with the
  selection/document text against the `rigorloop` pack.
- **Honest framing throughout, not just in docs**: the preset's own group label in
  the AI panel reads "AMEP method pack · runs in-browser via
  evemisstechnology.com"; every result ends with a footnote clarifying RigorLoop
  is "a heuristic marker/keyword scanner... not a theorem prover or LLM call."
  Real execution runs via **Pyodide in the user's own browser tab** — AMEP has no
  hosted API by design (its own v0.1 docs defer that explicitly) — so the first
  real click in a session downloads ~14 MB (Pyodide + stdlib + all 5 packs'
  source, cached after).
- Only RigorLoop is wired (not all 5 AMEP packs) — the other four don't have a
  clear "click it in a Markdown editor" use case yet; add if/when one shows up,
  not speculatively.
- **Verified with the real, live remote code**, not mocked (unlike AI search's
  verification, which mocked `fetch` since a real API key wasn't available — this
  needs no key, so it was tested for real): a deliberately flawed test passage
  ("It is obvious that... clearly equivalent... according to Smith (2020)")
  correctly came back `partial` status, 4 claims checked, 3 findings (2 witness, 1
  equivalence) + 2 fractures, each with a concrete recommendation; a plain prose
  passage with no mathematical claims correctly came back `completed`, 0
  findings. Existing text/workspace presets re-confirmed working (mocked-fetch
  regression check) — the `ai.js` dispatch refactor didn't break them. Zero
  console/server errors.
- **This is genuinely different risk-wise from every other feature in this
  session** — loading and executing code from a different origin at runtime, not
  a local file operation — and the harness's own safety classifier treated it
  that way: it blocked even a plain `node --check` syntax validation twice,
  requiring Neo to name the exact URL explicitly rather than accept a general
  "go ahead" — a meaningfully higher bar than local-agent-adjacent actions get,
  appropriately.

## Typst WASM PDF export (2026-07-14, all 3 phases done)

Neo's long-wanted feature: real typeset PDF export, not just browser print-to-PDF.
Researched first (per Neo: "先查一下Typst WASM 套件") — confirmed a viable,
license-compatible (Apache-2.0), actively-maintained stack exists
(`@myriaddreamin/typst.ts` + `typst-ts-web-compiler` + `typst-ts-renderer`) and that
the WASM binaries can be bundled as **ordinary npm dependencies**, served same-origin
by Vite (`?url` imports), with zero runtime fetch to any external CDN — this is what
makes it a normal build-time dependency rather than a "load and execute remote code"
action (the latter is the pattern used by [[AMEP RigorLoop]] and needs Neo's explicit
per-URL sign-off; this doesn't, since nothing crosses an origin boundary at runtime).
3-phase plan, approved in full ("開始吧。麻煩了。"):

- **Phase 1 — compiler plumbing** [done]. New `src/typstexport.js`:
  `compileTypstToPdf(source)` / `compileTypstToSvg(source)` configure `$typst`
  (typst.ts's utility API) via `setCompilerInitOptions({ getModule: () =>
  compilerWasmUrl, beforeBuild: [...] })`, pointing `getModule` at the
  Vite-bundled `typst_ts_web_compiler_bg.wasm` instead of the package's own
  default (which can fetch from jsdelivr). Renderer WASM
  (`typst_ts_renderer_bg.wasm`) wired the same way, used by `compileTypstToSvg`.
  **Verified live in-browser** (dev server, dynamic import of the real module, no
  mocks): `compileTypstToPdf('= Hello World\n\nThis is a test.')` returned 2710
  real PDF bytes starting `%PDF-1.7` in ~290ms. `read_network_requests` confirmed
  every request (module, both `.wasm` files) stayed on `localhost:5174` — zero
  external calls. Zero console errors.
- **Phase 2 — Markdown→Typst converter** [done]. New `src/typstconvert.js`:
  `markdownToTypst(source)` strips frontmatter (`parseFrontmatter`), pulls out
  `$...$`/`$$...$$` math spans before tokenizing (protects them from marked
  misreading `_`/`*`/`\` inside math as Markdown syntax), walks `marked.lexer()`'s
  token tree emitting Typst markup (headings/bold/italic/strikethrough/code
  spans+blocks/links/images/blockquotes/ordered+nested lists/tables/hr), then
  splices the math back in converted via `tex2typst`. **Font gap found and
  resolved during verification**: math compilation hard-errors ("no font could be
  found") with zero fonts loaded — typst.ts's default is a jsdelivr CDN fetch of
  its "text" font set (DejaVuSansMono/LibertinusSerif/NewCM10/NewCMMath) on first
  compile. Per Neo's explicit choice (self-host, not CDN — 2026-07-14), those 17
  files (~8.4MB, `github.com/typst/typst-assets@v0.13.1`) were downloaded into
  `public/fonts/typst/` and are now loaded via
  `initOptions.preloadFontAssets({ assets: ['text'], assetUrlPrefix:
  '/fonts/typst/' })` — same-origin, no CDN. CJK coverage (Neo writes Traditional
  Chinese) is a separate Phase 3 decision; this set has no CJK glyphs.
  **Verified live in-browser**: a full test document (heading, bold/italic/code/
  link, inline + block math, nested + ordered lists, blockquote, code block,
  table, hr) round-tripped through `markdownToTypst` → `compileTypstToPdf` →
  34058 real PDF bytes (`%PDF-1.7`), and separately through `compileTypstToSvg` →
  a 62KB SVG with a correct A4 viewBox (`596×842`). All 17 font requests +
  both WASM files confirmed same-origin via `read_network_requests`. Zero console
  errors. (Visual screenshot of the rendered SVG was attempted but the preview
  browser's screenshot capture was unresponsive at the time — not a code issue,
  the non-visual checks above are real, unmocked verification.)
  Known gap, stated honestly in the code: EveGlyph-MD extras (`::: type ... :::`
  callouts, AIMD compute blocks) aren't converted yet — raw fence syntax passes
  through as literal escaped text rather than a styled block. Fine for now since
  this phase's scope was plain Markdown + math; revisit before this is the
  primary export path for documents that actually use those blocks.
- **Phase 3 — UI integration** [done]. New topbar **PDF** button (next to Print),
  new `src/typstui.js`: `exportActiveAsPdf()` reads the active `.md` file
  (`editorGet()`), converts + compiles, then triggers a real browser download
  (`Blob` + `<a download>`). Button shows "Compiling…"/disabled while running;
  errors surface via `alert()` (this codebase's existing convention — see
  `ai.js`/`files.js`/`import.js`) instead of throwing silently.
  **CJK gap found via real testing** (see below) **and resolved**: Typst's own
  `'cjk'` asset bundle only has a Simplified-Chinese-tuned Noto font — wrong
  glyph shapes for Neo's Traditional Chinese documents. Per his explicit choice,
  downloaded Noto Serif TC (variable font, all weights in one file, OFL,
  `github.com/google/fonts`, ~16.85MB) into `public/fonts/typst/`, loaded via
  `initOptions.loadFonts(['/fonts/typst/NotoSerifTC-Variable.ttf'], {assets:
  ['text'], assetUrlPrefix: '/fonts/typst/'})`. First-export download is now
  ~51MB total (compiler ~27MB + fonts ~24MB), same-origin.
  New demo file `examples/typst-export-demo.md` (bilingual, headings/bold/
  italic/code/links/math/lists/blockquote/table/hr, written specifically to
  stress-test the converter on real mixed-language content, not synthetic
  snippets).
  **Verified twice, both times through the real UI code path** (`loadWorkspacePath`
  → `openFile` → `exportActiveAsPdf`, the exact same functions the button's
  click handler calls — not a hand-rolled shortcut): first without a CJK font
  (93KB PDF, but Chinese text would have been tofu), then again after adding
  Noto Serif TC. Both runs: real `%PDF-1.7` bytes captured via a
  `URL.createObjectURL` intercept, zero `alert()` calls, button correctly
  re-enabled with its original text afterward, zero console errors.
  **CJK glyph correctness specifically verified** (screenshot tool was
  unresponsive again this session, so this needed a non-visual proof): compiled
  isolated test strings to SVG and compared glyph path-data complexity — a
  1-stroke character ("一") produced a 168-character path, four complex
  Traditional characters ("繁體驗證", 12-19 strokes each) produced 2784-3908
  character paths scaling with stroke count, while a genuinely unassigned
  codepoint (the true tofu/notdef baseline) produced a flat, unrelated 812
  every time — proving real glyph shapes are being drawn, not a placeholder box.
  New `compileTypstToPdfWithDiagnostics()` in `typstexport.js` (requests
  Typst's own compiler diagnostics) added along the way — didn't end up
  answering the CJK question (missing-glyph fallback isn't flagged as a
  diagnostic), but kept since real Typst syntax-error messages would be a much
  better error surface than a generic JS exception, for later.
  Still-open known gap, same as Phase 2: callouts/AIMD blocks pass through as
  literal text, not yet converted.

### Callout/AIMD conversion + typesetting polish (2026-07-14, done)

Closed the gap immediately above, plus general document-quality polish. Neo's
own local Chrome downloads generated PDFs to `D:\Ai\work together\eveglyph-
editor\demo\` — that's now the standing convention for this project's local
Typst testing output (gitignored — regenerable, not source).

- **`::: type {title="..."} ... :::` callouts** now become colored Typst boxes
  (`#block` with a left border + tinted fill), color-matched to `styles.css`'s
  existing `.cfp-*` palette so a printed doc looks like the in-app preview:
  definition (blue), theorem (purple), lemma (light purple), note (amber),
  warning (red), proof (neutral + italic label), unknown types fall back to
  gray. Inner content is recursively converted through the normal Markdown→
  Typst pipeline, so bold/math/links/etc. all still work inside a callout.
- **`::: aimd ... :::` blocks** get a static print rendering — no compute
  buttons (nothing to click on paper) and no collapsed Coupling Nodes
  (nothing to "fold" once printed, so their content is materialized inline
  instead): `@Key: value` meta lines become a small gray header line, trunk
  nodes (`> [D_G=N, λ=...] text`) become a tagged box, `Logic_Node` status
  lines become a colored bullet + the state/coherence/verifier as written
  (last-known value, not re-computed), `<Coupling Node>` blocks become a
  bordered box with their content shown directly.
- **Document-level typesetting preamble** (prepended to every compile):
  explicit font stack (Libertinus Serif → Noto Serif TC fallback, rather than
  leaving font choice to the compiler's implicit search), A4 page with sane
  margins, justified paragraphs, a real heading size/spacing hierarchy
  (levels 1-4+, no auto-numbering), light-gray backgrounds for code blocks
  (block and inline), blue link color, and striped table headers. Tested
  standalone before wiring in.
- **Math formula conversion itself needed no changes** — `tex2typst` was
  already producing correct, idiomatic Typst for a broad real-world test set
  (fractions, sums, integrals with limits, matrices, `\mathbf`/`\mathbb`,
  Greek letters, `\nabla`/`\cdot`, `\forall`/`\exists`/`\in`, comparison
  operators) before touching anything — verified by inspecting the converter
  output directly, not just "it compiled."
- **Found and fixed a real, latent Phase-2 bug along the way**: marked's
  inline tokenizer pre-escapes bare `&`/`<`/`>`/`"`/`'` into HTML entities
  inside plain 'text' tokens (a defense for its own HTML renderer, irrelevant
  here) — so `t.text` for "A <---> B" arrived as `"A &lt;---&gt; B"`, and the
  converter's `esc()` was Typst-escaping the ALREADY-escaped entity text
  verbatim, leaking literal `&lt;`/`&gt;` into any exported doc that had a
  bare `<`, `>`, or `&` in ordinary prose. Never triggered by earlier test
  content (no test happened to include those characters) until the AIMD demo's
  Coupling Node text ("...<---> ...") exposed it. Fixed with a small
  `unescapeHtmlEntities()` decode step inside `esc()`, before Typst's own
  escaping runs.
- **Verified**: a combined test (all 6 callout types + AIMD with a pending
  `狀態: ?` node + a Coupling Node containing `<--->`) compiled clean, zero
  Typst diagnostics, no stray HTML entities in the generated Typst source.
  The demo file (`examples/typst-export-demo.md`) was updated to actually
  exercise callouts + AIMD (it predated this feature) and re-run through the
  real UI path end-to-end: 121519 real PDF bytes, `%PDF-1.7` header, 2 pages,
  valid trailer/EOF — written to `demo/typst-export-demo.pdf` for Neo to open
  and eyeball (screenshot tooling was still unresponsive this session, so a
  human visual check is the remaining verification step, not something this
  session could close the loop on itself).

## AI semantic search (whitepaper §12.2, 2026-07-12)

Long-noted gap closed: `search.js`'s header comment had said "AI semantic search is
a separate future track, §12.2" since v0.3 — now built, as a genuinely separate mode
(not blended into the exact/regex navigator, which stays deliberately non-AI per
§5.2/§12.1's "human-owned" framing).

- **Design**: no dedicated embeddings index — one-shot, reuses the cloud AI provider
  already configured in Settings (Anthropic or OpenAI-compatible). The corpus (current
  file, or as many workspace files as fit) is sent as plain prompt context; the model
  is asked to return a strict JSON array of `{file, snippet, reason}`, where `snippet`
  must be an exact verbatim quote (used afterward to locate the passage for
  click-to-jump via a plain `indexOf`). Capped at `CONFIG.aiSearch.maxContextChars`
  (60k chars, ~15k tokens) — if the workspace is bigger, an honest "only searched N
  files" note shows instead of silently missing the rest.
- **Refactor**: `ai.js`'s `aiCall()` (the AI panel's send button) was tightly coupled
  to the `#ai-resp` DOM. Extracted the actual Anthropic/OpenAI fetch logic into a new
  `callAiProvider(prompt)` that just returns text — `aiCall()` now wraps it for the
  panel, and `aisearch.js` calls it directly. No behavior change for the existing AI
  panel (verified — same responses, same error handling).
- **New**: `src/aisearch.js`, a `✨ AI` mode next to `🔍 Exact` in the Search tab
  (`.smtab` mode-toggle, reusing the `.ptab` tab-switching visual language). Clear
  errors when the provider is Local Agent (different call shape — spawn+stdin, not
  chat-completion) or no API key is set, rather than a confusing failure.
- **Verified end-to-end**, including the parts that don't need a real API key:
  mode toggle switches panels correctly; local-agent/no-key error paths show the
  right message; workspace-scope corpus assembly correctly gathers multiple files
  under the char cap. The actual provider round-trip was verified by mocking
  `fetch` to intercept the exact Anthropic/OpenAI request URLs and return a
  realistic canned response shaped like each provider's real API — this exercises
  the REAL `callAiProvider` code path (request building, response parsing) without
  needing real credentials. Confirmed: a normal JSON response renders and its
  result correctly jumps to the exact snippet in the editor (verified via the
  actual CodeMirror selection, not just the DOM); a response wrapped in
  ` ```json ` fences (common model behavior despite being told not to) still
  parses correctly; an empty-array response shows "No relevant passages found."
  honestly; both Anthropic and OpenAI-compatible branches tested. Regression-
  checked: exact search still works after the HTML restructuring (mode tabs
  wrapping both panels). Zero console/server errors throughout.

## In-app docs (2026-07-12)

Long-standing gap, finally closed: there was no human-visible way to tell what
changed release to release, or how to actually use the app, without reading
`PROGRESS.md` (AI-oriented) or digging through the repo. Two new files, both
rendered **inside the app itself**, not just on GitHub:

- **`CHANGELOG.md`** — human-readable, "Keep a Changelog" style, newest first.
  Distinct from `PROGRESS.md`: this is what changed and why it matters to a user,
  not the AI-context-dump of *how* + every implementation/bugology detail.
- **`USER-GUIDE.md`** — a full walkthrough: getting started, the workspace,
  writing (EveGlyph-MD, AIMD blocks), search, AI panel + local agent + diff
  review, `.eveglyph/` memory, settings reference, troubleshooting.
- **`src/docs.js`** — imports both via Vite's `?raw` string import, renders them
  through the same marked+DOMPurify pipeline `preview.js` already uses (static
  content, rendered once at boot, not on every keystroke). New **📖 Docs** tab in
  the right panel (`#t-docs`), with two nav buttons (📘 Guide / 🕘 What's New)
  that scroll to the relevant section.
- New **"What's new"** link in the topbar, right of the version badge — jumps
  straight to the changelog section.
- **Verified working** (after fixing two real bugs found along the way):
  1. `openDocsSection()` originally deferred the `scrollIntoView` call via
     `requestAnimationFrame` — rAF is throttled (can silently never fire) in a
     backgrounded/unfocused tab, which is exactly the state browser-automation
     testing runs in. Removed the deferral entirely: `scrollIntoView` triggers
     its own synchronous layout pass, so it doesn't need to wait a frame even
     right after un-hiding the tab (`display:none` → `flex`).
  2. Both `.md` files open with their own top-level `# Title` heading, and the
     renderer was ALSO wrapping each section in its own injected `<h1>` — a
     harmless but sloppy duplicate heading. Dropped the injected wrapper.
  Confirmed via the real UI (topbar link + both in-panel nav buttons all
  correctly switch to the Docs tab and scroll to the right section; content
  renders with the expected text) — the `computer` tool's screenshot/coordinate-
  click pipeline was flaky again this session (same as earlier in this session),
  so this was verified through direct DOM/handler inspection rather than a
  visual screenshot; worth a quick visual confirmation next time the Browser
  pane's screenshot action is behaving.

## v0.5 — in progress (started 2026-07-12)

New technical whitepaper written: `EveGlyph-Editor-Technical-Whitepaper-v0.5.md`
(project root, **deliberately kept local/uncommitted** — same precedent as the
original implementation whitepaper, which was pulled before the public repo's first
commit). It reconstructs the real v0.4.0 architecture from `whitepaper §N` comments
left in the source (the original doc itself didn't survive the Noema→EveGlyph rename),
flags that NoemaPad v0.1's AMEP Method Pack selector was never actually built (`ai.js`
only has 8 lightweight presets — this is an open, non-blocking decision, §3 of the new
doc), and adds a new layer: **AIMD / Cogni-Flow Protocol**, real-time computable math
(backend formal verification via Python/LEAN4/Coq, front-end as a lightweight
state-tag/hash-pointer projector, on-demand DOM mount/unmount) — Neo confirmed this was
always intended, not a new idea.

**AIMD Phase 1 — landed** (syntax recognition + static collapse/expand skeleton, no
backend yet — that's Phase 2's `/api/compute`):
- New `::: aimd ... :::` block type in `src/preview.js` (`renderAimdBlock`), reusing
  the existing `::: type ... :::` callout mechanism rather than inventing a new
  top-level syntax — can't collide with ordinary prose elsewhere in a document.
- Recognizes three node kinds: `@Key: value` meta header lines, main-trunk nodes
  (`> [D_G=N, λ=...] text`, always rendered), status-projection nodes (`[Logic_Node:
  ID] 狀態: X | 相干度: Y | 驗證器: Z`, rendered as a colored status-light chip —
  green/amber/red/gray by 狀態 keyword), and `<Coupling Node: LABEL>...</Coupling>`
  fold blocks (native `<details>`/`<summary>`, collapsed by default — this IS the
  "on-demand realization" the whitepaper describes, purely client-side for now).
- New styles in `src/styles.css` (`.aimd-*`, inserted after `.cfp-warning`).
- Demo file `examples/aimd-demo.md` added to the onboarding workspace.
- **Verified working** in the running dev app (frontmatter, trunk node, all three
  status-light colors, and the coupling fold/expand all render correctly; zero
  console errors) — verification was DOM-level via `javascript_tool` (dynamic
  `import('/src/files.js')` → `loadWorkspacePath` + `openFile`, then inspecting
  `#preview-body`), not a visual screenshot — the Browser pane's screenshot action was
  timing out for unrelated infra reasons this session; re-attempt a real screenshot
  next time the browser pane is available before calling this visually confirmed.

**Found in passing, NOT fixed here (out of scope, flagged as a separate task
`task_bec7b1db`):** the pre-existing generic `::: type ... :::` callout path (same
function, the non-`aimd` branch) has a template whitespace bug — a single-paragraph
callout body (e.g. `welcome.md`'s `::: note` / `::: warning`) renders a stray visible
`<pre><code>&lt;/div&gt;</code></pre>` after it, because the template's own `\n` plus
`marked.parse()`'s trailing `\n` creates a blank line that prematurely terminates
CommonMark's raw-HTML-block recognition. Unrelated to AIMD, pre-dates this work.

**AIMD Phase 2 — landed, redesigned mid-flight into two explicit tiers** (Neo's
call, 2026-07-12: general use = spreadsheet-style formulas; formal proof
verification = a separately-gated, higher-trust tier, not built yet):

- `Logic_Node` syntax gained an optional `| expr="..."` slot: `[Logic_Node: ID |
  expr="SUM(1,2,3,4) = 10"] 狀態: ? | 相干度: ? | 驗證器: formula`. When present, a
  **▶ button** renders next to the status chip.
- New `/api/compute` endpoint in `vite-agent-bridge.js`, workspace-gated like every
  other endpoint (`assertWorkspace`), POST-only, triggered **only by an explicit
  click** — nothing computes automatically on render or file-open (same "human
  confirms" gate as the rest of the app).
- **Tier 1 — `驗證器: formula`** (available at every permission tier): a hand-rolled,
  sandboxed spreadsheet-formula evaluator (tokenizer + recursive-descent parser).
  **No `eval`/`Function`, no shell-out** — a document's `expr` is agent-writable/
  untrusted content, so the worst a malformed expression can do is throw a parse
  error. Grammar: arithmetic (`+-*/^`, unary minus), comparisons (`=`/`<>`/`>`/`<`/
  `>=`/`<=`, usable anywhere, not just top-level), `sin/cos/tan/asin/acos/atan/sqrt/
  ln/log/abs/exp/power/mod/round`, `pi`/`e` (+ Excel-style `PI()`), and the Excel-
  familiar aggregate/logical set `SUM/AVERAGE/MIN/MAX/COUNT/IF/AND/OR/NOT` (`IF`/
  `AND`/`OR`/`NOT` short-circuit — they get the raw AST, not eagerly-evaluated args,
  so e.g. an unchosen `IF` branch never runs). A boolean result (any comparison, or
  anything built from one) maps to Verified/Failed; a numeric result maps to
  "Computed" with the value as `coherence`. Text Excel functions (`CONCATENATE`,
  `TEXT`, `LEFT`/`RIGHT`, …) are a deliberate scope cut — everything here is numeric/
  boolean only.
- **Tier 2 — `驗證器: lean4|coq|python`** (formal verification): gated server-side
  behind the **Trusted** permission tier (mirrors `/api/agent`'s existing `permission`
  field/enforcement — same field name, same client→server flow). Below Trusted:
  honest "requires Trusted permission tier." At Trusted: still honest "not wired yet
  — sandboxing policy (subprocess isolation/timeouts/resource limits) is still an
  open product decision," not a fake result and not an actual unsandboxed shell-out.
- Frontend (`src/preview.js`): `runAimdCompute()` posts `{cwd, node_id, expr,
  verifier, permission}` (permission sourced from `S.cfg.agentPermission`, same as
  the agent bridge) and patches the specific `.aimd-status` row in place (dot color,
  state text, coherence text) — no full re-render needed.
- Demo rewritten: `examples/aimd-demo.md` now demonstrates both tiers — four Tier-1
  `expr=` nodes (plain arithmetic, `SUM`, nested `IF`+`AVERAGE`, `AND`+comparisons)
  and one Tier-2 `lean4` node showing the permission gate.
- **Verified end-to-end** in the running app: all four Tier-1 buttons → correct
  Verified results (including the nested `IF(AVERAGE(...)>5,1,0)=1` and
  `AND(3>2, 10=SUM(3,3,4))` compound expressions); the Tier-2 node at default
  Standard permission → correctly blocked with the "requires Trusted" message;
  switching `S.cfg.agentPermission` to `trusted` and re-clicking → correctly
  switches to the "not wired yet" message instead. Zero console/server errors
  throughout. (Earlier in the same session, before this two-tier redesign, the
  Failed/Unsupported/workspace-gate-rejection paths were also individually
  confirmed against the single-tier version — the evaluator internals changed but
  those honesty guarantees still hold, same `aimdCompute` return contract.)

**AIMD Phase 3 — landed** (real DOM mount/unmount, not just CSS show/hide):
- A Coupling Node's `<details>` now renders **without** its body in the initial
  markup. `wireAimdInteractions` (renamed from `wireAimdCompute`, now handles both
  the Phase 2 click delegation and this) listens for the native `toggle` event and
  mounts a fresh `.aimd-coupling-body` div on open, removes it on close — genuine
  "on-demand realization" + attention-loss release, per whitepaper §4.3/§4.6. Honest
  framing: this is DOM materialize/free, not a network fetch — the content is local
  document text already in memory, there's no remote base-space to fetch from yet.
- `toggle` does **not bubble**, so event delegation needed the capture phase
  (`el.addEventListener('toggle', handler, true)`) — a plain bubble-phase delegated
  listener would silently never fire for descendant `<details>` elements.
- **Bug found + fixed during this work, worth recording (Bugology, whitepaper
  §9.4-style)**: the first implementation stored each Coupling Node's body text in a
  `data-content="..."` HTML attribute (fully `esc()`-escaped). It silently
  disappeared for real document content — e.g. `Target: X <---> Y` — even though
  the escaped value (`&lt;---&gt;`) was syntactically valid and harmless. Root
  cause: **DOMPurify's mXSS defenses strip an attribute if its value merely
  contains certain dash/bracket patterns**, regardless of correct escaping — this
  is DOMPurify erring toward caution against known browser HTML-parsing quirks, not
  a bug in DOMPurify itself. Lesson: don't trust arbitrary/untrusted document text
  inside an HTML attribute value, even properly escaped — the sanitizer's own
  heuristics can silently eat it, and the failure is invisible (no error, no
  console warning, the attribute just isn't there). **Fix**: moved the content into
  a JS-side array (`aimdCouplings`, reset once per `previewUpdate()` call) and
  reference it from the DOM by a small integer `data-coupling-idx` — plain digits
  can't trigger this class of stripping, and reading the content back via
  `.textContent` (not `innerHTML`) needs no escaping at all, which is also simpler
  than the attribute version was. Applies generally: any future AIMD (or other)
  feature that needs to stash untrusted text for later DOM use should use this
  index-into-a-JS-store pattern, not a data-attribute.
- Demo (`examples/aimd-demo.md`) already had the `<--->` arrow in its Coupling body
  text — that's what surfaced the bug during verification, not a separately
  crafted test case.
- **Verified end-to-end**: open → body mounts with the exact original content
  (arrows and CJK both intact); close → body element is actually removed from the
  DOM (`querySelector` returns null, not just hidden). Phase 1 (trunk/status
  rendering) and Phase 2 (all 4 formula-tier computes + the Tier-2 gate) re-verified
  working after this change. Zero console/server errors throughout.
- **Second bug found + fixed in the same review pass**: the `AIMD_COUPLING_N`
  line-placeholder token (used internally to swap out multi-line `<Coupling
  Node>...</Coupling>` blocks before line-by-line processing) was originally
  wrapped in literal NUL bytes rather than spaces, specifically so it would survive
  `line.trim()` (NUL isn't stripped by `.trim()`; a space is). This "worked" but was
  invisible in every tool used to read the file back — including making git treat
  `preview.js` as a binary diff. Replacing the NUL bytes with real spaces (an
  initially-reasonable-looking cleanup) broke the placeholder match, since `.trim()`
  then strips the very whitespace the regex needed. **Real fix**: dropped the
  delimiter-character trick entirely — the placeholder is now a self-sufficient
  string (`AIMD_COUPLING_PLACEHOLDER_N`) matched by a plain `^...$` regex with no
  surrounding-whitespace dependency at all. `preview.js` is confirmed plain UTF-8
  text now (`file` reports "JavaScript source, Unicode text, UTF-8 text", not
  binary), and the diff is properly reviewable. Lesson: don't rely on control
  characters for parser plumbing even when they "work" — they're invisible to every
  tool (including Read/Grep) that would otherwise let a reviewer (human or agent)
  actually see what the code does.

**Next (whitepaper v0.5 §4.6 roadmap):** Real LEAN4/Coq/Python integration, gated on
Neo deciding the sandboxing policy first (subprocess isolation/timeouts/resource
limits) — the only AIMD roadmap item left that isn't already shipped. §3's AMEP
Method Pack decision is still open, doesn't block any of this.

## v0.4 — shipped (2026-06-27)

The "0.4-lite" line — decoupled from the Tauri desktop rewrite, which stays the real v0.4
headline on the roadmap. Shipped today:

- **Bug-fix + cleanup batch** — `.eveglyph/memory/pitfalls.md` path corrected; a failed
  diff-read now surfaces a warning instead of a false "no changes" (`fetchAgentDiff`);
  whole-word regex search groups the pattern (`\b(?:…)\b`); the agent output stream uses a
  stateful UTF-8 decoder (fixes CJK mojibake from chunk-split sequences); dead `persistKeys`
  removed; stale config tags + mojibake comments fixed; Ctrl+F coheres (CodeMirror in-file
  search inside the editor, the workspace Find panel elsewhere).
- **Diff-review UX** (`src/diffview.js`) — one shared renderer for the agent panel and
  replace-all: a unified diff grouped into per-file cards with +/− counts, collapsible,
  fully escaped (untrusted agent/git output).
- **Real permission tiers** — Cautious / Standard / Trusted now flow to the bridge and map
  to actual CLI flags (Claude `--permission-mode` + tool allow-list, Codex `--sandbox` /
  bypass, Gemini `--approval-mode`), not just a prompt clause.
- **Live agent activity panel** — a transient "working…" view streams the agent's output
  tail (respecting the quiet setting), replaced by the diff on completion.
- **Onboarding + `examples/` workspace** — a three-step empty state, plus a bundled sample
  workspace (EveGlyph-MD docs + a starter `.eveglyph/`) so a fresh clone has something to
  open immediately.

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

**BLOCKER — DONE.** The internal strategy memos were removed before the first public
commit. (The draft whitepaper was also removed; the broken README reference to it was fixed.)

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
manually" warning (not "✓ no changes"). **Remaining items — ALL DONE 2026-07-12:**

- ~~stop empty `pre-agent` commits (drop `--allow-empty`)~~ **DONE.** New
  `commitIfChanged(cwd, message)` helper in `vite-agent-bridge.js`: commits only when
  `git diff --cached --quiet` reports a real staged diff, or when there's no `HEAD`
  yet at all (a truly fresh repo needs one commit to have a valid baseline — that's
  the only case still allowed to be empty). Used by both `/api/git/snapshot` and
  `/api/git/accept`, replacing the old unconditional `--allow-empty` on every single
  call. Verified directly against the bridge: a snapshot immediately followed by a
  no-op snapshot correctly produces the SAME head (no new commit); a snapshot after
  a real file change correctly produces a new commit; a no-op accept after that
  correctly produces no further commit. Confirmed via `git log` on the test
  workspace (exactly 2 commits for 2 real changes, not 3+ for the no-ops).
- ~~Direct-mode authorship folding~~ **DONE.** Direct mode (and the "suggest but the
  agent edited anyway" fallback) had no manual Accept gate (`showDiffActions` hides
  the button), so the changes just sat uncommitted — and the *next* run's pre-agent
  snapshot would silently sweep them into an anonymous `pre-agent: ...` commit,
  misattributing the agent's actual edit as pre-existing baseline state. New
  `commitDirectChanges(cwd, message)` in `src/agent.js` auto-commits immediately
  under the task's own `agent: <message>` — called right where Direct mode's diff
  gets shown. `S._pendingReview` gained a `committed` flag so Revert
  (`rejectReview()` → `/api/git/reject`) knows to reset to `HEAD~1` (past the
  auto-commit, back to the real pre-agent snapshot) instead of plain `HEAD` (which
  would now just be the auto-commit itself — a no-op). Verified end-to-end against
  the bridge: simulated a Direct-mode edit → accept (auto-commit) → reject with
  `committed: true` → file content and `git log` both confirmed a full round-trip
  back to the pre-agent baseline, auto-commit cleanly discarded.
- ~~guard workspace replace while a diff is pending~~ **DONE.** `replaceAll()`'s
  workspace-scope branch now checks `S._pendingReview` before doing anything —
  blocks with a clear on-screen message ("an agent diff is still pending review...")
  instead of silently snapshotting on top of (and thereby folding in) an unreviewed
  agent diff. Verified: setting `S._pendingReview` and calling `replaceAll()`
  correctly blocks with the message; clearing it and re-running confirms no
  regression (replace still works normally).
- ~~API-key persist checkbox + wire/remove the dead `persistKeys`~~ **DONE** (the
  `persistKeys` half was already moot — confirmed zero references anywhere in
  `src/` or the bridge; the v0.4 cleanup had already deleted it, the TODO line was
  just stale). New "Remember on this device" checkbox next to the API Key field
  (`#s-key-persist`, defaults checked = today's existing always-persist behavior,
  so nothing changes for existing users unless they explicitly opt out).
  Unchecking it keeps the key working for the current session (`S.cfg.key` in
  memory) but writes an empty string for `key` in the copy that goes to
  `localStorage`. Verified: unchecked → key usable immediately but NOT in
  localStorage; checked → key round-trips correctly through a simulated
  save/reload cycle.
- ~~harden the command-override shell path~~ **DONE.** The override "owns the whole
  command" (runs completely unmodified, no escaping) — which means it silently
  bypassed every permission-tier restriction regardless of the selected tier.
  `resolveAgentCommand()` now throws if an override is set and permission isn't
  `trusted`, with a message explaining why; `/api/agent` catches this and returns a
  clean 400 (was previously unhandled — would have surfaced as a raw uncaught
  exception). `src/agent.js`'s error path was also fixed to read and show the
  bridge's actual response text instead of a bare "bridge HTTP 400" — the detailed
  reason was being thrown away before. Added an inline warning at the Settings
  field itself, not just in SECURITY.md. Verified: Standard permission + an
  override → correctly blocked with the exact message; Trusted permission + the
  same override → correctly allowed through (tested with a harmless `echo`).
- ~~add `engines.node>=18`~~ **DONE** — `package.json`.
- ~~CONTRIBUTING~~ **DONE** — new `CONTRIBUTING.md` (setup, pre-PR checklist
  emphasizing "run it, don't just read the diff" for this UI-heavy app, code style,
  security-reporting pointer). CHANGELOG was already done earlier the same day (see
  the "In-app docs" section above).
- `THIRD-PARTY-LICENSES.md` — left undone, deliberately: the 2026-06-18 audit
  already concluded licensing is clean (own MIT + all deps permissive, no NOTICE
  file gates publication) without one; it was marked optional in the original TODO
  and nothing has changed that would require it now.

**Confirmed strengths:** dev-only + localhost-gated bridge (CSRF/DNS-rebind closed),
honest SECURITY.md, clean MIT licensing, stdin-fed prompts, DOMPurify XSS guard,
human-in-the-loop git diff-review. The cogniflow→eveglyph rename is complete on disk
(only stale doc text remains).

## Pending action

Restart `start-eveglyph.bat` once — to pick up the bridge changes (`BRIDGE_CONFIG`,
agent-timeout passthrough) and the new `mammoth` / `turndown` dependencies.
Everything else is already live via Vite hot-reload.
