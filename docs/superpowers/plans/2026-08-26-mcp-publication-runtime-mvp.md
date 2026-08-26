# EveGlyph MCP Publication Runtime MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mergeable single-document publication runtime that lets MCP clients inspect, validate, render, and retrieve a real EveGlyph-generated PDF from canonical UTF-8 source without mutating the workspace.

**Architecture:** Reuse the existing `markdownToTypst()` converter and existing theme/layout primitives as the single document semantics. Add a Node-only Typst compiler adapter, a focused `src/publication/` orchestration layer, a process-scoped artifact store, and MCP tools/resources that expose the rendered PDF and evidence. Browser export remains on the existing Web/WASM compiler but shares the same conversion/profile resolution.

**Tech Stack:** Node.js >=18, ESM, Node built-in `node:test`, `@modelcontextprotocol/sdk@^1.29.0`, `@myriaddreamin/typst-ts-node-compiler@0.7.0`, existing `marked`, `tex2typst`, Typst.ts Web/WASM stack.

**Spec:** `docs/superpowers/specs/2026-08-26-mcp-publication-runtime-mvp-design.md`

## Global Constraints

- Canonical source remains UTF-8 source; render/inspect/validate must not rewrite it.
- Browser and headless paths must share `markdownToTypst()` and existing theme/layout definitions.
- No runtime CDN fetch for compiler or fonts.
- Headless PDF must use repository-controlled fonts in `public/fonts/typst/`, including Traditional Chinese coverage.
- Existing MCP tools remain backward compatible.
- Render artifacts are ephemeral process-scoped outputs, not workspace writes.
- No batch publication, SaaS tenancy, OAuth, billing, or source auto-repair in this PR.
- TDD is required for new production behavior.

---

### Task 1: Publication profile resolution and converter override

**Files:**
- Create: `src/publication/profiles.js`
- Modify: `src/typstconvert.js`
- Create: `test/publication-profiles.test.mjs`

**Interfaces:**
- Produces: `listPublicationProfiles()`, `resolvePublicationProfile(id)`, `resolvePublicationSelection({ profile, theme, layout })`.
- Modifies: `markdownToTypst(source, options = {})`, where `options.theme` and `options.layout` override frontmatter only for rendering.

- [ ] **Step 1: Write failing tests** for stable aliases, unknown profile rejection, explicit override precedence, and byte-equivalent default output when no options are provided.
- [ ] **Step 2: Run `node --test test/publication-profiles.test.mjs` and verify RED** because publication modules/options do not exist yet.
- [ ] **Step 3: Implement minimal profile resolution** mapping `evemiss-academic-v1` to `evemiss-serif-light + academic-paper` and `evemiss-whitepaper-v1` to `evemiss-serif-light + technical-whitepaper`.
- [ ] **Step 4: Extend `markdownToTypst(source, options = {})`** so `options.theme/layout` take precedence over frontmatter without mutating source.
- [ ] **Step 5: Re-run the test and verify GREEN.**
- [ ] **Step 6: Commit** `feat: add publication profile resolution`.

### Task 2: Inspect and validate canonical source

**Files:**
- Create: `src/publication/inspect.js`
- Create: `src/publication/validate.js`
- Create: `test/publication-inspect-validate.test.mjs`

**Interfaces:**
- Produces: `inspectDocument(source)` and `validateDocument(source, { profile } = {})`.
- Consumes: `resolvePublicationProfile()` and `markdownToTypst()`.

- [ ] **Step 1: Write failing inspection tests** for frontmatter/title, heading tree, character count, inline/display math, tables, images, fenced code, callouts/AIMD/AIMD-C counts.
- [ ] **Step 2: Write failing validation tests** for unknown profiles, unbalanced display math, unclosed code fences / `:::` blocks, and successful Markdown→Typst conversion.
- [ ] **Step 3: Run `node --test test/publication-inspect-validate.test.mjs` and verify RED.**
- [ ] **Step 4: Implement pure inspection** using source scanning plus existing frontmatter parsing; do not use browser globals.
- [ ] **Step 5: Implement preflight validation** returning `{ ok, errors, warnings, notices, resolvedProfile }`; compiler diagnostics remain out of scope here.
- [ ] **Step 6: Re-run and verify GREEN.**
- [ ] **Step 7: Commit** `feat: add publication inspection and validation`.

### Task 3: Ephemeral artifact store and evidence

**Files:**
- Create: `src/publication/artifact-store.js`
- Create: `test/publication-artifacts.test.mjs`

**Interfaces:**
- Produces: `putArtifact({ bytes, filename, sourceSha256, profile, resolvedTheme, resolvedLayout, diagnostics, warnings, renderer })`, `getArtifact(id)`, `getArtifactReport(id)`, `getArtifactLimits()`.
- Artifact URI: `eveglyph-artifact://<uuid>`.

- [ ] **Step 1: Write failing tests** for SHA-256 metadata, PDF MIME type, UUID-backed URI, unknown ID, TTL expiration, single-artifact 64 MiB limit, and 256 MiB process eviction.
- [ ] **Step 2: Run `node --test test/publication-artifacts.test.mjs` and verify RED.**
- [ ] **Step 3: Implement the process-scoped store** with 30 minute default TTL, expired-first cleanup, oldest-first memory eviction, no filesystem persistence.
- [ ] **Step 4: Re-run and verify GREEN.**
- [ ] **Step 5: Commit** `feat: add publication artifact store`.

