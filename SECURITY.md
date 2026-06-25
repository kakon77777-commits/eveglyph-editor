# Security

EveGlyph Editor is a **local-first developer tool**: it runs on your own machine via the local dev server. This document describes its trust model and the real risks — above all, **local-agent mode**.

## In one line

The bridge is dev-only and localhost-gated. The biggest risk is **by design**: local-agent mode lets a CLI edit your files with auto-approve. You stay in control through a per-workspace confirmation and git-based diff review.

## The local bridge

- The `/api/*` bridge (`vite-agent-bridge.js`) is a Vite plugin declared **`apply: 'serve'`** — it exists only under `npm run dev`, never in a production build.
- Every `/api` request is gated by `isLocalRequest`: the `Host` must be `localhost` / `127.0.0.1` / `::1`, and if an `Origin` header is present its hostname must also be local — otherwise the request is rejected with **403**. This blocks CSRF and DNS-rebinding from a malicious web page.
- Vite's dev server binds to localhost by default, so it is not reachable from your LAN. Note that the `isLocalRequest` gate is **header-based** (it inspects `Host` / `Origin`): that defends against CSRF and DNS-rebinding from a web page, but it is *not* a substitute for network isolation. If you start the server with `--host` (binding all interfaces), a device on your LAN could reach the bridge by sending a `localhost` `Host` header. **Do not run the dev server with `--host` on an untrusted network.**
- File reads/writes confine the target path with `resolveInside` (any path that escapes the workspace root is rejected). Beyond that, **every workspace-scoped operation — file I/O, the git snapshot / diff / accept / reject, and the agent spawn — is pinned to the single folder you opened**: the bridge records that folder when you open it, and a later request whose working directory isn't that folder (or a descendant) is rejected. This keeps a crafted `/api` request from pointing a destructive `git reset --hard` / `clean -fd`, or an auto-approve agent, at an arbitrary directory.

## Local-agent mode — read this

When the provider is **Local Agent (CLI)**:

- The selected CLI (Claude Code / Codex / Gemini) is spawned **in your workspace folder with auto-approve**, and can **read, create, and edit files** there.
- **Per-workspace confirmation.** The first agent run for a given folder asks you to confirm, and the gate keys on the confirmed working directory — confirming one workspace never authorizes edits in another, and switching to a new folder re-asks before any edit. The confirmation lives in the browser session and is not persisted, so a page reload also clears it and re-asks.
- **The prompt is delivered over stdin, never on the command line** — so prompt text is never interpreted as command-line arguments or shell syntax.
- **The command runs through a shell** (`shell: true`, required to resolve Windows `.cmd` shims). The command template comes from the built-in agent definition or **your own Settings override**. Only set the override to a command you trust — it is your input running on your machine.
- **Hard 180-second timeout.** The child process is killed on timeout, and also if you press Stop or close the connection.
- **Diff review (PatchMD).** Before the agent runs, the workspace is git-snapshotted (a repo is initialized if needed). Afterwards you review a real `git diff` and:
  - **Accept** → commits the agent's changes (`agent: <message>`).
  - **Reject** → `git reset --hard HEAD` + `git clean -fd`, discarding **all** agent edits *and* untracked files.

  Reject is destructive to uncommitted work in the workspace. Keep your own changes committed or backed up before running an agent.

## `.eveglyph/` workspace rules

If the workspace contains a `.eveglyph/rules.md`, EveGlyph Editor injects it **verbatim, with elevated authority** ("follow these before anything else") into the agent's prompt on *every* run — plus `.eveglyph/glossary.md` if present. Treat these as **trusted but attacker-controllable configuration**: when you open an unfamiliar workspace, review `.eveglyph/rules.md` before running an agent. This does not widen the core risk (the agent already has auto-approve over the same files), but the rules are auto-loaded without re-prompting, so a malicious one could steer the agent silently.

## API keys

- Cloud-provider API keys are stored in the browser's **`localStorage`, in plaintext** (key `eveglyph_cfg`). This is convenient for local dev but is **not** secure storage. Don't use it on a shared or untrusted machine. A future desktop build would move keys to the OS keychain.
- Calling Anthropic directly from the browser requires the `anthropic-dangerous-direct-browser-access` header; for stricter setups, route through an OpenAI-compatible proxy instead.

## Preview sanitization

The Markdown preview is rendered with `marked` and sanitized with **DOMPurify** (default configuration — script / iframe / event-handler attributes stripped). Even so, only open Markdown you trust — sanitization narrows, but never fully eliminates, the HTML-in-Markdown surface.

## Telemetry

A best-effort diagnostic stream is appended to a local JSONL file (`../PHOSPHOR/eveglyph-monitor.jsonl`, rolled at 5 MB). It records file / workspace / agent events — paths, byte counts, short output samples — **locally only**. Nothing is sent over the network. Delete the file to clear it.

## Reporting

EveGlyph Editor is an EveMissLab prototype. Please report security issues to the maintainer (Neo.K) directly rather than filing a public issue.
