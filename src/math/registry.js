// ─── Math backend registry (multi-backend rendering roadmap, Phase 2) ──────
// Declares what each math backend actually supports, so gaps can be reasoned
// about instead of only detected after the fact (Phase 1's diagnostics
// panel). Each `knownUnsupported` list is empirically sourced — verified
// directly against the actual installed build (see examples/math-corpus.md
// and PROGRESS.md's Phase 1/2b entries), not copied from documentation.
// Not yet consulted by any real routing decision (mathdiagnostics.js's
// fallback flow just always tries MathJax on a katex failure) — this is
// currently documentation/data, the reference future routing logic would
// read from, not something already driving behavior.
export const MATH_BACKENDS = {
  katex: {
    id: 'math.katex',
    version: '0.16.47',
    status: 'active',
    domains: ['math'],
    outputs: ['html'],
    loading: { mode: 'eager' },   // already bundled at boot today
    security: { network: false, filesystem: false },
    knownUnsupported: {
      environments: ['multline', 'tikzcd'],
      commands: ['\\ce'],   // mhchem — needs an extension this app doesn't load
    },
  },
  // Wired 2026-07-18 via math/mathjaxbackend.js, using @mathjax/src's lower-
  // level component API (TeX/SVG/liteAdaptor) rather than its pre-built
  // tex-svg.js bundle (a 1.85MB IIFE built for a <script> tag +
  // window.MathJax — doesn't fit this app's ESM/dynamic-import model).
  mathjax: {
    id: 'math.mathjax',
    version: '4.1.3',
    status: 'active',
    domains: ['math'],
    outputs: ['svg'],
    loading: { mode: 'lazy' },
    security: { network: false, filesystem: false },
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'mhchem'],
    // Only tikzcd is a genuine engine gap — real TikZ, neither engine
    // implements it. An undefined macro isn't a "backend gap" (no backend
    // could ever render a command that was never defined anywhere), so it's
    // not listed as one here or for katex.
    knownUnsupported: {
      environments: ['tikzcd'],
    },
  },
}
