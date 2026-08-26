# EveGlyph MCP Publication Runtime MVP — Design

**Date:** 2026-08-26  
**Branch:** `feat/mcp-publication-runtime-mvp`  
**Target:** `main`  
**Status:** Design approved in chat; implementation not yet started

## 1. Goal

Deliver the first mergeable vertical slice of the EveGlyph Publication Runtime so an MCP client can submit canonical UTF-8 EveGlyph/Markdown source, validate and inspect it, render a real PDF through EveGlyph's existing Markdown → Typst semantics, and retrieve the resulting PDF as an MCP-accessible artifact.

The acceptance path is:

```text
UTF-8 Chinese paper
→ inspect_document
→ validate_document
→ markdownToTypst
→ Node/headless Typst compiler
→ PDF bytes
→ temporary artifact store
→ MCP resource/tool retrieval
```

This PR does **not** implement corpus-scale batch publication, SaaS tenancy, billing, OAuth, or the final ChatGPT-hosted remote E2E deployment.

## 2. Existing Baseline

The repository already contains the core pieces required for the vertical slice:

- `src/typstconvert.js` provides the canonical Markdown/EveGlyph-MD → Typst conversion path, including math, callouts, AIMD and AIMD-C projection.
- `src/typst/theme.js`, `layout.js`, and `preamble.js` already separate typography/theme tokens from publication layout.
- `src/typstexport.js` compiles Typst to PDF in the browser using the self-hosted Web/WASM compiler and the repository's local font assets.
- `src/typstui.js` currently wires `markdownToTypst()` directly to the browser PDF compiler and browser download.
- `mcp-server.js` and `mcp-server-remote.js` share `mcp-tools.js`.
- Current MCP tools are `list_files`, `read_file`, `write_file`, `evaluate_aimdc`, and `validate_world_ir`.

The architectural gap is therefore not a new document language or a second renderer. It is a **headless compiler adapter, publication orchestration layer, artifact model, and MCP exposure** around the existing canonical conversion logic.

## 3. Core Invariants

### 3.1 Canonical source is immutable by rendering

For canonical source `S`, profile `P`, and render options `O`:

$$
R(S,P,O) \rightarrow (A,E)
$$

where `A` is the publication artifact and `E` is render evidence.

The renderer MUST NOT implicitly perform:

$$
R(S,P,O) \rightarrow S'
$$

`render_document`, `inspect_document`, and `validate_document` are non-destructive with respect to the workspace and canonical source.

### 3.2 One conversion semantics

Browser export and MCP/headless export MUST share `markdownToTypst()` and the same profile/theme/layout definitions. The PR MUST NOT create a second Markdown → Typst implementation.

### 3.3 Browser export remains backward compatible

The existing UI export flow remains functional. Existing documents with no explicit publication profile render with the same default theme/layout selection as before this PR.

### 3.4 No runtime CDN dependency

The headless renderer MUST use repository-controlled/static font assets and a Node-compatible compiler. It MUST NOT fetch fonts or compiler assets from a CDN at render time.

## 4. Architecture

```text
                    ┌──────────────────────────┐
Browser Editor ────→│ markdownToTypst()        │────→ Browser/WASM compiler
MCP / Node ─────────→│ + profile resolution     │────→ Node/headless compiler
                    └──────────────────────────┘
                                   │
                                   ▼
                         Publication Evidence
                                   │
                                   ▼
                         Temporary Artifact Store
                                   │
                       ┌───────────┴───────────┐
                       ▼                       ▼
                 MCP resource            tool fallback
```

### 4.1 New publication modules

Add a focused `src/publication/` subsystem. Exact file boundaries may be adjusted during implementation, but responsibilities are fixed:

- `profiles.js` — stable publication profile aliases and resolution.
- `inspect.js` — pure document structure inspection.
- `validate.js` — source/preflight validation.
- `prepare.js` — canonical source → Typst preparation using `markdownToTypst()` and explicit render profile override.
- `node-renderer.js` — Node-only Typst → PDF adapter.
- `artifact-store.js` — process-scoped ephemeral PDF artifact storage and metadata.

Browser-only imports MUST NOT leak into Node/MCP modules.

### 4.2 Profile precedence

Extend `markdownToTypst()` in a backward-compatible way so callers may optionally provide an explicit theme/layout override without mutating source frontmatter.

Resolution precedence:

```text
explicit render profile/options
→ document frontmatter typst_theme / typst_layout
→ existing EveGlyph defaults
```

This preserves canonical source while allowing an AI/MCP caller to choose publication presentation.

## 5. Publication Profiles in MVP

