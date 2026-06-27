---
type: note
status: draft
tags: [tutorial, agent, diff-review]
---

# The EveGlyph loop

This document is intentionally a rough **draft** (see `status: draft` above) — a good
target for an agent edit.

## Try it

1. Open **Settings ⚙**, choose **Local Agent (CLI)**, pick an installed agent
   (Claude Code / Codex / Gemini), and set the **Workspace path** to this `examples/`
   folder. Click **Connect Agent**.
2. Make sure the mode selector under the prompt says **Patch — edit, then review the
   diff**, and the **Permission** tier suits you:
   - *Cautious* — edit existing files only.
   - *Standard* — edit + create (default).
   - *Trusted* — full capability.
3. In the **AI** tab, type a task such as:
   > Tighten the prose below and fix the heading levels. Keep my meaning and voice.
4. The workspace is git-snapshotted, the agent edits on disk, and you get a **diff** —
   **Accept** to keep (commit) or **Reject** to revert. Nothing is silently applied.

## rough notes to clean up

heres some messy text the agent can improve. it has lowercase starts, run on sentences
that go on and on without much structure, and inconsistent
### heading levels
that skip around. ask the agent to normalize this — then watch the diff.

## What just happened

The agent inherited this workspace's operating manual from `.eveglyph/` (rules,
glossary, and memory) before it touched a thing. That's the *plan layer* — open the
`.eveglyph/rules.md` file in the tree to read or edit the standing constraints.
