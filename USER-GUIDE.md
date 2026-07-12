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

## Writing: EveGlyph-MD

EveGlyph-MD is plain Markdown plus a small set of additions:

- **Math** — inline `$e^{i\pi}+1=0$` or display `$$...$$`, rendered via KaTeX.
- **Callouts** — `::: note {title="..."} ... :::` (also `warning`, `definition`,
  `theorem`, `lemma`, `proof`).
- **Frontmatter** — a `---` block at the top with `type` / `status` / `tags`. Click
  the chip in the status bar to change a document's class; the preview shows it as
  badges. This is a classification layer only — it's never sent to an agent as an
  instruction, only as labeled data.
- **AIMD blocks** — `::: aimd ... :::` for computable content:
  - `> [D_G=1, λ=0.95] some text` — a main-line note, always shown.
  - `[Logic_Node: ID | expr="SUM(1,2,3) = 6"] 狀態: ? | 相干度: ? | 驗證器: formula`
    — click the **▶** button that appears to actually evaluate `expr`. The
    built-in `formula` verifier understands arithmetic, comparisons, and Excel-
    style functions (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `IF`, `AND`, `OR`,
    `NOT`, trig/log/sqrt/etc.) — safely, with no code execution. A result that
    resolves to true/false shows as Verified/Failed; a plain calculation shows as
    Computed.
  - `<Coupling Node: label> ... </Coupling>` — a collapsible block. It only
    materializes its content when you open it, and releases it again when you
    close it — useful for keeping long documents light.

## Search

`Ctrl+F` opens CodeMirror's in-editor search for the current file. The **🔍** tab
is a separate, broader tool: exact string or regex, current file or the whole
workspace, with a results list you can click through. Replace works the same way —
in-file replacements are a normal `Ctrl+Z`-undoable edit; workspace-wide replace
snapshots to git first, so **Revert** always gets you back to where you started.

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
- **Quick actions** — 8 built-in presets (clean up AI chat residue, academic
  expand, preserve-voice light-edit, fix KaTeX syntax, normalize headings, extract
  a whitepaper draft from notes, generate a CHANGELOG entry, audit the workspace
  for cleanup candidates). The last two need a local agent (they touch multiple
  files / the whole workspace).

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

## Settings reference

| Setting | What it does |
| --- | --- |
| Theme | Dark / Light |
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
