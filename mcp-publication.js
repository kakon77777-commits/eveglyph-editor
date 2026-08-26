import { createHash } from 'node:crypto'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { inspectDocument } from './src/publication/inspect.js'
import { validateDocument } from './src/publication/validate.js'
import { listPublicationProfiles } from './src/publication/profiles.js'
import { preparePublication } from './src/publication/prepare.js'
import { renderTypstToPdf, NODE_RENDERER_INFO } from './src/publication/node-renderer.js'
import {
  publicationArtifactStore,
  PUBLICATION_ARTIFACT_LIMITS,
} from './src/publication/artifact-store.js'

const jsonResult = value => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

function errorResult(error) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code: error?.code || 'internal_error',
          message: error?.message || String(error),
          details: error?.details,
        },
      }, null, 2),
    }],
    isError: true,
  }
}

function sourceSha256(source) {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex')
}

function toolAnnotations({ idempotent = true } = {}) {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: false,
  }
}

function artifactSummary(metadata) {
  return {
    artifact_id: metadata.id,
    filename: metadata.filename,
    mime_type: metadata.mimeType,
    resource_uri: metadata.resourceUri,
    source_sha256: metadata.sourceSha256,
    artifact_sha256: metadata.artifactSha256,
    profile: metadata.profile,
    resolved_theme: metadata.resolvedTheme,
    resolved_layout: metadata.resolvedLayout,
    renderer: metadata.renderer,
    bytes: metadata.bytes,
    created_at: metadata.createdAt,
    expires_at: metadata.expiresAt,
    diagnostics: metadata.diagnostics,
    warnings: metadata.warnings,
  }
}

export function registerPublicationMcp(server, { workspaceRoot } = {}) {
  server.registerTool('get_publication_capabilities', {
    title: 'Get EveGlyph publication capabilities',
    description: 'Describe the headless EveGlyph Publication Runtime, supported profiles and temporary artifact limits.',
    annotations: toolAnnotations(),
  }, async () => jsonResult({
    runtime: 'eveglyph-publication-mvp',
    version: '0.1.0',
    source_formats: ['eveglyph-md', 'markdown'],
    output_formats: ['pdf'],
    profiles: listPublicationProfiles(),
    renderer: { backend: NODE_RENDERER_INFO.backend, version: NODE_RENDERER_INFO.version },
    artifact_limits: PUBLICATION_ARTIFACT_LIMITS,
    limitations: [
      'single-document rendering only',
      'artifacts are process-scoped and expire automatically',
      'rendering does not mutate workspace files',
    ],
  }))

  server.registerTool('inspect_document', {
    title: 'Inspect a publication document',
    description: 'Inspect canonical UTF-8 EveGlyph/Markdown source for headings, math, tables, images, code, metadata and EveGlyph block counts. Does not modify source.',
    inputSchema: { source: z.string() },
    annotations: toolAnnotations(),
  }, async ({ source }) => {
    try { return jsonResult(inspectDocument(source)) }
    catch (error) { return errorResult(error) }
  })

  server.registerTool('validate_document', {
    title: 'Validate a publication document',
    description: 'Run non-destructive publication preflight validation before PDF compilation.',
    inputSchema: {
      source: z.string(),
      profile: z.string().optional(),
    },
    annotations: toolAnnotations(),
  }, async ({ source, profile }) => {
    try { return jsonResult(validateDocument(source, { profile })) }
    catch (error) { return errorResult(error) }
  })

  server.registerTool('render_document', {
    title: 'Render a publication document to PDF',
    description: 'Render canonical UTF-8 EveGlyph/Markdown source to a temporary PDF artifact without modifying the workspace or source. Relative images/assets resolve inside the selected MCP workspace.',
    inputSchema: {
      source: z.string(),
      source_format: z.enum(['eveglyph-md', 'markdown']).default('eveglyph-md'),
      profile: z.string().default('evemiss-whitepaper-v1'),
      output_format: z.literal('pdf').default('pdf'),
      filename: z.string().optional(),
      theme: z.string().optional(),
      layout: z.string().optional(),
    },
    annotations: toolAnnotations({ idempotent: false }),
  }, async ({ source, profile, filename, theme, layout }) => {
    try {
      const prepared = preparePublication(source, { profile, theme, layout })
      const rendered = await renderTypstToPdf(prepared.typstSource, { workspaceRoot })
      const metadata = publicationArtifactStore.put({
        bytes: rendered.bytes,
        filename: filename || 'document.pdf',
        sourceSha256: sourceSha256(source),
        profile: prepared.profile,
        resolvedTheme: prepared.theme,
        resolvedLayout: prepared.layout,
        diagnostics: rendered.diagnostics,
        warnings: prepared.validation.warnings,
        renderer: rendered.renderer,
      })
      return {
        content: [
          { type: 'text', text: JSON.stringify(artifactSummary(metadata), null, 2) },
          {
            type: 'resource_link',
            uri: metadata.resourceUri,
            name: metadata.filename,
            mimeType: metadata.mimeType,
            size: metadata.bytes,
            description: 'Temporary EveGlyph-rendered PDF artifact',
          },
        ],
      }
    } catch (error) {
      return errorResult(error)
    }
  })

  server.registerTool('get_render_artifact', {
    title: 'Get rendered artifact metadata',
    description: 'Resolve a temporary EveGlyph publication artifact and return its resource URI and metadata.',
    inputSchema: { artifact_id: z.string() },
    annotations: toolAnnotations(),
  }, async ({ artifact_id }) => {
    try {
      const artifact = publicationArtifactStore.get(artifact_id)
      return jsonResult(artifactSummary({ ...artifact, bytes: artifact.bytes.length }))
    } catch (error) {
      return errorResult(error)
    }
  })

  server.registerTool('get_render_report', {
    title: 'Get publication render evidence',
    description: 'Return source/artifact hashes, renderer/profile selection, diagnostics, warnings and artifact lifetime for a rendered document.',
    inputSchema: { artifact_id: z.string() },
    annotations: toolAnnotations(),
  }, async ({ artifact_id }) => {
    try {
      const artifact = publicationArtifactStore.get(artifact_id)
      return jsonResult({
        artifact_id: artifact.id,
        source_sha256: artifact.sourceSha256,
        artifact_sha256: artifact.artifactSha256,
        profile: artifact.profile,
        resolved_theme: artifact.resolvedTheme,
        resolved_layout: artifact.resolvedLayout,
        renderer: artifact.renderer,
        bytes: artifact.bytes.length,
        diagnostics: artifact.diagnostics,
        warnings: artifact.warnings,
        created_at: artifact.createdAt,
        expires_at: artifact.expiresAt,
      })
    } catch (error) {
      return errorResult(error)
    }
  })

  server.registerResource(
    'publication-artifact',
    new ResourceTemplate('eveglyph-artifact://{artifact_id}', { list: undefined }),
    {
      title: 'EveGlyph publication artifact',
      description: 'Temporary PDF artifact produced by EveGlyph Publication Runtime.',
      mimeType: 'application/pdf',
    },
    async (uri, { artifact_id }) => {
      const artifact = publicationArtifactStore.get(String(artifact_id))
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/pdf',
          blob: artifact.bytes.toString('base64'),
        }],
      }
    },
  )
}
