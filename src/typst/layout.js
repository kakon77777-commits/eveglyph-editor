// ─── Typst layout profiles (roadmap Phase 4: Typst Theme Compiler) ─────────
// `technical-whitepaper` matches the previously-hardcoded PREAMBLE exactly
// (A4, 2.2cm/2.5cm margins, justified, no first-line indent) and is the
// default — a document that doesn't opt into a theme/layout renders
// byte-for-byte the same PDF as before this phase, no visual regression.
export const TYPST_LAYOUTS = {
  'academic-paper': {
    id: 'academic-paper',
    page: { size: 'a4', margin: { x: '2.5cm', y: '2.8cm' } },
    paragraph: { justify: true, firstLineIndent: '1.5em' },
    numbering: { equations: true },
  },
  'technical-whitepaper': {
    id: 'technical-whitepaper',
    page: { size: 'a4', margin: { x: '2.2cm', y: '2.5cm' } },
    paragraph: { justify: true, firstLineIndent: '0em' },
    // false, not true — the pre-Phase-4 preamble never numbered equations;
    // this is the default layout, so it shouldn't introduce a visible
    // change for documents that don't explicitly ask for one.
    numbering: { equations: false },
  },
  'long-form-book': {
    id: 'long-form-book',
    page: { size: 'a4', margin: { x: '3cm', y: '2.5cm' } },
    paragraph: { justify: true, firstLineIndent: '1.2em' },
    numbering: { equations: false },
  },
}

export function getLayout(id) {
  return TYPST_LAYOUTS[id] || TYPST_LAYOUTS['technical-whitepaper']
}