### Task 4: Node/headless Typst PDF renderer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` using npm-generated lock data; do not hand-invent integrity hashes.
- Create: `src/publication/node-renderer.js`
- Create: `src/publication/prepare.js`
- Create: `test/fixtures/publication-zh.md`
- Create: `test/publication-node-renderer.test.mjs`

**Interfaces:**
- Produces: `preparePublication(source, { profile })` → `{ typstSource, profile, theme, layout, validation }`.
- Produces: `renderTypstToPdf(typstSource)` → `{ bytes, diagnostics, renderer }`.
- Uses `NodeCompiler.create({ workspace, fontArgs: [{ fontPaths: [...] }] })` and `compiler.pdf({ mainFileContent })`.

- [ ] **Step 1: Add the failing integration test** using Traditional Chinese prose, English, `$...$`, `$$...$$`, heading, table and code; expect returned bytes to begin `%PDF-` and be non-trivial.
- [ ] **Step 2: Run the test in CI and verify RED** because the Node compiler adapter/dependency is absent.
- [ ] **Step 3: Add `@myriaddreamin/typst-ts-node-compiler@0.7.0`** and generate a lockfile through npm in CI/runner.
- [ ] **Step 4: Implement the Node compiler adapter** with absolute repo workspace and `public/fonts/typst` font path; no network font lookup configuration.
- [ ] **Step 5: Implement `preparePublication()`** using validation + resolved profile + canonical `markdownToTypst()`.
- [ ] **Step 6: Re-run and verify GREEN, including Chinese fixture.**
- [ ] **Step 7: Commit** `feat: add headless Typst PDF renderer`.

### Task 5: MCP publication tools and binary resource

**Files:**
- Modify: `mcp-tools.js`
- Create: `test/mcp-publication.test.mjs`

**Interfaces:**
- Adds tools: `get_publication_capabilities`, `inspect_document`, `validate_document`, `render_document`, `get_render_artifact`, `get_render_report`.
- Adds resource template resolving `eveglyph-artifact://{artifact_id}` to `{ mimeType: 'application/pdf', blob: base64 }`.

- [ ] **Step 1: Write a failing MCP stdio E2E test** that spawns `mcp-server.js`, calls `render_document`, retrieves the artifact resource/tool result and asserts decoded bytes begin `%PDF-`.
- [ ] **Step 2: Run and verify RED** because the tools/resource are not registered.
- [ ] **Step 3: Register capability/inspect/validate tools** with read-only, non-destructive annotations.
- [ ] **Step 4: Register `render_document`** as non-destructive to workspace but not falsely idempotent; it creates an ephemeral artifact.
- [ ] **Step 5: Register artifact/report retrieval and resource template** backed by the module-scoped store so remote stateless HTTP requests can retrieve earlier artifacts while the process lives.
- [ ] **Step 6: Re-run and verify GREEN.**
- [ ] **Step 7: Commit** `feat: expose publication runtime over MCP`.

### Task 6: Publication CI and regression verification

**Files:**
- Create: `.github/workflows/publication-runtime.yml`
- Modify: `package.json` scripts

**Interfaces:**
- Adds scripts: `test:publication` and `verify:publication`.
- CI runs Node 20, npm install/ci as lock state allows, publication tests, `npm run build`, `verify:dynamic-logic`, `verify:dynamic-rendering`.

- [ ] **Step 1: Add CI before production GREEN commits where possible** so failing tests are observable remotely.
- [ ] **Step 2: Confirm RED run on test-only commit.**
- [ ] **Step 3: After implementation, confirm GREEN run** for publication tests plus existing build/verifiers.
- [ ] **Step 4: Commit** `ci: verify publication runtime` if not already committed with RED harness.

### Task 7: Documentation and security contract

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `USER-GUIDE.md` only for browser-vs-MCP publication distinction.
- Modify: `CHANGELOG.md`
- Modify: `PROGRESS.md`

**Interfaces:**
- Documents exact tool names, artifact TTL/limits, bearer-token risk for remote MCP, no-workspace-mutation rendering, profile aliases and local stdio example.

- [ ] **Step 1: Update README MCP section** with publication tool table and sample flow.
- [ ] **Step 2: Update SECURITY** with artifact lifetime/memory behavior and remote-token implications.
- [ ] **Step 3: Update USER-GUIDE only if needed** to distinguish browser download vs headless MCP artifact retrieval.
- [ ] **Step 4: Record implementation in CHANGELOG/PROGRESS** without bumping package version.
- [ ] **Step 5: Run full verification again.**
- [ ] **Step 6: Commit** `docs: document MCP publication runtime`.

### Task 8: Final PR verification

**Files:** No new production files unless verification uncovers a defect.

- [ ] **Step 1: Compare `main...feat/mcp-publication-runtime-mvp`** and review every changed file for scope creep.
- [ ] **Step 2: Confirm all acceptance criteria from the design spec map to executable evidence.**
- [ ] **Step 3: Confirm CI is green and no package version bump occurred.**
- [ ] **Step 4: Open PR against `main`** with architecture, safety, tests, known limitations, and follow-up corpus plan.
