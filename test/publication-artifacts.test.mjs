import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { createArtifactStore } from '../src/publication/artifact-store.js'

const pdf = Buffer.from('%PDF-1.7\nmock pdf bytes')

function baseInput(bytes = pdf) {
  return {
    bytes,
    filename: 'paper.pdf',
    sourceSha256: 'source-hash',
    profile: 'evemiss-academic-v1',
    resolvedTheme: 'evemiss-serif-light',
    resolvedLayout: 'academic-paper',
    diagnostics: [],
    warnings: [],
    renderer: { backend: 'typst-node', version: '0.7.0' },
  }
}

test('artifact store records hash, PDF MIME type, resource URI, and report byte size', () => {
  const store = createArtifactStore()
  const artifact = store.put(baseInput())

  assert.match(artifact.id, /^[0-9a-f-]{36}$/)
  assert.equal(artifact.mimeType, 'application/pdf')
  assert.equal(artifact.resourceUri, `eveglyph-artifact://${artifact.id}`)
  assert.equal(artifact.artifactSha256, createHash('sha256').update(pdf).digest('hex'))
  assert.equal(artifact.bytes, pdf.length)

  const fetched = store.get(artifact.id)
  assert.equal(Buffer.compare(fetched.bytes, pdf), 0)
  assert.equal(store.report(artifact.id).bytes, pdf.length)
})

test('artifact store distinguishes unknown and expired artifact IDs', () => {
  let now = 1000
  const store = createArtifactStore({ ttlMs: 10, now: () => now })
  assert.throws(() => store.get('missing'), e => e.code === 'artifact_not_found')

  const artifact = store.put(baseInput())
  now = 1011
  assert.throws(() => store.get(artifact.id), e => e.code === 'artifact_expired')
})

test('artifact store rejects a single artifact larger than its configured limit', () => {
  const store = createArtifactStore({ maxArtifactBytes: 8 })
  assert.throws(() => store.put(baseInput(Buffer.alloc(9))), e => e.code === 'artifact_too_large')
})

test('artifact store evicts oldest artifacts when total memory exceeds the limit', () => {
  let now = 1
  const store = createArtifactStore({ maxArtifactBytes: 20, maxTotalBytes: 20, now: () => now++ })
  const first = store.put(baseInput(Buffer.alloc(12, 1)))
  const second = store.put(baseInput(Buffer.alloc(12, 2)))

  assert.throws(() => store.get(first.id), e => e.code === 'artifact_not_found')
  assert.equal(store.get(second.id).bytes.length, 12)
})
