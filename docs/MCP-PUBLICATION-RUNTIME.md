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

### Implementation note: profile injection

The design initially proposed extending `markdownToTypst(source, options)`. The MVP deliberately uses a narrower compatibility strategy instead:

```text
canonical source
→ create derived in-memory source
→ upsert typst_theme / typst_layout on the derived string only
→ existing markdownToTypst(derivedSource)
```

This avoids changing the existing converter API or browser PDF export path while preserving one converter and a non-mutating canonical source.

## MCP tools

### `get_publication_capabilities`
Returns supported formats, profiles, renderer backend and artifact limits.

### `inspect_document`
Returns metadata, headings, math, tables, images, code blocks, and EveGlyph block counts.

### `validate_document`
Runs non-destructive preflight validation for profile, canonical math delimiters, fences/blocks, and Markdown → Typst conversion.

### `render_document`
Renders a real PDF with the Node/headless Typst compiler. Example:

```json
{
  "source": "# 中文論文\n\n正文。",
  "source_format": "eveglyph-md",
  "profile": "evemiss-academic-v1",
  "output_format": "pdf",
  "filename": "paper.pdf"
}
```

The result contains artifact identity, source/artifact SHA-256, resolved presentation, renderer metadata, expiry time, and an `eveglyph-artifact://...` URI.

Relative image/asset paths are resolved from the workspace selected when the MCP server starts. EveGlyph's bundled Typst/CJK fonts are loaded from the EveGlyph installation itself, independently of that user workspace.

### `get_render_artifact`
Returns metadata and resource location for a temporary rendered PDF.

### `get_render_report`
Returns hashes, profile/theme/layout, renderer version, diagnostics, warnings, byte size, and artifact lifetime.

## Artifact resource

Rendered PDFs are exposed as:

```text
eveglyph-artifact://<artifact-id>
```

Resource reads return `application/pdf` with base64 PDF bytes, never only a server-local filesystem path.

## Artifact lifetime and limits

- TTL: 30 minutes
- Maximum single PDF: 64 MiB
- Maximum process artifact memory: 256 MiB
- Expired artifacts evicted first, then oldest artifacts
- No persistence across MCP process restart

The store is process-scoped so stateless remote HTTP can render in one request and retrieve in a later request while the process remains alive.

## Security boundary

Publication operations do not mutate canonical source or workspace files. Rendering creates only an ephemeral in-process artifact.

Remote MCP remains protected by `EVEGLYPH_MCP_TOKEN`. A leaked token can expose all MCP capabilities for the selected workspace, including the pre-existing `write_file` tool.

`render_document` is deliberately not declared idempotent: repeated calls leave source untouched but create distinct temporary artifact IDs.

Unknown publication profiles, explicit Typst themes, and layouts fail closed instead of silently selecting a fallback presentation.

## Local stdio usage

```sh
npm run mcp -- /absolute/path/to/workspace
```

Then:

```text
get_publication_capabilities
→ inspect_document
→ validate_document
→ render_document
→ resources/read(eveglyph-artifact://...)
```

## MVP limitations

- Single-document publication only
- PDF output only
- No persistent artifact database/object storage
- No 3000-paper batch orchestration yet
- No OAuth, multi-tenant SaaS, billing, or public endpoint
- No automatic canonical-source repair

## Verification status for PR #5

The branch contains Node built-in publication tests plus an MCP stdio end-to-end test that requires decoded output to start with `%PDF-`.

Two blockers remain before the PR can leave Draft status:

1. **Runtime verification pending.** The current ChatGPT container cannot resolve GitHub/npm hosts, the YepCode runner returned authorization 403, GitHub Actions produced no runs during the implementation session, and the archive-download fallback was blocked by the execution environment's URL safety gate. Tests exist but have not been honestly observed GREEN in a network-enabled runner.
2. **Generated package-lock update pending.** `package.json` now requires `@myriaddreamin/typst-ts-node-compiler@0.7.0`. `package-lock.json` must be regenerated by npm; integrity/native optional-dependency entries must not be hand-written. The temporary PR workflow uses `npm install`. Before merge, regenerate and commit the lockfile and restore CI to `npm ci`.

The PR must remain Draft until both blockers are cleared and the publication/build/dynamic-regression suite is green.
