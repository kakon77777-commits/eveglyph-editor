// ─── Safe Rewrite (multi-backend rendering roadmap, Phase 2) ───────────────
// A formula that fails for a purely syntactic reason — not a real semantic
// gap — gets rewritten before rendering instead of just being diagnosed.
// First (only) rule: `split` ≡ `aligned`, the exact substitution already
// applied ad-hoc on the Typst export side (src/typstconvert.js, 2026-07-15,
// after Neo found it broke a real document) but never on the preview side —
// Phase 1's diagnostics panel is what caught examples/typst-export-demo.md
// silently failing there too.
//
// Every rule here must be a `safe` rewrite in whitepaper terms (§4.2) —
// provably equivalent, not just "usually works." The `compatible`/`lossy`
// tiers aren't implemented; there's nothing here that isn't a straight
// environment-name alias.
const REWRITE_RULES = [
  {
    id: 'split-to-aligned',
    pattern: /\\begin\{split\}/g,
    replacement: '\\begin{aligned}',
    endPattern: /\\end\{split\}/g,
    endReplacement: '\\end{aligned}',
  },
]

// Applies every safe rule to one formula's TeX source. Returns the (possibly
// unchanged) source plus the ids of rules that actually fired, so the caller
// can report "this formula was auto-normalized" without re-diffing.
export function applySafeRewrites(tex) {
  let out = tex
  const applied = []
  for (const rule of REWRITE_RULES) {
    const before = out
    out = out.replace(rule.pattern, rule.replacement)
    if (rule.endPattern) out = out.replace(rule.endPattern, rule.endReplacement)
    if (out !== before) applied.push(rule.id)
  }
  return { tex: out, applied }
}
