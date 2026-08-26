import { createHash, randomUUID } from 'node:crypto'

const DEFAULT_TTL_MS = 30 * 60 * 1000
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function artifactError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function normalizeBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes)
  if (bytes instanceof Uint8Array) return Buffer.from(bytes)
  throw new TypeError('artifact bytes must be a Buffer or Uint8Array')
}

export function createArtifactStore({
  ttlMs = DEFAULT_TTL_MS,
  maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  now = () => Date.now(),
} = {}) {
  const artifacts = new Map()
  const expiredIds = new Set()

  function totalBytes() {
    let total = 0
    for (const artifact of artifacts.values()) total += artifact.bytes.length
    return total
  }

  function cleanupExpired() {
    const t = now()
    for (const [id, artifact] of artifacts) {
      if (artifact.expiresAt <= t) {
        artifacts.delete(id)
        expiredIds.add(id)
      }
    }
  }

  function evictToLimit() {
    cleanupExpired()
    while (totalBytes() > maxTotalBytes && artifacts.size) {
      let oldest = null
      for (const candidate of artifacts.values()) {
        if (!oldest || candidate.createdAtMs < oldest.createdAtMs) oldest = candidate
      }
      artifacts.delete(oldest.id)
    }
  }

  function publicMetadata(artifact) {
    return {
      id: artifact.id,
      filename: artifact.filename,
      mimeType: 'application/pdf',
      resourceUri: `eveglyph-artifact://${artifact.id}`,
      sourceSha256: artifact.sourceSha256,
      artifactSha256: artifact.artifactSha256,
      profile: artifact.profile,
      resolvedTheme: artifact.resolvedTheme,
      resolvedLayout: artifact.resolvedLayout,
      renderer: artifact.renderer,
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
      bytes: artifact.bytes.length,
      createdAt: artifact.createdAt,
      expiresAt: artifact.expiresAtIso,
    }
  }

  function put(input) {
    const bytes = normalizeBytes(input.bytes)
    if (bytes.length > maxArtifactBytes) {
      throw artifactError('artifact_too_large', `artifact exceeds ${maxArtifactBytes} byte limit`)
    }

    cleanupExpired()
    const createdAtMs = now()
    const id = randomUUID()
    const artifact = {
      id,
      filename: String(input.filename || 'document.pdf').replace(/[\\/\r\n]/g, '_'),
      bytes,
      sourceSha256: input.sourceSha256,
      artifactSha256: sha256(bytes),
      profile: input.profile,
      resolvedTheme: input.resolvedTheme,
      resolvedLayout: input.resolvedLayout,
      renderer: input.renderer || {},
      diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
      createdAtMs,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: createdAtMs + ttlMs,
      expiresAtIso: new Date(createdAtMs + ttlMs).toISOString(),
    }
    artifacts.set(id, artifact)
    evictToLimit()
    return publicMetadata(artifact)
  }

  function get(id) {
    cleanupExpired()
    const artifact = artifacts.get(id)
    if (!artifact) {
      if (expiredIds.has(id)) throw artifactError('artifact_expired', `artifact ${id} has expired`)
      throw artifactError('artifact_not_found', `artifact ${id} was not found`)
    }
    return { ...publicMetadata(artifact), bytes: Buffer.from(artifact.bytes) }
  }

  function report(id) {
    const artifact = get(id)
    const byteLength = artifact.bytes.length
    const { bytes, ...metadata } = artifact
    return { ...metadata, bytes: byteLength }
  }

  function limits() {
    return { ttlMs, maxArtifactBytes, maxTotalBytes }
  }

  return { put, get, report, limits }
}

export const publicationArtifactStore = createArtifactStore()
export const PUBLICATION_ARTIFACT_LIMITS = Object.freeze({
  ttlMs: DEFAULT_TTL_MS,
  maxArtifactBytes: DEFAULT_MAX_ARTIFACT_BYTES,
  maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
})
