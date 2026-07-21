# EveGlyph Editor — Progress

> AI-readable project state. Doubles as `.eveglyph/memory/recent.md` (the context
> compiler injects mid-memory into every local-agent run). Last updated: 2026-07-21
> (roadmap Phase 4 — Typst Theme Compiler + AIMD-C Projection connection).

## Typst Theme Compiler + AIMD-C Projection (roadmap Phase 4, 2026-07-21)

Fourth phase of the roadmap (`EveGlyph-Editor-Roadmap-v0.6.md`, internal repo
only): "多後端渲染 Phase 3 — Typst Theme Compiler ＋ AIMD-C 的 Projection 銜接".
Two deliverables, both from the Multi-Backend Semantic Rendering whitepaper's
§5.1 ("Theme Token + Layout Profile + Publication Rules → Typst Program") and
§8.1 (Backend Registry spanning every rendering domain, not just math).

- **Theme Token + Layout Profile system** — new `src/typst/theme.js` (2
  themes: `evemiss-serif-light`, the default, and `evemiss-classic-light`;
  each declares typography, scale, colors, spacing) and `src/typst/layout.js`
  (3 layouts: `academic-paper`, `technical-whitepaper` — the default —, and
  `long-form-book`; each declares page size/margins, paragraph rules, and
  whether equations get numbered). `src/typst/preamble.js`'s `buildPreamble()`
  combines a theme + layout into real Typst `#set`/`#show` rules, replacing
  `typstconvert.js`'s previously-hardcoded `PREAMBLE` string outright. A
  document opts in via frontmatter (`typst_theme:` / `typst_layout:`); with
  neither set, output is byte-for-byte the same PDF as before this phase — an
  explicit backward-compatibility goal, not an accident. Caught and fixed
  twice during testing: the default theme's font scale (`19pt/15pt/13.5pt`)
  didn't match the original hardcoded values (`17pt/13.5pt/11.5pt`), and the
  default layout shipped with `numbering.equations: true` when the original
  preamble never numbered equations — both would have silently changed
  default output for documents that never opted into anything new. Fixed to
  match exactly.
- **Semantic component numbering** — Theorem/Lemma/Definition callouts now
  get real sequential numbers (`Theorem 1`, `Theorem 2`, ...) via Typst's
  `#counter("eg-theorem").step()` + `#context counter(...).display()`
  mechanism (Typst 0.12+ requires `#context` to read a live counter value —
  confirmed via an isolated test before wiring into `calloutBox()` for real).
  Equation numbering (`#set math.equation(numbering: "(1)")`) is wired the
  same way, gated by the layout profile's `numbering.equations` flag —
  off by default (see above), on for `academic-paper`.
- **AIMD-C → Typst Projection** — the actual "Projection meets Backend
  Router" deliverable: AIMD-C blocks (`aimd-value`/`function`/`compute`/
  `assert`/`table`/`view`) now render as real typeset Typst output in PDF
  export, not the placeholder callout box they fell back to since Phase 3.
  `typstconvert.js` imports `aimdc/parser.js` and `aimdc/graph.js` directly
  (both pure logic, no DOM dependency, confirmed reusable as-is) and runs a
  parallel Typst renderer (`renderAimdcBlockTypst`, `renderAimdcTableTypst`,
  ...) mirroring `render.js`'s HTML renderer block-for-block, using the same
  two-pass placeholder-then-substitute pattern `preview.js` already uses for
  HTML — placeholders emitted during body conversion, then replaced once the
  whole document's dependency graph has evaluated (a block's result can be
  referenced from anywhere in the document, same reasoning as Phase 3's HTML
  path), then `{{ id.field }}` inline refs resolved from that same evaluated
  graph. One real bug found and fixed: the `aimd-view{renderer="formula"}`
  case generated Typst math source like `$ area = 12.57 
  
 — Typst math
  mode treats bare multi-letter words as variable references, not literal
  text, so this failed to compile with "unknown variable: area". Fixed by
  quoting the label as a string literal (`$ "area" = 12.57 
  