Expose two stable aliases in this PR:

```text
evemiss-academic-v1
  theme  = evemiss-serif-light
  layout = academic-paper

evemiss-whitepaper-v1
  theme  = evemiss-serif-light
  layout = technical-whitepaper
```

The aliases intentionally map onto existing theme/layout primitives rather than duplicating typography rules.

Future profiles (`book`, `internal-research`, journal-specific profiles) are out of scope for this PR.

## 6. Node / Headless Typst Compiler

Add `@myriaddreamin/typst-ts-node-compiler` at the version matching the repository's existing Typst.ts family (`0.7.0` at design time). The package is specifically published for Node environments and has platform-specific native packages selected by npm.

The Node adapter MUST:

1. accept Typst source as an in-memory string;
2. register/load the same self-hosted static fonts used by browser export, including Traditional Chinese coverage from `public/fonts/typst/`;
3. compile to PDF bytes without browser globals;
4. expose compiler diagnostics when available;
5. perform no network fetch during compilation;
6. return a `Buffer`/`Uint8Array` plus normalized diagnostics.

If the Node compiler API cannot consume the current local font set in a deterministic way, implementation MUST stop and surface the incompatibility rather than silently falling back to network fonts or a different renderer.

## 7. MCP Publication Tool Set

Keep existing tool names unchanged and add the following tools.

### 7.1 `get_publication_capabilities`

Read-only. Returns:

- publication runtime version;
- supported source/output formats;
- available stable profiles;
- renderer backend (`typst-node`);
- current artifact limits;
- known MVP limitations.

### 7.2 `inspect_document`

Input:

```json
{ "source": "..." }
```

Returns at minimum:

- title/frontmatter metadata when present;
- heading tree/count;
- character count;
- inline/display math count;
- table count;
- image count;
- code-block count;
- EveGlyph callout/AIMD/AIMD-C block counts;
- layout-risk notices that can be determined without compiling.

No writes.

### 7.3 `validate_document`

Input:

```json
{
  "source": "...",
  "profile": "evemiss-academic-v1"
}
```

MVP validation includes:

- input is a valid JavaScript string / UTF-8-compatible source payload;
- balanced canonical `$...$` / `$$...$$` math delimiters for the supported syntax;
- structurally closed fenced code and EveGlyph `:::` blocks where detectable;
- recognized publication profile;
- successful Markdown → Typst conversion;
- AIMD-C evaluation issues already surfaced by the canonical converter/evaluator path;
- normalized `errors`, `warnings`, and `notices`.

This tool is preflight validation, not a substitute for compiler diagnostics. Compiler-specific warnings/errors belong in render evidence.

### 7.4 `render_document`

Input:

```json
{
  "source": "...",
  "source_format": "eveglyph-md",
  "profile": "evemiss-academic-v1",
  "output_format": "pdf",
  "filename": "paper.pdf"
}
```

MVP supports `eveglyph-md` / Markdown source and PDF output only.

The tool:

1. validates profile and source;
2. prepares Typst through the canonical converter;
3. compiles real PDF bytes through the Node renderer;
4. calculates source and artifact SHA-256;
5. stores the PDF in the process-scoped artifact store;
6. returns artifact metadata, diagnostics/warnings, and an MCP resource link when supported.

It MUST NOT write to the workspace.

### 7.5 `get_render_artifact`

Tool-centric compatibility path for MCP hosts that do not provide an ergonomic resource UI. Takes `artifact_id` and returns artifact metadata plus the corresponding resource URI / supported content representation.

It MUST NOT return only a Windows/local filesystem path.

### 7.6 `get_render_report`

Takes `artifact_id` and returns render evidence:

```text
source_sha256
artifact_sha256
renderer backend/version
publication profile
resolved theme/layout
PDF byte size
normalized compiler diagnostics
validation warnings
created_at
```

Page count is included only if it can be derived reliably from the compiler/result without introducing a second PDF parsing dependency in this PR. Otherwise it is explicitly reported as unavailable in MVP rather than guessed.

## 8. MCP Resource Model

Artifacts use URIs of the form:

```text
eveglyph-artifact://<artifact-id>
```

The MCP server exposes a resource/template capable of resolving the URI against the process-scoped artifact store and returning:

```text
mimeType: application/pdf
blob: <base64 encoded PDF bytes>
```

Both stdio and remote HTTP entry points use the same artifact store module and resource resolver.

### 8.1 Remote stateless transport constraint

`mcp-server-remote.js` creates a fresh `McpServer` per HTTP request. Therefore artifact state MUST NOT live inside a `createMcpServer()` instance.

