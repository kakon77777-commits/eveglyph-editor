# User Guide

A practical walkthrough of EveGlyph Editor — what everything does, and how to use it.
For the "why" behind the design, see [README.md](README.md); for the security model,
see [SECURITY.md](SECURITY.md).

## Getting started

1. **Open a folder.** Click **Open Folder** in the top bar. First time? Open the
   bundled `examples/` folder — it has sample documents and a starter `.eveglyph/`
   already set up.
2. **Write.** The editor on the left is plain Markdown, plus a few extras (below).
   The **Preview** tab on the right renders it live.
3. **Optionally, bring in AI.** Set a provider in **Settings ⚙**, then use the
   **AI** tab to ask questions, run a preset, or (if you've set up a local agent)
   let it edit files directly — every change comes back as a diff you accept or
   reject.

## The workspace

- The **sidebar** shows your folder's file tree. Click a file to open it in a tab.
- **+ New** creates a file (stamped with EveGlyph-MD frontmatter by default — see
  below).
- **Save** (or `Ctrl+S`) writes the active file back to disk.
- **Import DOCX** converts a Word document to Markdown, then runs a light cleanup
  pass automatically.
- **Print** renders just the preview for a clean Save-as-PDF.
- **PDF** compiles the active document into a real typeset PDF via
  [Typst](https://typst.app) — different from Print's browser Save-as-PDF, this is
  an actual typesetting engine (proper math layout, real page breaks), running
  entirely in your browser as WebAssembly. Nothing is uploaded anywhere. Callouts
  render as colored boxes (matching the preview's colors); Theorem/Lemma/
  Definition callouts are numbered sequentially. AIMD-C blocks render as real
  typeset output (values, functions, compute results, assertions, tables, and
  formula/number/table views), matching what the live preview shows —
  including live `{{ id.field }}` substitution. Set `typst_theme:` and/or
  `typst_layout:` in frontmatter to change the look:
  - Themes (font, scale, colors): `evemiss-serif-light` (default),
    `evemiss-classic-light`.
  - Layouts (page size/margins, paragraph style, equation numbering):
    `technical-whitepaper` (default), `academic-paper` (numbered equations),
    `long-form-book`.
  Leave both unset and export looks exactly as it always has.
  First use in a session downloads ~51MB (compiler + fonts, including Traditional
  Chinese coverage via Noto Serif TC) — same-origin, cached after. Works on
  Markdown (`.md`) files.

## Writing: EveGlyph-MD

EveGlyph-MD is plain Markdown plus a small set of additions:

- **Math** — inline `$e^{i\pi}+1=0$` or display `$$...$$`, rendered via KaTeX.
  KaTeX doesn't support every LaTeX command or environment — if a formula
  fails (or partially fails, e.g. one unsupported command inside an otherwise
  valid formula), a diagnostics panel appears above the preview instead of
  the failure disappearing silently. Some formulas that look unsupported are
  actually just a syntax KaTeX doesn't recognize by name (e.g. `split`,
  which means the same thing as `aligned`) — those get quietly rewritten
  before rendering, with a small note instead of an error. Whatever's left
  gets one more try through MathJax (loaded only when needed) — real gaps
  like `multline` or chemistry notation (`\ce{...}`) end up rendering
  correctly a moment later instead of staying broken; a rescued formula gets
  a faint dashed outline (hover to see why). See `examples/math-corpus.md`
  for examples of all four cases.
- **Callouts** — `::: note {title="..."} ... :::` (also `warning`, `definition`,
  `theorem`, `lemma`, `proof`).
- **Frontmatter** — a `---` block at the top with `type` / `status` / `tags`. Click
  the chip in the status bar to change a document's class; the preview shows it as
  badges. This is a classification layer only — it's never sent to an agent as an
  instruction, only as labeled data.
- **AIMD-C blocks** — computable content with real types, a dependency
  graph, and assertions, re-evaluated live as you edit (see
  `examples/aimd-demo.md` for a full worked example):
  - `::: aimd-value {id="radius" type="Number"} ... :::` — a named input.
    Types: `Number`, `Boolean`, `String`, `List<T>`, `Table`.
  - `::: aimd-function {id="circle-area" pure="true"} ... :::` — a typed,
    pure function (`input:`/`output:` type declarations, one `name := expr`
    expression). Arithmetic, comparisons, `IF`/`AND`/`OR`/`NOT` — the same
    safe grammar the app has always used for computable content, no `eval`,
    no code execution.
  - `::: aimd-compute {id="result" use="circle-area"} r := @radius :::` —
    binds values to a function's inputs. Reference another block's result
    from anywhere in the document with `@id` or `@id.field`; a `{{
    result.area }}` in ordinary prose gets replaced with the live computed
    value. Wrong types are caught before evaluation, as a real error
    ("expected Number, received Boolean"), not a silent bad answer. A
    circular reference (`@a` depends on `@b` depends on `@a`) is rejected,
    not silently looped.
  - `::: aimd-assert {id="check"} @result.area > 0 :::` — checked, shown as
    Verified or Failed.
  - `::: aimd-view {source="@result.area" renderer="formula"} area :::` —
    projects a result as typeset math (`renderer="formula"`), a formatted
    number (`renderer="number"`, optional `format: "0.00"`), or a table.
  - `::: aimd-table {id="scores"} - name: Alice\n  score: 92 :::` — a
    self-contained data table.
  - Only pure computation is supported so far (no file/network/agent access
    from inside a block) — see `examples/aimd-demo.md`'s closing note for
    what's deliberately not built yet.
- **Dynamic Logic blocks (MVP)** — a claim/evidence/judgment layer above
  AIMD-C, not a second math engine. See `examples/dynamic-logic-demo.md`:
  - `::: aimd-claim {id="weather-judge"} It will rain tomorrow. :::` — a
    statement under evaluation.
  - `::: aimd-evidence {id="e1" claim="@weather-judge" direction="support" source-type="observation"} ... :::` —
    one piece of evidence for/against/neutral on a claim. `source_type`
    (`observation`/`document`/`derived`/`inference`) is required; `verified`
    defaults to `false`, never `true`, unless the source says otherwise.
  - `::: aimd-judgment {id="weather-judge" claim="@weather-judge"} support_threshold: 0.8 :::` —
    a deterministic policy (support/oppose thresholds, minimum evidence count,
    reopen sensitivity) that reduces accumulated evidence into a judgment
    state: open → generating → provisionally true/false. A closed judgment
    reopens if later evidence drifts it back across its own closure
    threshold, even without any single large update.
  - `::: aimd-history {claim="@weather-judge"} :::` — a replay panel with
    `←`/`→`/`▶ Play`/`Live` controls and a timeline progress bar. Play
    auto-advances one real evidence step per tick — no decorative animation,
    motion only happens on an actual change — and stops itself cleanly at
    the end or if you switch files mid-playback. Replay only changes what's
    projected on screen — it never rewrites the document's Markdown or
    touches the file on disk, and each document keeps its own replay
    position even if two files reuse the same claim id. Reaching the last
    step snaps back to Live, so evidence added later is picked up
    automatically. Judgment cards and any AIMD-C formula/`{{ }}` view reading
    a changed value briefly highlight with a delta — respects
    `prefers-reduced-motion`.
  - A judgment's values are readable from ordinary AIMD-C via
    `@weather-judge.support`, `{{ weather-judge.state }}`, etc. — the same
    reference syntax `aimd-compute`/`aimd-view` already use, not a separate
    language. A local AIMD-C id with the same name always wins over a
    Dynamic Logic one, so this never changes what an existing document means.
  - Evidence is still document-declared for this first slice (no autonomous
    search/AI ingestion yet), and the support score is a simple weighted
    ratio, explicitly not a calibrated probability — see the demo file's own
    notes for the rest of what's deliberately not built yet.
- **Chart & function-plot blocks** — hand-rolled SVG, no external library. See
  `examples/visual-ir-demo.md` for a full walkthrough.
  - `::: chart {id="q" type="bar" title="..."} - label: Q1\n  value: 120 :::` —
    self-contained data, same shape as `aimd-table`. `type` is `bar` (default),
    `line`, or `pie`. Any two keys work, not fixed `label`/`value` names — the
    first text field becomes the label, the first number field the value.
  - `::: plot {id="f" domain="[-10, 10]" title="..."} sin(x) :::` — the function
    expression goes in the block body, evaluated with the same grammar AIMD-C
    functions use (arithmetic, trig, log — no `eval`). The curve breaks at a
    point that doesn't evaluate (e.g. `1/x` at `x=0`) instead of drawing a
    straight line across the gap.
  - `::: aimd-view {source="@scores" renderer="chart"} type: bar :::` —
    visualizes a computed AIMD-C value (an `aimd-table`'s rows) with the exact
    same chart renderer as the standalone block above.
  - Single-series charts and HTML/SVG preview only for now — multi-series
    charts, flowchart/diagram blocks, and PDF export for these are deliberately
    not built yet.

## World IR mode (CompilableWorld)

Turn on **Settings ⚙ → Enable World Studio** first. It is off by default so
EveGlyph's normal surface remains focused on AI-native Markdown. Enabling it
reveals the Runtime, World, and Studio tabs plus specialized World IR Preview.
Turning it off again never changes the editor buffer, a file on disk, or Runtime
State; recognized World IR simply previews as plain YAML source.

Open a `.yaml`/`.yml` file whose content starts with one of these, and the
Preview pane shows a specialized visual projection instead of Markdown. The
file itself is always plain YAML text in the editor — these are different
ways of viewing/editing it, not a separate save format.

- **`kind: state_machine`** — states and transitions render as an SVG diagram
  (guard conditions shown on each arrow). It's click-to-use: edit the initial
  state; add, edit, or delete states and transitions; and edit Runtime-facing
  transition fields (`requirements`, `priority`, `event_match`, and reward).
  Variables, events, language instructions, and responses have guided visual
  forms. Bounded random metadata uses explicit boolean/integer/number/choice
  controls. Each record also retains an Advanced JSON editor, so extension
  fields the current UI does not know about are preserved instead of dropped.
- **`kind: entity`** — renders as an editable field form. Change a value and
  blur (or press Enter) to write it back into the YAML. `id`/`kind` stay
  read-only on purpose — stable IDs shouldn't change casually.
- **`kind: entity_list`** — renders as a read-only table, one row per entity,
  columns unioned across all of them.

Every one of these also runs a validator — missing/undefined initial state,
transitions pointing at undefined states, conflicting transitions, unreachable
states, missing or duplicate ids — and shows the result as a Diagnostics block
right under the view. State machines additionally apply Studio's semantic
record counts, text lengths, examples, and bounded-random limits. Invalid
guided fields are rejected before write-back.

The **🌐 World** tab scans every `.yaml`/`.yml` file in the open workspace,
classifies and validates each one, and lists them grouped by kind with
pass/fail badges — click any row to jump straight to that file. It's a manual
"Scan workspace" button rather than automatic, since it has to read every file
in the workspace, not just the one you're looking at.

See `examples/village-inn/` for real, working examples of each kind,
including two intentionally-broken ones so you can see the Diagnostics block
catch something.

### Studio: AI-assisted state-machine drafts

The **Studio** tab is the first AI authoring surface for complex World IR. Enter
a design request such as “建立村莊信任與商隊失蹤的多階段狀態機”，and it asks the
configured **Anthropic** or **OpenAI-compatible** provider for one YAML draft.
The draft may contain:

- `states`, `transitions`, and bounded `guards`;
- `variables` and `events` for semantic state and event data; a variable may
  optionally declare a bounded `random` spec (`boolean`, `integer`, `number`,
  or `choice`);
- `instructions` with language examples, plus `responses` for authored replies.

The response is parsed locally and checked against the existing state-machine
validator plus conservative limits (64 states, 256 transitions, 128 variables,
256 events, 256 instructions, 512 responses, at most 32 random choices, and
numeric random ranges no wider than 1,000,000). The generated YAML is an
editable review artifact: after changing it, press **Review edited draft**
again. A draft with errors cannot be applied or sent to Runtime. **Apply to
editor** only changes the current CodeMirror document; **Save** remains a
separate human action. Random data is descriptive draft data
until a later runtime contract explicitly consumes it. Unknown room,
EventIR, guard, and external-runtime semantics stay as reviewable draft data —
they are not silently compiled or written to Runtime State. Local Agent is not
used for this structured panel yet because its CLI response is an edit stream,
not a bounded JSON/YAML draft contract.

**Load current editor YAML** is the bridge for human-authored state machines:
after using the State Machine visual controls or editing YAML directly, load the
current editor content into Studio, review it, and then run the same read-only
Runtime check as an AI-generated draft.

If the CompilableWorld Runtime is running, **Check with Runtime** sends the
current draft to its read-only `/api/studio/import` endpoint. Runtime performs a
second YAML/World IR check and returns diagnostics, while Runtime State remains
unchanged. The endpoint uses the URL configured in the Runtime tab. It also
returns a human-review mapping draft. You can edit the JSON under **Runtime
mapping draft** and press **Validate mapping**; a `runtime_ready` report still
does not compile or install a Runtime Package automatically. Once it is ready,
the Runtime CLI can run `studio-compile` against a complete base world; this
keeps world/room/exit authoring explicit.

## Search

`Ctrl+F` opens CodeMirror's in-editor search for the current file. The **🔍** tab
is a separate, broader tool with two modes:

- **🔍 Exact** — string or regex, current file or the whole workspace, with a
  results list you can click through. Replace works the same way — in-file
  replacements are a normal `Ctrl+Z`-undoable edit; workspace-wide replace
  snapshots to git first, so **Revert** always gets you back to where you
  started. This mode is plain and predictable on purpose — no AI involved.
- **✨ AI** — ask a plain-language question ("where do we handle authentication?")
  instead of matching exact text. Sends the current file (or, for workspace
  scope, as many files as fit under a size cap) to whichever cloud AI provider is
  set in Settings, and asks it to rank and quote the most relevant passages with
  a short reason each. Click a result to jump to it. Needs Anthropic or an
  OpenAI-compatible provider (not Local Agent — that's a different call shape);
  results are AI-ranked, not exact, and a workspace larger than the one-shot size
  cap gets an honest "only searched N files" note rather than silently missing
  the rest.

## AI

Three provider options in **Settings ⚙**:

- **Anthropic** or **OpenAI-compatible** — a cloud API call. The current document
  (or your selection) is sent as context; nothing on disk is touched directly —
  you copy the response in yourself (Replace/Append buttons help).
- **Local Agent (CLI)** — Claude Code, Codex, or Gemini, running on your machine
  with **auto-approve**. This is the one that can create/edit/delete files
  directly. Read [SECURITY.md](SECURITY.md) before turning this on.

With a local agent selected:

- **Agent mode** — *Suggest* (advice only), *Patch* (edit, then you review a diff
  — the default), or *Direct* (apply immediately, with one-click revert).
- **Permission** — *Cautious* (edit existing files only), *Standard* (edit +
  create), or *Trusted* (full capability, skips the extra confirmation). These map
  to real CLI flags for the agent you picked, not just wording in the prompt.
- **Quick actions** — built-in presets: clean up AI chat residue, academic
  expand, preserve-voice light-edit, fix KaTeX syntax, normalize headings, extract
  a whitepaper draft from notes, generate a CHANGELOG entry, audit the workspace
  for cleanup candidates. The last two need a local agent (they touch multiple
  files / the whole workspace).
- **🧪 RigorLoop audit (AMEP)** — a different kind of preset: it doesn't use your
  configured AI provider at all. It calls [AMEP](https://evemisstechnology.com/amep/)
  (a separate open method-pack project) directly, running entirely in your
  browser — no server round-trip, no API key. It scans your selection/document
  for compressed proof language, unclear equivalence claims, and missing
  citations, and returns findings with recommendations. It's a heuristic keyword/
  marker scanner, not a theorem prover or an LLM — treat findings as prompts to
  double-check, not verdicts. First use in a session downloads ~14 MB (Pyodide,
  cached after) since AMEP runs client-side with no hosted API.

### Reviewing an agent's changes

Before an agent run, the workspace is snapshotted with git. Afterward you see a
per-file diff — expand a card to see the actual lines changed, **Accept** to
commit it, or **Reject** to revert everything back to the snapshot. Nothing is
kept without you explicitly accepting it.

### `.eveglyph/` — workspace memory

If a workspace has a `.eveglyph/` folder, its contents are woven into every local-
agent run automatically:

- `rules.md` — standing instructions for the agent (create one from
  **Settings ⚙ → Workspace agent rules**).
- `glossary.md` — terms/definitions specific to your project.
- `memory/pitfalls.md` — past mistakes recorded so the agent doesn't repeat them.
- `memory/recent.md` — a running log of recent work.

Each is individually toggleable in Settings. This folder is created per-workspace
and stays local — it's not part of the app itself.

## CompilableWorld Runtime FunctionIR preview

The **Runtime** tab connects to a local CompilableWorld Runtime package. Set the
runtime URL (default `http://127.0.0.1:8765`), load the FunctionIR catalog, choose
a function, and submit numeric inputs for a read-only preview. The returned
version, purity, expression metadata, inputs, and result come from the Runtime;
EveGlyph never writes Runtime State through this panel.

Edit `functions.json` in the normal editor or through a reviewed agent diff,
compile the package, then reload the catalog to preview the validated package.

## MCP server (for external AI clients)

Everything above runs inside the app itself. There's a separate way in: `mcp-server.js`,
a standalone [MCP](https://modelcontextprotocol.io) server any MCP-capable client (Claude
Desktop, Claude Code, ChatGPT with MCP support, etc.) can connect to directly — no browser
tab, no `npm run dev` needed. Useful when you want to work on a workspace from a client
that isn't this app.

Run `node mcp-server.js /path/to/workspace` (or `npm run mcp -- /path/to/workspace`), or
point your MCP client's config at it directly (see [README.md](README.md) for a Claude
Desktop config example). It exposes five tools: `list_files`, `read_file`, `write_file`,
`evaluate_aimdc` (runs the same AIMD-C engine the live preview uses), and
`validate_world_ir` (same validator the World IR views use). Every file operation is
confined to the workspace folder you pointed it at, same as the in-app bridge — but unlike
local-agent mode, there's no built-in diff-review step here; your MCP client's own
per-call approval fills that role instead. See [SECURITY.md](SECURITY.md) for the details.

Not at your own machine? `npm run mcp:remote -- /path/to/workspace` runs the same tools
over HTTP + a required bearer token instead of stdio — tunnel it (e.g. `cloudflared`) to
reach it from anywhere. Full setup in [README.md](README.md#remote-access-over-a-tunnel);
its trust model is meaningfully different from the local version (a leaked token means
direct remote access, no second gate) — read [SECURITY.md](SECURITY.md) before exposing it.

Or skip the terminal: **Settings ⚙ → Enable remote MCP server** starts/stops the same
remote server for you — the app generates a token (copy button included) and shows the
running URL. You still need your own tunnel to reach it from outside this machine.
Settings also shows a ready-to-copy **Local MCP (stdio)** command using your current
workspace path, for the stdio version above.

## Settings reference

| Setting | What it does |
| --- | --- |
| Theme | Dark / Light / Studio / Paper / Midnight. Also switchable from the topbar (left of Open Folder) — both controls stay in sync. |
| Language | English / 繁體中文 so far, easy to extend. Translates the app's UI chrome live — topbar, panels, Settings, status bar, and dynamically-generated content (file tree, context menus, diff-review UI, AI presets, search results, alerts). AI prompt text sent to providers, Monitor diagnostic logs, and your document content itself always stay as written, regardless of this setting. Also switchable from the topbar. |
| Editor font size / family | Self-explanatory |
| Custom CSS | A workspace-relative path (e.g. `.eveglyph/custom.css`) to a stylesheet loaded after the app's own styles. Optional; clear the field to turn it off. Reloads automatically on save and on workspace switch. |
| AI Provider | Anthropic / OpenAI-compatible / Local Agent |
| Default encoding | Fallback when a file's encoding can't be confidently detected, and the encoding used for new files |
| `.eveglyph/` memory toggles | Which pieces of workspace memory get sent to the agent |
| Enable remote MCP server | Starts/stops `mcp-server-remote.js` for the current workspace, bridge-managed. Off by default; always reflects whether the process is actually running, not a remembered setting. See [MCP server](#mcp-server-for-external-ai-clients) above. |
| EveGlyph-MD frontmatter | Whether new files get stamped, and the default `type`/`status` |

Per-file encoding (Big5 / GBK / Shift-JIS / UTF-8 / …) is detected automatically
and preserved on save; override it from the encoding chip in the status bar if
detection guesses wrong.

## The Monitor tab (◷)

A diagnostic stream of what the app and bridge are doing — file reads/writes, git
operations, agent runs, UI events. Mostly useful when something isn't behaving as
expected and you want to see what actually happened.

## Troubleshooting

- **"Open Folder" does nothing in agent mode** — the browser can't hand the agent
  an absolute path via its native picker, so agent mode uses an in-app folder
  browser instead. If a previously-used path went stale (folder renamed/moved),
  you'll be prompted to re-enter it.
- **Diff shows "couldn't load the diff — verify manually"** — the read failed
  (not the same as "no changes"); check the workspace is still reachable and try
  again.
- **CJK text looks garbled in agent output** — should be fixed as of the diff-
  review UX update; if you still see it, the dev server may need a restart to
  pick up the newer bridge.
- **A callout or AIMD block isn't rendering right** — check you're using
  `::: type ... :::` with the closing `:::` alone on its own line.

## Security, in one paragraph

Local-agent mode runs a CLI with auto-approve — it can read, create, edit, and
delete files in the folder you open, without asking per-file. You stay in control
through the git-snapshot diff review (Accept/Reject) and by only pointing it at
folders you trust. The dev bridge only ever talks to `localhost`. Full details in
[SECURITY.md](SECURITY.md).
