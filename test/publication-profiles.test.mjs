import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listPublicationProfiles,
  resolvePublicationProfile,
  resolvePublicationSelection,
} from '../src/publication/profiles.js'
import { markdownToTypst } from '../src/typstconvert.js'

test('stable publication aliases resolve to existing theme and layout primitives', () => {
  assert.deepEqual(listPublicationProfiles().map(p => p.id), [
    'evemiss-academic-v1',
    'evemiss-whitepaper-v1',
  ])

  assert.deepEqual(resolvePublicationProfile('evemiss-academic-v1'), {
    id: 'evemiss-academic-v1',
    theme: 'evemiss-serif-light',
    layout: 'academic-paper',
  })
  assert.deepEqual(resolvePublicationProfile('evemiss-whitepaper-v1'), {
    id: 'evemiss-whitepaper-v1',
    theme: 'evemiss-serif-light',
    layout: 'technical-whitepaper',
  })
})

test('unknown publication profile is rejected instead of silently falling back', () => {
  assert.throws(
    () => resolvePublicationProfile('not-a-profile'),
    /Unknown publication profile "not-a-profile"/,
  )
})

test('explicit theme and layout override the selected profile without mutating source', () => {
  assert.deepEqual(resolvePublicationSelection({
    profile: 'evemiss-academic-v1',
    theme: 'evemiss-classic-light',
    layout: 'long-form-book',
  }), {
    profile: 'evemiss-academic-v1',
    theme: 'evemiss-classic-light',
    layout: 'long-form-book',
  })
})

test('markdownToTypst keeps existing default output when called without render options', () => {
  const source = '# 標題\n\n中文正文。'
  const before = markdownToTypst(source)
  const after = markdownToTypst(source, {})
  assert.equal(after, before)
})

test('markdownToTypst render options override frontmatter presentation only', () => {
  const source = `---\ntypst_theme: evemiss-classic-light\ntypst_layout: long-form-book\n---\n# 標題\n`
  const fromFrontmatter = markdownToTypst(source)
  const overridden = markdownToTypst(source, {
    theme: 'evemiss-serif-light',
    layout: 'academic-paper',
  })

  assert.match(fromFrontmatter, /margin: \(x: 3cm, y: 2\.5cm\)/)
  assert.match(overridden, /margin: \(x: 2\.5cm, y: 2\.8cm\)/)
  assert.notEqual(overridden, fromFrontmatter)
  assert.equal(source.includes('typst_theme: evemiss-classic-light'), true)
})
