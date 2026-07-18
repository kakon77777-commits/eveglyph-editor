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
  render as colored boxes (matching the preview's colors). AIMD-C blocks print as
  a plain labeled box with their raw content for now — proper typeset rendering
  (matching what the live preview shows) is a known follow-up, not built yet.
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

## World IR mode (CompilableWorld)

Open a `.yaml`/`.yml` file whose content starts with one of these, and the
Preview pane shows a specialized visual projection instead of Markdown. The
file itself is always plain YAML text in the editor — these are different
ways of viewing/editing it, not a separate save format.

- **`kind: state_machine`** — states and transitions render as an SVG diagram
  (guard conditions shown on each arrow). It's click-to-use: **+ Add State**
  and **+ Add Transition** controls below the diagram, a **✕** on every state
  box, a **✕** on every row of the raw transitions table.
- **`kind: entity`** — renders as an editable field form. Change a value and
  blur (or press Enter) to write it back into the YAML. `id`/`kind` stay
  read-only on purpose — stable IDs shouldn't change casually.
- **`kind: entity_list`** — renders as a read-only table, one row per entity,
  columns unioned across all of them.

Every one of these also runs a validator — missing/undefined initial state,
transitions pointing at undefined states, conflicting transitions, unreachable
states, missing or duplicate ids — and shows the result as a Diagnostics block
right under the view.

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
numeric random ranges no wider than 1,000,000). A draft with errors cannot be
applied. **Apply to editor** only changes the current CodeMirror document;
**Save** remains a separate human action. Random data is descriptive draft data
until a later runtime contract explicitly consumes it. Unknown room,
EventIR, guard, and external-runtime semantics stay as reviewable draft data —
they are not silently compiled or written to Runtime State. Local Agent is not
used for this structured panel yet because its CLI response is an edit stream,
not a bounded JSON/YAML draft contract.

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

## Settings reference

| Setting | What it does |
| --- | --- |
| Theme | Dark / Light |
| Language | English / 繁體中文 so far, easy to extend. Translates the app's UI chrome live — topbar, panels, Settings, status bar, and dynamically-generated content (file tree, context menus, diff-review UI, AI presets, search results, alerts). AI prompt text sent to providers, Monitor diagnostic logs, and your document content itself always stay as written, regardless of this setting. |
| Editor font size / family | Self-explanatory |
| AI Provider | Anthropic / OpenAI-compatible / Local Agent |
| Default encoding | Fallback when a file's encoding can't be confidently detected, and the encoding used for new files |
| `.eveglyph/` memory toggles | Which pieces of workspace memory get sent to the agent |
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
