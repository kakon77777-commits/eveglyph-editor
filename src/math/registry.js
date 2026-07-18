// ─── Math backend registry (multi-backend rendering roadmap, Phase 2) ──────
// Declares what each math backend actually supports, so gaps can be reasoned
// about instead of only detected after the fact (Phase 1's diagnostics
// panel). katex's knownUnsupported list is empirically sourced — verified
// directly against the installed 0.16.47 build (see examples/math-corpus.md
// and PROGRESS.md's Phase 1 entry), not copied from documentation.
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
  // Not wired yet. Prototyping found MathJax's browser bundle (tex-svg.js) is
  // a 1.85MB IIFE built for a <script> tag + window.MathJax, not an ESM
  // export like katex — real integration needs either accepting that
  // script-injection pattern or spending real time on mathjax-full's more
  // modular (but far less documented) component API. Neo's call, 2026-07-18:
  // ship the rest of Phase 2 without it, revisit as its own follow-up.
  mathjax: {
    id: 'math.mathjax',
    version: '4.1.3',
    status: 'planned',
    domains: ['math'],
    outputs: ['svg'],
    loading: { mode: 'lazy' },
    security: { network: false, filesystem: false },
  },
}

export function activeBackend() {
  return MATH_BACKENDS.katex
}
