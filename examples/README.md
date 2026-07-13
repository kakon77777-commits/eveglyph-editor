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

## World IR examples (`village-inn/`)

EveGlyph Editor also renders CompilableWorld's World IR: any `.yaml`/`.yml`
file starting with `kind: state_machine` / `kind: entity` / `kind:
entity_list` gets a specialized visual projection in the preview pane
instead of Markdown (see `src/viewregistry.js`). Try:

- `relation.acquaintance_to_friend.yaml` / `quest.missing_caravan.yaml` — clean state machines (click-to-use: add/delete states and transitions)
- `entity.npc_innkeeper.yaml` — an editable entity form
- `entities.village_inn.yaml` — a read-only entity table
- `broken.state_machine_with_issues.yaml` / `broken.entity_list_with_issues.yaml` — intentionally broken, to see the Diagnostics block catch real issues
- the "🌐 World" tab → Scan workspace, to inventory all six at once
