// Stable publication-profile aliases for AI/MCP callers.
// Profiles intentionally reuse the existing Typst theme/layout primitives so
// there is one source of truth for typography and page-layout behavior.
import { TYPST_THEMES } from '../typst/theme.js'
import { TYPST_LAYOUTS } from '../typst/layout.js'

export const PUBLICATION_PROFILES = Object.freeze({
  'evemiss-academic-v1': Object.freeze({
    id: 'evemiss-academic-v1',
    theme: 'evemiss-serif-light',
    layout: 'academic-paper',
  }),
  'evemiss-whitepaper-v1': Object.freeze({
    id: 'evemiss-whitepaper-v1',
    theme: 'evemiss-serif-light',
    layout: 'technical-whitepaper',
  }),
})

export function listPublicationProfiles() {
  return Object.values(PUBLICATION_PROFILES).map(profile => ({ ...profile }))
}

export function resolvePublicationProfile(id) {
  const key = id || 'evemiss-whitepaper-v1'
  const profile = PUBLICATION_PROFILES[key]
  if (!profile) throw new Error(`Unknown publication profile "${key}"`)
  return { ...profile }
}

export function resolvePublicationSelection({ profile, theme, layout } = {}) {
  const base = resolvePublicationProfile(profile)
  const selectedTheme = theme || base.theme
  const selectedLayout = layout || base.layout
  if (!TYPST_THEMES[selectedTheme]) throw new Error(`Unknown Typst theme "${selectedTheme}"`)
  if (!TYPST_LAYOUTS[selectedLayout]) throw new Error(`Unknown Typst layout "${selectedLayout}"`)
  return {
    profile: base.id,
    theme: selectedTheme,
    layout: selectedLayout,
  }
}
