// ─── Capability analysis (multi-backend rendering roadmap, Phase 2) ────────
// With only one active backend (katex — mathjax is `status: 'planned'` in
// registry.js, not wired), there's no cross-backend routing decision to
// make yet. What's real today: given a formula, decide whether a known Safe
// Rewrite can adapt it to something the active backend already supports,
// before ever attempting to render it. This is the currently-useful subset
// of what the whitepaper calls Capability Analysis — full requirement-vs-
// capability set matching (whitepaper §3.3's Compatible(m,b) = R(m)⊆C(b))
// has nothing to compare against until a second backend exists to route to.
import { applySafeRewrites } from './rewrite.js'

// Pre-processes one formula's TeX source before handing it to the active
// backend. Returns { tex, appliedRewrites } — appliedRewrites is empty when
// nothing needed adapting.
export function prepareFormula(tex) {
  const { tex: rewritten, applied } = applySafeRewrites(tex)
  return { tex: rewritten, appliedRewrites: applied }
}
