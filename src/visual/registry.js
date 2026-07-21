// ─── Visual backend registry (roadmap Phase 4 decision, Phase 5 full build) ─
// Confirmed with Neo: World IR (viewregistry.js/validate.js, already shipped)
// stays exactly as-is — no internal refactor. This module only "registers it
// by name" so the Backend Registry concept (whitepaper §8.1) has an honest,
// if minimal, entry for the visual domain instead of silently omitting the
// one backend type that was explicitly discussed. Full Visual IR (chart /
// diagram / function-plot projections, capability negotiation, safe rewrite)
// is roadmap Phase 5 — this stub is deliberately thin, not a placeholder for
// logic that secretly already exists.
export const VISUAL_BACKENDS = {
  'world-renderer': {
    id: 'visual.world-renderer',
    status: 'active',
    domains: ['visual'],
    kind: 'world-projection',
    outputs: ['svg', 'html'],
    loading: { mode: 'eager' },
    security: { network: false, filesystem: false },
    note: 'Existing World IR mode (viewregistry.js/validate.js) — internal logic unchanged, registered here only. Full Visual IR integration is roadmap Phase 5.',
  },
}

export function getVisualBackend(id) {
  return VISUAL_BACKENDS[id] || null
}
