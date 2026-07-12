# Contributing

Thanks for looking at EveGlyph Editor. This is a small, focused project — the notes
below are here to save you a round-trip, not to gatekeep.

## Setup

```sh
git clone https://github.com/kakon77777-commits/eveglyph-editor
cd eveglyph-editor
npm install && npm run dev
```

Requires Node.js 18+. Open <http://localhost:5173>, then **Open Folder → `examples/`**
for a ready-made workspace to test against.

## Before you open a PR

- **Run it, don't just read the diff.** This is a UI-heavy app; `node --check` on the
  files you touched catches syntax errors, but nothing here catches "the button
  doesn't do what I meant" except actually clicking it.
- **If you touched `vite-agent-bridge.js`,** restart the dev server (it doesn't
  hot-reload the bridge) and re-test whatever endpoint you changed.
- **If you touched anything in the agent/diff-review path** (`src/agent.js`,
  `src/search.js`, the `/api/git/*` endpoints), test the actual Accept/Reject/Revert
  flow, not just the happy path — this code exists specifically to make destructive
  operations reversible, so a bug here is worse than most.
- Keep changes scoped. A bug fix doesn't need a refactor riding along with it.

## Code style

- No build step beyond Vite — vanilla ES modules, no framework, no TypeScript.
- Comments explain *why*, not *what* — see the existing code for the tone. If a line
  needs a comment to say what it does, consider making the code say that instead.
- `src/state.js`'s `S` singleton is the one source of mutable app state — don't
  introduce a second one.
- Untrusted content (agent output, git diffs, file paths from disk) gets rendered via
  `textContent`/escaping, never raw `innerHTML`, unless it's gone through
  `DOMPurify.sanitize()` first. This isn't a style preference — see
  [SECURITY.md](SECURITY.md) for why.

## Where things live

See [README.md](README.md)'s "How it works" section for the frontend/bridge split,
and [PROGRESS.md](PROGRESS.md) for the detailed, chronological build log (useful if
you want to understand *why* something is built the way it is, not just what it
does). [CHANGELOG.md](CHANGELOG.md) and [USER-GUIDE.md](USER-GUIDE.md) are also
readable inside the app itself (the 📖 tab).

## Reporting a security issue

Please don't open a public issue for a security vulnerability — see
[SECURITY.md](SECURITY.md) for contact details and the current trust model (what's
already a known, accepted risk vs. what would be a genuine bug).
