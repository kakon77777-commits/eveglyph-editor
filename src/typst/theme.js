// ─── Typst theme tokens (roadmap Phase 4: Typst Theme Compiler) ────────────
// Font choices are constrained to what's actually self-hosted in
// public/fonts/typst/ (see typstexport.js's own header comment for the full
// provenance/licensing story: DejaVu Sans Mono / Libertinus Serif / New
// Computer Modern + Math from Typst's own "text" asset bundle, plus Noto
// Serif TC). "New Computer Modern" and "DejaVu Sans Mono" are Typst's own
// documented default family names for exactly those font files (New
// Computer Modern is literally Typst's built-in default text font when none
// is specified) — not guessed from filenames. No sans-serif family is
// available without downloading new fonts, a real decision needing Neo's
// go-ahead (same precedent as the two font downloads already made
// 2026-07-14) — both themes below are serif, honestly, not a themed
// illusion of variety that isn't really there yet.
export const TYPST_THEMES = {
  'evemiss-serif-light': {
    id: 'evemiss-serif-light',
    typography: {
      bodyLatin: 'Libertinus Serif',
      bodyZh: 'Noto Serif TC',
      headingLatin: 'Libertinus Serif',
      headingZh: 'Noto Serif TC',
      mono: 'DejaVu Sans Mono',
    },
    // Scale/spacing match the pre-Phase-4 hardcoded preamble exactly — this
    // is the default theme, so a document with no theme/layout override
    // renders the same PDF as before this phase, not a surprise change.
    scale: { body: '10.5pt', h1: '17pt', h2: '13.5pt', h3: '11.5pt' },
    colors: {
      text: '#1a1a1a', muted: '#6b7280', accent: '#2563eb',
      theorem: '#8b5cf6', definition: '#3b82f6', warning: '#ef4444', note: '#f59e0b',
    },
    // `leading` = Typst's #set par(leading:) — space between LINES within a
    // paragraph, matching the property the original hardcoded preamble
    // actually set. Not the same thing as space BETWEEN paragraphs
    // (Typst's separate #set par(spacing:), left at its default here).
    spacing: { leading: '0.65em', sectionBefore: '0.5em', sectionAfter: '0.35em' },
  },
  'evemiss-classic-light': {
    id: 'evemiss-classic-light',
    typography: {
      bodyLatin: 'New Computer Modern',
      bodyZh: 'Noto Serif TC',
      headingLatin: 'New Computer Modern',
      headingZh: 'Noto Serif TC',
      mono: 'DejaVu Sans Mono',
    },
    scale: { body: '11pt', h1: '18pt', h2: '14.5pt', h3: '12.5pt' },
    colors: {
      text: '#111111', muted: '#555555', accent: '#7c3aed',
      theorem: '#6d28d9', definition: '#1d4ed8', warning: '#b91c1c', note: '#b45309',
    },
    spacing: { leading: '0.7em', sectionBefore: '1.6em', sectionAfter: '0.7em' },
  },
}

export function getTheme(id) {
  return TYPST_THEMES[id] || TYPST_THEMES['evemiss-serif-light']
}
