# EveGlyph Editor — example workspace

A tiny, ready-to-open workspace that demonstrates **EveGlyph-MD** and the
workspace ↔ agent ↔ diff-review ↔ human loop.

## Open it

In EveGlyph Editor, click **Open Folder** and pick this `examples/` directory
(or, in Local-Agent mode, set the **Workspace path** to it).

## What's inside

- **welcome.md** — an EveGlyph-MD `article` (`status: final`): frontmatter badges,
  KaTeX math, `:::` callouts, a CJK section, and a quick map of the UI.
- **the-eveglyph-loop.md** — a rough `draft` to hand an agent so you can watch a
  real diff-review.
- **.eveglyph/** — the per-workspace agent operating manual that EveGlyph Editor
  injects into every agent run:
  - `rules.md` — standing constraints (read first).
  - `glossary.md` — protected terms the agent must not redefine.
  - `memory/recent.md` — mid-term project memory.
  - `memory/pitfalls.md` — append-only "don't repeat these" notes.

Everything here is plain Markdown — copy it as the seed for your own workspace.