The store is module/process scoped so that:

```text
request 1: render_document
→ store artifact

request 2: resources/read or get_render_artifact
→ retrieve same artifact
```

works while the remote MCP process remains alive.

### 8.2 MVP artifact limits

Defaults for the first PR:

- TTL: 30 minutes;
- max single PDF: 64 MiB;
- max process artifact bytes: 256 MiB;
- eviction: expired first, then oldest artifacts until under limit;
- artifact IDs: cryptographically random UUIDs;
- no persistence across process restart.

These are local/private-runtime defaults, not commercial SaaS quotas.

## 9. Tool Safety Annotations

Publication tools are exposed as non-destructive computation/read flows.

Where supported by the SDK, annotate:

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
```

`render_document` may create a temporary in-process artifact, but it does not mutate canonical source or workspace state. Artifact creation is treated as ephemeral computation output.

Existing `write_file` retains its existing semantics and is not broadened by this PR.

## 10. Error Handling

Errors are normalized into stable categories rather than leaking raw implementation details only:

```text
invalid_profile
invalid_source
conversion_error
compile_error
artifact_too_large
artifact_not_found
artifact_expired
internal_error
```

Compiler diagnostics are preserved in structured evidence where possible.

No compile failure may produce a success artifact record.

## 11. Testing Strategy

Implementation follows TDD for new behavior.

### 11.1 Unit tests

Cover:

- profile alias resolution and precedence;
- default behavior remains unchanged without profile override;
- inspection counts/heading structure;
- validation of canonical math/fence cases;
- artifact SHA-256 and metadata;
- TTL/eviction/size limits;
- unknown/expired artifact handling.

### 11.2 Node renderer integration test

Compile a fixture containing:

```text
Traditional Chinese prose
English text
inline math
$$ display math $$
heading hierarchy
basic table
code block
```

Assertions:

- output begins with `%PDF-`;
- output is non-trivially sized;
- source/artifact hashes are stable for the returned bytes;
- no fatal compiler diagnostic;
- no network dependency is required by the test.

### 11.3 MCP E2E smoke test

Use the MCP SDK client against the local stdio server:

```text
spawn mcp-server.js with fixture workspace
→ call render_document
→ receive artifact_id/resource URI
→ read artifact resource or compatibility tool
→ decode bytes
→ assert %PDF-
```

This is the PR's most important executable acceptance test.

### 11.4 Regression verification

Run existing project verification in addition to new tests:

```text
npm run build
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```

Any existing tests/scripts discovered during implementation are also run if relevant.

## 12. Documentation Changes

Update:

- `README.md` — MCP publication tools and usage;
- `SECURITY.md` — artifact lifetime, remote bearer-token implications, non-workspace render semantics;
- `USER-GUIDE.md` only where the user-facing distinction between browser PDF export and MCP/headless publication needs clarification;
- `CHANGELOG.md` / `PROGRESS.md` according to repository convention.

Do not change package version in this PR unless repository release conventions require it explicitly during implementation; feature completion and release versioning remain separate decisions.

## 13. Explicit Non-Goals

Not in this PR:

- 50–100 document torture corpus;
- 500/3000-paper batch renderer;
- persistent artifact database/object storage;
- OAuth, tenant isolation, billing, rate limiting, job queue;
- public production endpoint/domain;
- source auto-repair or source mutation;
- arbitrary DOCX/PDF ingestion;
- alternate rendering engines;
- final ChatGPT Developer Mode production connection.

## 14. Acceptance Criteria

The PR is complete only when all of the following are true:

1. Browser PDF export still builds and retains existing default conversion semantics.
2. A Node/headless code path compiles real PDF bytes from the same `markdownToTypst()` output semantics.
3. Traditional Chinese fixture text renders through the local font path without a runtime CDN dependency.
4. MCP exposes the publication tools defined above.
5. `render_document` does not mutate the workspace.
6. A returned artifact can be retrieved by an MCP client as `application/pdf`, not merely as a server-local path.
7. Source/artifact hashes and renderer/profile evidence are returned.
8. The stdio MCP E2E smoke test retrieves a real `%PDF-` artifact.
9. New unit/integration tests pass.
10. Existing build and relevant verification scripts pass.

## 15. Follow-up PRs

After this vertical slice is merged, the next sequence is:

```text
PR 2: Rendering Conformance / Torture Corpus
→ PR 3: render_batch + manifests + quarantine
→ PR 4: remote/private deployment hardening
→ PR 5+: commercial publication service concerns
```

The 3000-paper corpus becomes a staged regression and publication benchmark only after the single-document runtime is proven stable.