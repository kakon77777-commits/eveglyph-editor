import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { preparePublication } from '../src/publication/prepare.js'
import { renderTypstToPdf } from '../src/publication/node-renderer.js'

const fixtureUrl = new URL('./fixtures/publication-zh.md', import.meta.url)

test('preparePublication applies profile to a derived render source without mutating canonical source', async () => {
  const source = await readFile(fixtureUrl, 'utf8')
  const before = source
  const prepared = preparePublication(source, { profile: 'evemiss-academic-v1' })

  assert.equal(source, before)
  assert.equal(prepared.profile, 'evemiss-academic-v1')
  assert.equal(prepared.theme, 'evemiss-serif-light')
  assert.equal(prepared.layout, 'academic-paper')
  assert.match(prepared.typstSource, /margin: \(x: 2\.5cm, y: 2\.8cm\)/)
  assert.equal(prepared.validation.ok, true)
})

test('Node renderer compiles Traditional Chinese publication fixture to real PDF bytes', async () => {
  const source = await readFile(fixtureUrl, 'utf8')
  const prepared = preparePublication(source, { profile: 'evemiss-academic-v1' })
  const result = await renderTypstToPdf(prepared.typstSource)

  const header = Buffer.from(result.bytes).subarray(0, 5).toString('ascii')
  assert.equal(header, '%PDF-')
  assert.ok(result.bytes.length > 1000)
  assert.equal(result.renderer.backend, 'typst-node')
  assert.equal(result.renderer.version, '0.7.0')
  assert.ok(Array.isArray(result.diagnostics))
})
