import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listPublicationProfiles,
  resolvePublicationProfile,
  resolvePublicationSelection,
} from '../src/publication/profiles.js'

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

test('explicit theme and layout override the selected profile without mutating a document', () => {
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

test('unknown explicit theme or layout is rejected instead of silently falling back', () => {
  assert.throws(
    () => resolvePublicationSelection({ theme: 'not-a-theme' }),
    /Unknown Typst theme "not-a-theme"/,
  )
  assert.throws(
    () => resolvePublicationSelection({ layout: 'not-a-layout' }),
    /Unknown Typst layout "not-a-layout"/,
  )
})