`).
- **World IR registered in the Backend Registry, by name only** — per Neo's
  confirmed decision going into this phase (World IR stays exactly as-is, no
  internal refactor to `viewregistry.js`/`validate.js`). New
  `src/visual/registry.js` is a deliberately thin stub: one entry
  (`world-renderer`) so the Backend Registry concept has an honest presence
  for the visual domain instead of silently omitting the one backend type
  that was explicitly discussed. It is not yet wired into any render path —
  full Visual IR (chart/diagram/function-plot projections, capability
  negotiation, safe rewrite, mirroring what Phase 1–2b built for math) is
  roadmap Phase 5, not this one.
- **Verified**: `examples/aimd-demo.md` (all 14 blocks, including the 2
  deliberately-failing cases) compiles end-to-end to a 65,161-byte PDF with
  zero unfilled placeholders. Regression pass across `welcome.md`,
  `the-eveglyph-loop.md`, `typst-export-demo.md` — all compile successfully,
  no change in output for documents that don't opt into a theme/layout. All
  touched files pass `node --check`; the new `src/typst/*.js` and
  `src/visual/registry.js` modules confirmed loading cleanly over Vite's dev
  server in the real browser (200 OK, zero console errors) — full drag-through
  UI verification of the PDF export path itself uses the same isolated
  Node-harness method established in Phase 1–3 (the app's File System Access
  API requires a real native folder picker automation can't drive; the
  Node harness imports and exercises the exact same conversion functions the
  browser calls, which is the reliable way to test this specific pipeline).
- **Found, not fixed — pre-existing, out-of-scope bug**: regression testing
  turned up that `examples/math-corpus.md` fails to compile to PDF, with
  "unknown variable: ce" (from `\ce{H2O}`, mhchem chemistry notation) and
  "unknown variable: notarealcommand" (the deliberately-undefined-macro test
  case). Isolated testing narrowed this precisely: `multline`, `tikzcd`, and
  `split` cases all still compile fine — only unsupported/undefined LaTeX
  *commands* fail, not unsupported *environments*. The existing safety net in
  `restoreMath()` (`/\\(begin|end)\{/` test) only catches the environment
  case, honestly falling back to literal text; it has no equivalent for a
  command that `tex2typst` silently converts into a bare (and therefore
  unknown) Typst identifier reference instead of erroring. Confirmed via
  code-path tracing that this predates Phase 4 entirely — none of this
  phase's edits touch `extractMath`/`restoreMath`/`tex2typst`. Not fixed in
  this pass: `restoreMath()` is currently synchronous (a plain regex
  `.replace()` callback), and a proper fix (validating each generated Typst
  formula snippet compiles before embedding it, falling back to text if not)
  needs an actual Typst compile call, which is async — that would cascade
  `restoreMath` → `convertMarkdownFragment` → `block`/`list`/`convertBody` →
  `markdownToTypst` all needing to become async, a materially bigger change
  than this phase's stated scope. Left as a known, precisely-scoped follow-up.

## AIMD-C v0.1 — computable document core (roadmap Phase 3, 2026-07-18)

Third phase of the roadmap (`EveGlyph-Editor-Roadmap-v0.6.md`, internal repo
only). Replaces the whitepaper v0.5 §4 `::: aimd ::: ` / `Logic_Node` /
`Coupling Node` syntax entirely (Decision 1, roadmap v0.6, confirmed by Neo)
with typed values, pure functions, a real dependency graph, assertions, and
a computation ledger. New `src/aimdc/` module tree: `types.js`,
`evaluator.js`, `parser.js`, `graph.js`, `ledger.js`, `render.js`.

- **The shipped Tier 1 formula evaluator (`vite-agent-bridge.js`) is the
  seed this grew from, not a rewrite** (Decision 2, roadmap v0.6) — same
  hand-rolled tokenizer/recursive-descent core (no `eval`, no `Function`,
  closed grammar), moved client-side (AIMD-C needs to re-evaluate live as
  the document is typed, not wait on a server round-trip per click) and
  extended with named-variable resolution and a `name := expr` assignment
  form. `vite-agent-bridge.js`'s own Tier 1 endpoint is untouched — it's
  still there, now just unused by anything the live preview generates,
  since new documents use AIMD-C blocks instead of the old `expr=`/▶-button
  syntax. Its Tier 2 stub (`lean4`/`coq`/`python`, still honestly "not
  wired yet") stays put too — the roadmap's own sequencing makes it AIMD-C
  v0.4's eventual home, not something to touch in v0.1.
- **Six block kinds**: `aimd-value` (typed literal), `aimd-function` (typed
  pure function, `input:`/`output:`/`expression:`), `aimd-compute` (binds
  values to a function via `name := @ref` lines), `aimd-assert` (checked
  boolean expression), `aimd-table` (self-contained inline data), `aimd-view`
  (projects a result as typeset math, a formatted number, or a table).
  Cross-block references use `@id`/`@id.field`; `{{ id.field }}` in ordinary
  prose gets replaced with the live computed value, re-evaluated on every
  render — no separate "run" step, matching how the rest of this app's
  preview already re-renders on every keystroke.
- **Type checking is dynamic, not static inference** — a real, honest
  scope call, not a shortcut taken silently: checked at bind time against
  actual runtime values (`TypeError: circle-area.r expected Number, received
  Boolean` — same message shape the whitepaper's own §5.3 example uses), not
  full static analysis over the expression grammar. A static checker for
  this expression language would be a materially bigger undertaking than
  this phase's scope; the dynamic version still satisfies the whitepaper's
  actual requirement (reject before running, don't silently coerce).
- **Dependency graph**: topological evaluation, real cycle detection
  (`circular reference: a → b → a`, every member of the cycle flagged, not
  just the one where the DFS happened to detect the back-edge — an actual
  bug caught and fixed during testing, see below). Full re-evaluation on
  every render, no incremental diffing — a document's AIMD-C block count is
  small enough that a real incremental-recompute engine would be solving a
  problem that doesn't exist yet, matching this app's existing
  "re-render everything, it's cheap enough" pattern elsewhere.
- **Computation ledger**: per-block source/input/output hash record (djb2,
  not cryptographic — this answers "did the input change," a local,
  non-adversarial question, not one needing Web Crypto's async digest()
  inside an otherwise-synchronous render pipeline).
- **Rendering integration**: blocks are parsed (not rendered) during markdown
  preprocessing and swapped for a placeholder token, because correctly
  rendering any ONE of them needs the WHOLE document's graph evaluated
  first (a compute block's result can be referenced from anywhere in the
  document, not just after it — whitepaper §15.1). After the placeholder
  pass, the graph evaluates once, then block placeholders AND `{{ }}` inline
  refs both get substituted, re-sanitized (DOMPurify, same discipline as
  everything else in this app), and only THEN does KaTeX/MathJax math
  rendering run — so an `aimd-view{renderer="formula"}` block's generated
  `$$...$$` source gets picked up and properly typeset by the existing math
  pipeline, not just left as literal text.
- **Three real bugs found and fixed during testing, all via the actual
  worked examples, not synthetic edge cases:**
  1. `splitSections()`'s multi-line `input:`/`output:` YAML sections lost
     only the FIRST line's indentation via a bare `.trim()` (which strips
     the whole string's edges, not each line) — the second-and-later lines
     kept their original indent, producing invalid YAML ("bad indentation
     of a mapping entry") the moment a function had more than one input.
     Fixed with a proper dedent (strip the shared minimum leading
     whitespace from every line, not just trim the joined string).
  2. Cycle detection only flagged the ONE block where the DFS detected the
     back-edge, not every block actually in the cycle — the other member(s)
     fell through to a confusing secondary "hasn't run yet" error instead
     of the real cause. Fixed to mark every node in the detected cycle.
  3. **The reference tokenizer didn't allow hyphens in `@id` paths** — so
     `@circle-area` or `@revenue-this-year` (ordinary kebab-case ids,
     including the whitepaper's own `circle-area`/`yoy-growth` examples)
     silently mis-tokenized into a ref stopping at the first hyphen
     followed by bogus subtraction operations on undefined identifiers.
     Function `id`s and `use="..."` attribute values were never affected
     (those come from a separate attribute-string regex, not the expression
     tokenizer) — only bare `@ref` expressions inside compute bindings and
     assertions hit this, which is exactly why it wasn't caught until the
     demo file used more realistic ids instead of single-word ones.
- `examples/aimd-demo.md` fully migrated — every block kind exercised
  (including two deliberately-failing cases: a false assertion, and a
  type-mismatch compute block), plus an explicit "what's not here yet" note
  (`map`/`filter`/`reduce`, List/Table-valued expressions, L2+ sandboxed
  compute, L3/L4 workspace/agent layers).
- **Also fixed the same `\w+`-vs-`[\w-]+` block-type regex bug in
  `typstconvert.js`** (the PDF export converter has its own, separate copy
  of the block-splitting regex) — without this, `aimd-value` etc. would
  mis-split into `type="aimd"` + garbled rest in PDF export too. AIMD-C
  blocks don't have real Typst rendering yet (fall through to a plain
  labeled callout box with the raw content, honestly visible, not silently
  mangled) — a real Typst renderer for them, reusing `src/aimdc/parser.js` +
  `graph.js` (both pure logic, no DOM dependency), is a known, explicit
  follow-up, not attempted in this pass.
- **Verified**: both of the whitepaper's own worked examples (circle-area,
  yoy-growth) run correctly end-to-end including `{{ }}` inline substitution
  and `aimd-view` formula/number rendering; type-mismatch and circular-
  reference cases both produce clear, honest diagnostics instead of silent
  wrong answers or infinite loops; zh-TW translation confirmed; full
  regression pass across every other demo file (ordinary `::: note :::`
  callouts, World IR YAML, the whole Phase 1/2/2b math pipeline) — zero
  regressions, zero AIMD-C errors leaking into files that don't use it;
  zero console errors throughout.

## Multi-backend rendering, Phase 2b — MathJax automatic fallback (2026-07-18)

Follow-up to the Phase 2 entry below, same day: "先 MathJax吧。話說先用。之後看
狀況。要是不好用。就寫新的吧。"（Neo — let's do MathJax first, try using it,
see how it goes, write something new if it's no good). Re-prototyped properly
this time instead of stopping at the pre-built bundle's IIFE problem.

- **Used `@mathjax/src`'s lower-level component API directly** (`TeX`/`SVG`/
  `liteAdaptor`/`RegisterHTMLHandler` classes, `mathjax.document(...)`), not
  the pre-built `tex-svg.js` bundle that blocked the earlier attempt.
  `liteAdaptor` is MathJax's own DOM-independent virtual node implementation
  (not jsdom) — produces a node serialized to a plain HTML/SVG string via
  `adaptor.outerHTML()`, same "produce a string, sanitize it" pattern as
  everywhere else in this app. Prototyped in plain Node first (no browser
  needed — `liteAdaptor` doesn't touch a real DOM), confirmed working, *then*
  confirmed it also works unchanged when actually imported through Vite in
  the browser — cheaper iteration loop, and a real "does it survive the
  bundler" check before investing further.
- **Real empirical capability results** (not assumed): loaded packages
  `base + ams + newcommand + configmacros + mhchem` (deliberately skipping
  `noundefined`, which makes MathJax silently render undefined commands as
  plain text — the same silent-degradation class Phase 1 exists to catch).
  Of Phase 1's 4 confirmed katex gaps, MathJax rescues 2 (`multline` — `ams`
  package; `\ce{...}` mhchem — `mhchem` package) and correctly still fails
  the other 2 (`tikzcd` — neither engine implements real TikZ; an actually-
  undefined macro — no engine can render a command that was never defined
  anywhere). Not "MathJax fixes everything KaTeX can't" — a real, bounded,
  honestly-reported improvement.
- **New `src/math/mathjaxbackend.js`** — `renderWithMathJax(tex, display)`,
  lazy-loaded via dynamic `import()` (same pattern as the Typst WASM work),
  never throws (`{ ok, html }` / `{ ok: false, error }`).
- **`src/mathdiagnostics.js` substantially reworked** to support this:
  `mathDiagnosticsScan()` now does one unified `.katex-error, .katex` pass in
  true document order and positionally correlates each output node against
  `formulaAttempts` — an ordered list `preview.js` builds from every
  `preProcess` call. That correlation needed one non-obvious discovery:
  auto-render invokes `options.preProcess(tex)` as a method call, so a
  *non-arrow* `preProcess` function can read `this.displayMode` for the
  formula currently being processed — verified empirically (logged it across
  mixed inline/display formulas), not documented anywhere obvious. Without
  that, there'd be no way to know whether a failed formula needs an inline
  or block-level MathJax retry.
- **Async, self-healing UX, not a blocking wait.** The synchronous KaTeX
  pass and diagnostics panel appear immediately (Phase 1's behavior,
  unchanged); MathJax fallback attempts run afterward and patch specific
  DOM nodes + update the panel in place as each one resolves — a rescued
  formula's diagnostic entry disappears and the formula itself starts
  rendering, typically within a couple seconds. Guarded against a real race
  (the user keeps typing while a fallback is in flight from a stale render)
  with a simple generation counter, bumped on every `previewUpdate()` call
  and checked before any DOM patch — stress-tested by firing two renders
  back-to-back and confirming the first (stale) one's async fallback never
  touches the second (current) one's DOM.
- **Renderer Badge extended**: the existing "N formulas auto-normalized"
  note now also reports "N formulas rendered via MathJax after KaTeX
  couldn't," and a rescued formula gets a faint dashed outline in the
  preview (hover for why) — distinguishing "this is what you wrote" from
  "this took a fallback path" without being alarming about it.
- **Real code-splitting confirmed via an actual production build**, not
  assumed: MathJax's SVG/font output module (`svg-*.js`) landed as its own
  ~1.1MB / ~400KB-gzip chunk, separate from the main app bundle (which barely
  grew) — only fetched when `renderWithMathJax()` is actually called, i.e.
  only for a document that hits a real KaTeX gap. A user who never encounters
  one pays zero MathJax cost, matching the roadmap's `W_active(D) ≪
  W_total` principle. (A first build, done *before* wiring the fallback into
  `preview.js`'s real render path, showed zero MathJax code in the bundle at
  all — correct dead-code elimination, not a bug, but a reminder to always
  check code-splitting claims against a build that actually exercises the
  import path.)
- `examples/math-corpus.md`'s "Unsupported" section split into "Rescued by
  MathJax" (2 formulas) and "Still unsupported" (2 formulas), replacing the
  now-inaccurate claim that all 4 fail everywhere.
- **Verified**: Node-level prototype and browser-level behavior produce
  identical pass/fail results for all 5 test formulas; the true pre-fallback
  transient state (checked at the DOM immediately after the synchronous call
  returns, before any async resolution) shows the full Phase 1 diagnostic set
  exactly as before, settling down after fallback resolves — never worse than
  Phase 1 was, only better; DOMPurify's `svg`/`svgFilters` profile confirmed
  necessary and sufficient to preserve real glyph path data through
  sanitization (checked path counts and viewBox survived intact); inline vs.
  display wrapper element (`span` vs `div`) confirmed correct for both cases;
  full regression pass across every existing demo file — zero false
  positives, zero unintended fallback attempts on documents with no real
  KaTeX gaps; zh-TW translation and plural forms confirmed; `npm audit`
  clean; zero console errors throughout.

## Multi-backend rendering, Phase 2 (partial) — registry, Safe Rewrite, capability analysis (2026-07-18)

Second phase of the roadmap (`EveGlyph-Editor-Roadmap-v0.6.md`, internal repo
only). Full Phase 2 scope per that roadmap: KaTeX update, MathJax lazy-load,
Backend Registry, Capability Analyzer, Safe Rewrite, automatic fallback,
Renderer Badge. Shipped everything except MathJax itself — see below for why,
and Neo's explicit call on how to sequence it.

- **MathJax prototyped, then deliberately deferred.** Installed `mathjax@4.1.3`
  to check real integration cost before committing architecture around it.
  Its ready-made browser bundle (`tex-svg.js`) is a 1.85MB minified IIFE built
  for a `<script>` tag + a `window.MathJax` global — not an ESM export like
  katex's. Getting a clean ESM integration would mean working against
  `mathjax-full`'s lower-level, far-less-documented component API (compose a
  TeX input processor + SVG output processor + a browser DOM adaptor by
  hand), which doesn't fit this app's existing lazy-load pattern (dynamic
  `import()`, same as the Typst WASM work) without real exploration time.
  Asked Neo before picking a direction rather than guessing; his call: ship
  the rest of Phase 2 now, MathJax becomes its own follow-up rather than a
  sub-item here. Uninstalled the package again rather than leave an unused
  20MB dependency sitting in package.json half-wired.
- **New `src/math/registry.js`** — declares what each backend actually
  supports. katex's `knownUnsupported` list is the same four cases Phase 1
  empirically confirmed (`multline`, `tikzcd`, `\ce`, undefined macros — see
  `examples/math-corpus.md`), not copied from docs. `mathjax` has an entry
  marked `status: 'planned'` so the future slot is documented honestly
  instead of pretended into existence.
- **New `src/math/rewrite.js`** — Safe Rewrite rules (whitepaper §4.2's
  "safe" tier only — provably equivalent, not just "usually works"). One
  rule so far: `split` → `aligned`, the exact fix already applied ad-hoc on
  the Typst export side (`typstconvert.js`, 2026-07-15) and, as of
  yesterday's Phase 1 work, known to be silently broken in the KaTeX preview
  too. This is where that gets actually fixed, not just diagnosed.
- **New `src/math/capability.js`** — `prepareFormula(tex)` applies Safe
  Rewrite rules before a formula is handed to the active backend. Scoped
  honestly: with only one active backend, there's no cross-backend routing
  decision to make yet (whitepaper §3.3's full `Compatible(m,b)` requirement-
  matching needs a second backend to compare against) — this is the real,
  currently-useful subset of "Capability Analysis," not the full vision.
- **Renderer Badge, MVP-scoped.** `renderMathInElement`'s `preProcess` hook
  gives access to each formula's raw TeX text but not the DOM node katex
  eventually builds from it — a precise per-formula inline badge would need
  forking `auto-render`'s own DOM walk. Shipped a coarser, honest version
  instead: a quiet note above the preview ("N formulas auto-normalized")
  when any rewrite fired, logged to Monitor (`math:render:rewritten`) the
  same way Phase 1's failures are.
- `examples/typst-export-demo.md`'s `split` case (kept intentionally after
  Phase 1, at the time as a diagnostics-panel example) now actually renders
  correctly instead of showing a diagnostic — prose updated to match, since
  leaving Phase 1's wording would have been actively wrong now.
  `examples/math-corpus.md` gained an "Auto-normalized" section demonstrating
  the same fix in place, distinct from the still-real "Unsupported" section.
- **Also fixed in passing, unrelated to Phase 2 itself**: `npm audit` (run
  automatically when installing MathJax to prototype it) surfaced a
  pre-existing moderate severity advisory on `dompurify` itself — the
  library this whole app leans on to sanitize every piece of untrusted
  content (agent output, imported DOCX, document content). Not introduced by
  MathJax; the installed `3.4.10` was already vulnerable, just never
  surfaced before nothing had triggered a fresh audit. Bumped to `3.4.12`
  (patch-level, the fix release) — `npm audit` now reports zero
  vulnerabilities.
- **Verified**: `typst-export-demo.md`'s `split` formula renders with zero
  `.katex-error`/degraded nodes now (previously 1 error); `math-corpus.md`
  still shows exactly the same 2 errors + 2 warnings as Phase 1 (rewrite
  layer doesn't touch genuinely-unsupported cases) plus the new rewrite
  note; plural rewrite-count wording and zh-TW translation both confirmed;
  Monitor logs a `math:render:rewritten` entry with the rule id for every
  fired rewrite; full regression pass across every other demo file — zero
  false positives, zero false rewrite notes. Zero console errors throughout.

## Multi-backend rendering, Phase 1 — math diagnostics layer (2026-07-18)

First phase of the roadmap reconciling Neo's two new whitepapers (multi-backend
semantic rendering + AIMD-C — see the internal repo's
`EveGlyph-Editor-Roadmap-v0.6.md`, not public). Scope, per that roadmap: stop
silently swallowing KaTeX formula failures, show which formula and command
failed, build a diagnostics panel, log to the existing Monitor ledger, build an
initial Math Corpus. Nothing about backend routing/MathJax/Typst-theme-compiler
yet — that's Phase 2+.

- **Two distinct silent-failure shapes found empirically** (not assumed from
  docs — tested directly against this app's exact katex 0.16.47 build before
  writing any detection code): (1) a formula that fails to parse entirely gets
  replaced by katex's own `.katex-error` span (full message in its `title`
  attribute, never nested inside a normal `.katex` element); (2) a single
  unsupported command *inside* an otherwise-valid formula gets rendered as
  plain colored text (`errorColor`, default `#cc0000`) via katex's
  `formatUnsupportedCmd()`, with the rest of the formula still rendering
  normally — no class, no title, nothing to grep for. The second shape is the
  more dangerous one: nothing about it visually screams "broken" the way a red
  parse-error box does. `renderMathInElement`'s own `errorCallback` option,
  which looked like the obvious hook going in, turns out to fire essentially
  never with `throwOnError:false` — both failure shapes are absorbed inside
  katex's own render path before an error ever reaches that callback.
- New `src/mathdiagnostics.js`: `mathDiagnosticsScan(el)` runs after
  `renderMathInElement()` and scans for both shapes; each hit becomes a Monitor
  ledger entry (`math:render:error` / `math:render:degraded` — the project's
  existing PHOSPHOR diagnostic stream, not a new persistence mechanism) and an
  entry in a diagnostics panel rendered via `renderDiagnosticsBlock()`
  (`diagnostics.js`, already used for World IR validation — same visual
  language, not a bespoke math-only look). The panel only appears when there's
  something to show; a clean document renders no panel at all.
- `preview.js`: `mathDiagnosticsReset()` before each render, `mathDiagnosticsScan(el)`
  after, panel HTML prepended to `#preview-body` via `insertAdjacentHTML('afterbegin', …)`.
- New `examples/math-corpus.md` — every formula in it was actually run through
  this exact katex build before being written down (basic/calculus/linear-
  algebra/logic/set-theory/category-theory/physics/statistics/rare-symbols, all
  confirmed passing; `multline`/`mhchem`/undefined-macro/`tikzcd`, all confirmed
  failing, one of each failure shape).
- **Found a real, pre-existing bug while regression-testing existing demo
  files** (per the roadmap's own instruction to check regression scope before
  each phase): `examples/typst-export-demo.md` has used `\begin{split}` since
  the Typst PDF export work — Typst's own converter already rewrites
  `split→aligned` before compiling (a fix from 2026-07-15), but nobody had
  ever checked whether `split` renders in the *preview* pane, and it doesn't —
  KaTeX has never supported it. This sat silently broken in a shipped public
  demo file this whole time; the new diagnostics panel caught it immediately.
  Fixed the demo file directly (kept the `split` case on purpose now as a live
  diagnostics-panel example, added a working `aligned` companion) — the
  underlying multi-engine `split`/`aligned` alias-normalization problem itself
  is explicitly Phase 2 scope (`multi-backend rendering whitepaper §4.1`,
  "Safe Rewrite"), not fixed here.
- **Verified**: 4 synthetic failure cases (2 of each shape) all correctly
  detected with the right message and Monitor entry; a clean two-formula
  document produces zero false positives; `examples/math-corpus.md` itself
  renders exactly as documented (2 errors, 2 warnings); regression pass across
  `welcome.md`/`aimd-demo.md`/`the-eveglyph-loop.md` — zero false positives;
  `typst-export-demo.md` — exactly the one expected/intentional diagnostic
  after the fix. zh-TW translation round-trips correctly (new `mathDiagnostics`
  i18n namespace, 2 keys). Zero console errors throughout.

## Resizable panes + panel-tabs relocated (2026-07-17)

Neo, after screenshotting the panel-tabs row cramped into 9 tiny icons even at
full screen: "我們的選項變多了...簡單說所有視窗都改成可以拉深跟移動的了" —
more tabs than the original 3-column fixed-width layout was designed for.
Confirmed scope via a quick clarifying question rather than guessing: drag-to-
resize only (no dockable/floating panels, no drag-to-reorder tabs), and the
panel-tabs row gets its own full-width row under the topbar (not squeezed into
the existing topbar-buttons row).

- `#panel-tabs` moved out of `#right-panel` to a new direct child of `#app`,
  its own grid row (`--pth: 34px`) between the topbar and `#main`. Tabs no
  longer `flex:1`-stretch to fill a narrow 340px column — natural width,
  left-aligned, horizontal-scroll fallback if a window is ever narrower than
  all 9 tabs combined. The `.ptab` click-handler logic in `main.js` needed zero
  changes (already position-independent, queries `.ptab`/`.tcontent` by class).
- New `src/resize.js` — two `.resize-handle` divs (`#rh-sidebar` between
  sidebar/editor-pane, `#rh-rightpanel` between editor-pane/right-panel) drag
  the `--sw`/`--rw` CSS custom properties directly (`#main`'s
  `grid-template-columns` became `var(--sw) 4px 1fr 4px var(--rw)`). Clamped
  to sensible min/max (`CONFIG.layout.{sidebarMin,sidebarMax,rightPanelMin,
  rightPanelMax}` = 160–480 / 260–640px). Persists to `S.cfg.sidebarWidth`/
  `rightPanelWidth` → localStorage immediately on drop (same "sticks without
  needing the Settings ⚙ Save button" pattern as theme/language/font size),
  applied on boot via `applyLayout()`.
- `body.resizing` class (added for the drag's duration) disables text-selection
  and sets `pointer-events:none` on the CodeMirror editor — dragging a splitter
  across the editor pane would otherwise fight with CM6's own mouse-driven text
  selection.
- **Real bug caught before it shipped**: `settings.js`'s `cfgSave()` (the
  Settings ⚙ "Save" button) rebuilds `S.cfg` from scratch from form fields —
  `sidebarWidth`/`rightPanelWidth` aren't form fields, so without an explicit
  fix, clicking Save after resizing a pane would have silently reset both
  widths to default on the next reload. Fixed by preserving them from the
  current `S.cfg` at the top of the rebuilt object, same pattern already used
  for `compilableWorldRuntimeUrl`.
- **Verified end-to-end in the running dev app** (not just visual — the
  Browser pane's screenshot action was flaky again this session, same
  recurring infra issue noted in earlier phases): dispatched real
  `mousedown`/`mousemove`/`mouseup` sequences on both handles — sidebar grew
  240→320px live, persisted to localStorage, survived a real page reload;
  both handles' clamp bounds hold when dragged far past their min/max
  (160px / 640px); `body.resizing` cleans up correctly on mouseup; tab
  switching (Settings/World/Preview) still works identically after the DOM
  move; zero console errors throughout. Reset to default widths after testing.

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

## i18n Phase 1 — language setting (2026-07-15)

Neo: "先來一個語言設置。然後我們來討論如何最好的兼容性" (first a language
setting, then we'll discuss the best compatibility approach) — deliberately
staged: this phase is infrastructure only, not translated UI strings.

- New **Language** selector in Settings ⚙ (right under Theme), backed by
  `CONFIG.languages`/`CONFIG.languageLabels` (currently `en`/`zh-TW`, easy to
  extend — same enum-driven-select pattern as EveGlyph-MD's type/status
  dropdowns). `S.cfg.language` persists through the same localStorage blob as
  every other setting.
- Real (if small) effect wired now: `applyLanguage()` sets the actual
  `<html lang>` attribute live on change and on boot — affects screen readers,
  browser spell-check, and any `:lang()` CSS. UI text itself stays English;
  translating it is the next phase, intentionally not decided yet.
- Verified: selector populates correctly (English/繁體中文), switching fires
  the real onchange handler (`<html lang>` updates immediately), persists to
  localStorage, survives a real page reload, and the Settings ⚙ "Save" button
  path (`cfgSave()`) also persists it correctly — confirmed via a real DOM
  click, not a mocked call (a fresh `import()` inside a test script produces
  an isolated module instance disconnected from the live page's own `S`
  object — same JS-realm quirk already documented in memory from the Typst
  work; theme exhibits the identical false-negative under that same flawed
  test method, confirming it's a testing-methodology artifact, not a real
  bug). Zero console errors.
- **Deliberately not decided here, open for the next discussion**: the actual
  string-translation architecture (i18n key/value dictionaries vs. per-locale
  files vs. something else), which of the many hardcoded English strings
  across `index.html`/`src/*.js` get translated first, and how far "best
  compatibility" should reach (does agent-facing output, AI prompts, or
  monitor/diagnostic text change with language, or only front-stage UI chrome?).

## i18n Phase 2 — real translation (2026-07-15, "我們試試看")

Resolved the open questions above. Approach: plain per-locale JS dictionaries
(`src/i18n/en.js`, `src/i18n/zh-TW.js`), no framework, English as base/
fallback — matches this codebase's hand-rolled-over-dependency style (same
philosophy as the AIMD formula evaluator or the Typst converter). Scope,
Neo's call: front-stage UI chrome (buttons/labels/menus/tooltips/alerts) —
AI prompt text, Monitor/diagnostic content, and document content stay
untouched regardless of language.

- `src/i18n/index.js` — `t(key, lang)` (dot-path lookup, e.g.
  `"topbar.save"`, falls back to English then to the raw key so a typo is
  visible instead of blank) and `applyTranslations(lang)` (walks the DOM for
  `data-i18n`/`data-i18n-title`/`data-i18n-placeholder`/`data-i18n-html`
  attributes and re-applies them — cheap enough to just re-run wholesale on
  every language change rather than diff).
- **All of `index.html`'s static chrome converted** — 136 `data-i18n`, 20
  `data-i18n-title`, 7 `data-i18n-placeholder`, 3 `data-i18n-html` (used only
  where inline formatting matters, e.g. the onboarding steps' `<code>`/`<kbd>`
  tags — safe here since these are hand-written dictionary strings, not user
  input). Technical/product proper nouns (Runtime, World, Studio, Typst,
  provider names) deliberately kept in English in both locales, matching how
  Neo himself writes them in his other bilingual projects.
- `src/status.js`'s JS-generated status-bar text (Provider/Modified/agent
  connected-idle/frontmatter-chip states) also converted to `t()` — this one
  wasn't optional, since leaving it hardcoded would've meant the status bar
  stayed English while everything around it switched languages.
- `applyLanguage()` (main.js) now calls `applyTranslations()` + `statusUpdate()`
  alongside setting `<html lang>`, on both boot and the Settings ⚙ change
  handler.
- **Verified**: switching to 繁體中文 correctly translates every panel (topbar,
  sidebar empty-state, onboarding placeholder incl. preserved `<code>`/`<kbd>`
  tags, World/Runtime/Studio/AI/Search/Monitor/Docs/Settings tabs, status
  bar), switching back to English restores exactly the original text, a
  DOM-wide scan for any element showing its raw key instead of a real string
  found zero real gaps (2 false positives from a flawed test heuristic —
  `rules.md`/`glossary.md` look like dot-path keys but are correctly
  untranslated literal filenames in both locales). Zero console errors either
  direction.
- **Known, honest gap — not covered by this pass**: content generated
  dynamically by other `src/*.js` files (file tree entries, tab bar, the
  encoding/frontmatter context menus, the agent diff-review UI, AI preset
  labels, the Docs tab's own chrome, Monitor entries, and `alert()` calls
  scattered across `files.js`/`import.js`/`ai.js`/etc.) still renders in
  English regardless of the Language setting. Broad but not exhaustive —
  a future pass, not silently claimed as done.

## i18n Phase 3 — dynamic content closes the gap (2026-07-15, "我們繼續完成")

Closed the Phase 2 gap: every remaining `src/*.js` file that generates
front-stage UI text at runtime (not static `data-i18n` HTML) now routes
through `t()`/`tPlural()`. ~20 files touched: `files.js`, `encodingmenu.js`,
`frontmattermenu.js`, `diffview.js`, `agent.js`, `folderbrowser.js`, `ai.js`
(preset labels + alerts, not prompt text), `import.js`, `search.js`,
`aisearch.js`, `monitorview.js`, `overview.js`, `runtimeview.js`, `studio.js`,
`smview.js`, `entityview.js`, `diagnostics.js`, `about.js`, `amep.js`,
`tabs.js`, `typstui.js`.

- `t()`'s signature changed from `t(key, lang)` to `t(key, params)` —
  language is now tracked as module-level state (set by `applyTranslations()`),
  and `params` does `{name}` placeholder substitution
  (`str.replaceAll('{name}', value)`). Added `tPlural(singularKey, pluralKey,
  n, params)` for count-dependent strings (search match/file counts, agent
  activity line counts, AI-search result counts) — zh-TW doesn't grammatically
  need plural forms, but the key pair keeps both dictionaries structurally
  parallel and leaves room for languages that do.
- `en.js`/`zh-TW.js` grew from ~200 lines (Phase 2's static-chrome namespaces)
  to ~202 unique keys across new namespaces: `presets`, `files`,
  `encodingMenu`, `frontmatterMenu`, `diffview`, `agent` (largest single
  addition), `folderBrowser`, `aiDynamic`, `importDocx`, `searchDynamic`,
  `aiSearchDynamic`, `monitorDynamic`, `overview`, `runtimeDynamic`,
  `studioDynamic` (largest namespace overall), `smview`, `entityview`,
  `diagnosticsDynamic`, `aboutDynamic`, `amepDynamic`, `tabsDynamic`,
  `typstuiDynamic`.
- `applyLanguage()` (main.js) now also re-invokes `statusUpdate()`,
  `renderPresets()`, and `renderAbout()` — these render from JS, not static
  HTML, so a language switch needs to explicitly re-render them, not just
  re-walk the DOM for `data-i18n` attributes.
- `ai.js`'s `PRESETS` entries changed from `label: '...'` (string, fixed at
  module load) to `labelKey: '...'` (resolved via `t()` at render time in
  `renderPresets()`), so the quick-action button labels actually update on a
  language switch instead of freezing at boot-time English.
- Handled `t` as a pre-existing local variable name (transition objects,
  loop variables) file-by-file: left alone where scoping already makes it
  safe (`files.js`, `overview.js`), renamed the local variable where it was a
  quick fix (`frontmattermenu.js`, `search.js`), and used an aliased import
  (`import { t as i18n } from './i18n/index.js'`) in `smview.js`, which uses
  `t` as a transition-object variable pervasively enough that renaming
  call-by-call would've been riskier than aliasing the one import.
- **Verified three ways**: `node --check` on every touched file (clean);
  live browser test of representative flows (AI preset list, About panel,
  search "no matches", World "open a folder first" alert, AI "type a task"
  alert) in both languages, round-trip, zero console errors; and a from-
  scratch static-analysis script (`pathToFileURL()` + dynamic `import()` to
  load the real dictionaries, regex-extract every `t(`/`i18n(`/`tPlural(`
  call site across `src/*.js`, cross-check each key against both
  dictionaries) — **202 unique keys referenced, 0 missing from either
  locale**. Script was scratch-only, deleted after the check passed.
- **Still honestly out of scope, unchanged on purpose**:
  - `validate.js`'s 14 World IR validation messages are hardcoded
    Traditional Chinese by Neo's own original design (the file's own comment
    says so) — a pre-existing English/zh-TW asymmetry in the *other*
    direction, left alone rather than silently "fixed" without asking.
  - AI prompt/system-message text built in `ai.js`/`agent.js`/`aisearch.js`
    (the `build()` functions, `taskBlock`/`langRule`/`permClause`, the actual
    `prompt` strings sent to providers) — deliberately untouched, per Phase
    2's scope call: this text must stay consistent for the AI regardless of
    the UI's display language.
  - Monitor/diagnostic event payload content and document/Markdown content
    itself — never in scope, both by design (diagnostic logs and user
    documents aren't UI chrome).

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

### Two real bugs Neo found via his own real-world testing (2026-07-15, both fixed)

Neo actually opened `demo/typst-export-demo.pdf` and tested with real content —
exactly the human visual check the entry above said was still outstanding — and
hit two real compiler diagnostics (screenshotted from the app's own error alert):

- **`\begin{split}...\end{split}` broke math rendering.** `tex2typst` (v0.6.2,
  latest) understands the LaTeX `align`/`aligned` environments but not `split`,
  even though it's the same alignment semantics — silently leaves
  `\begin{split}`/`\end{split}` untranslated in its output rather than throwing,
  and the literal text then breaks Typst's math parser: bare "begin"/"end" reads
  as implicit variable multiplication ("b·e·g·i·n"), producing the exact cryptic
  warning Neo saw. Fixed two ways in `typstconvert.js`: (1) `normalizeTexAliases()`
  rewrites `split`→`aligned` before handing TeX to the converter (targeted, since
  they're truly equivalent — verified the rewritten output matches `aligned`'s own
  correct output exactly); (2) a general safety net in `restoreMath()` — if
  tex2typst's output still contains a raw `\begin{`/`\end{` (any OTHER unsupported
  LaTeX construct, e.g. `multline`, tested and confirmed triggering the same
  failure before the fix), fall back to rendering the raw LaTeX as a clearly-marked
  gray italic `[math: ...]` note instead of feeding Typst a string it can't parse —
  an honest, visible gap instead of a cryptic downstream warning.
- **CJK text used a variable font, which the WASM compiler doesn't support.**
  The Noto Serif TC file downloaded for Phase 3 was the variable-font build (all
  weights in one file) — Typst's own diagnostic said so plainly: "variable fonts
  are not currently supported and may render incorrectly... try installing a
  static version... instead." Fixed by re-deriving two static instances (Regular
  400, Bold 700) from the already-downloaded file via `fonttools varLib.instancer`
  (`pip install fonttools`, standard PyPI package) — local processing of a file
  already on disk, not a new download, so no separate sign-off needed. Old
  `NotoSerifTC-Variable.ttf` deleted; `typstexport.js` now loads
  `NotoSerifTC-Regular.ttf` + `NotoSerifTC-Bold.ttf`.
- **Verified**: both fixes confirmed via `compileTypstToPdfWithDiagnostics()` —
  the `split` case now compiles with zero diagnostics (was a hard error before);
  the variable-font warning is gone entirely from every compile (was present on
  every compile, not just ones using bold text). Demo file gained a `split`
  example specifically to exercise the fix. Full demo re-compiled clean end-to-end
  (136187 bytes, zero diagnostics, zero console errors) and re-written to
  `demo/typst-export-demo.pdf` for Neo. Synced to the internal repo and
  re-verified there too, identical result.

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
