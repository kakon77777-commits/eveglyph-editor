# EveGlyph MCP Publication Runtime MVP

This document describes the first single-document publication runtime exposed by EveGlyph MCP.

## Purpose

The publication runtime lets an MCP client submit canonical UTF-8 EveGlyph/Markdown source and obtain an EveGlyph-rendered PDF without modifying the source document or workspace files.

```text
canonical UTF-8 source
→ inspect / validate
→ EveGlyph Markdown → Typst conversion
→ headless Typst compiler
→ temporary PDF artifact
→ MCP resource retrieval
```

The browser PDF export and the MCP/headless path share EveGlyph's existing `markdownToTypst()` conversion semantics and existing Typst theme/layout primitives.

## Publication profiles

MVP aliases:

| Profile | Theme | Layout |
| --- | --- | --- |
| `evemiss-academic-v1` | `evemiss-serif-light` | `academic-paper` |
| `evemiss-whitepaper-v1` | `evemiss-serif-light` | `technical-whitepaper` |

Profile selection is applied only to an in-memory derived render source. The canonical source is not rewritten.

## MCP tools

### `get_publication_capabilities`

Returns supported input/output formats, profiles, renderer backend and artifact limits.

### `inspect_document`

Returns publication-relevant structure such as metadata, headings, math, tables, images, code blocks, and EveGlyph block counts.

### `validate_document`

Runs non-destructive preflight validation. It checks the requested profile, source structure, supported math delimiters, fenced code / EveGlyph block closure, and Markdown → Typst conversion.

### `render_document`

Renders a real PDF with the Node/headless Typst compiler. Input example:

```json
{
  "source": "# 中文論文\n\n正文。",
  "source_format": "eveglyph-md",
  "profile": "evemiss-academic-v1",
  "output_format": "pdf",
  "filename": "paper.pdf"
}
```

The result contains an `artifact_id`, source/artifact SHA-256 values, resolved publication profile, renderer metadata, expiry time, and an `eveglyph-artifact://...` resource URI.

### `get_render_artifact`

Returns metadata and resource location for a temporary rendered PDF.

### `get_render_report`

Returns publication evidence: hashes, profile/theme/layout, renderer version, diagnostics, warnings, byte size, and artifact lifetime.

## Artifact resource

Rendered PDFs are exposed as MCP binary resources:

```text
eveglyph-artifact://<artifact-id>
```

Resource reads return:

```text
mimeType: application/pdf
blob: base64 PDF bytes
```

They never return only a machine-local `C:\...` path.

## Artifact lifetime and limits

MVP defaults:

- TTL: 30 minutes
- Maximum single PDF: 64 MiB
- Maximum process artifact memory: 256 MiB
- Expired artifacts are evicted first; oldest remaining artifacts are evicted when necessary
- Artifacts are not persisted across MCP process restarts

The store is process-scoped so the stateless remote HTTP MCP transport can render in one request and retrieve the artifact in a later request while the process remains alive.

## Security boundary

Publication operations are non-destructive to canonical source and workspace files. Rendering creates only an ephemeral in-process artifact.

Remote MCP remains protected by `EVEGLYPH_MCP_TOKEN`. A leaked token can expose every MCP capability available to the selected workspace, including the pre-existing `write_file` tool, so remote publication access must use the same bearer-token and tunnel security discipline documented in `SECURITY.md`.

`render_document` is not declared idempotent: repeated calls do not change the source, but each call creates a distinct temporary artifact ID.

## Local stdio usage

Start EveGlyph MCP as before:

```sh
npm run mcp -- /absolute/path/to/workspace
```

An MCP client can then call:

```text
get_publication_capabilities
→ inspect_document
→ validate_document
→ render_document
→ resources/read(eveglyph-artifact://...)
```

## Current MVP limitations

- Single-document publication only
- PDF output only
- No persistent artifact database/object storage
- No batch 3000-paper orchestration yet
- No OAuth, multi-tenant SaaS, billing, or public production endpoint
- No automatic canonical-source repair

## Verification status for PR #5

The branch contains Node built-in publication tests plus an MCP stdio end-to-end test that verifies returned bytes start with `%PDF-`. The current ChatGPT execution environment cannot run npm against GitHub, and the repository has not produced GitHub Actions runs during this implementation session. Therefore runtime test results must be treated as pending until a network-enabled runner executes them.

`package-lock.json` also requires regeneration with `npm install` after adding `@myriaddreamin/typst-ts-node-compiler@0.7.0`. The PR must remain Draft until that generated lockfile is committed and the full verification suite is green.
