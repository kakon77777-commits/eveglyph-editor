// ─── Visual backend registry (roadmap Phase 4 decision, Phase 5 build) ──────
// Confirmed with Neo (Phase 4): World IR (viewregistry.js/validate.js,
// already shipped) stays exactly as-is — no internal refactor, registered by
// name only. `chart-renderer` and `function-plot-renderer` are Phase 5's
// real, working entries — hand-rolled SVG (src/visual/chart.js, plot.js),
// no external charting library, matching this project's "no framework"
// convention. `diagram-renderer` (flowchart/graph auto-layout) and Typst
// projection for chart/plot were both explicitly scoped OUT of this pass
// (Neo's call) — deliberately absent, not forgotten; see PROGRESS.md.
export const VISUAL_BACKENDS = {
  'world-renderer': {
    id: 'visual.world-renderer',
    status: 'active',
    domains: ['visual'],
    kind: 'world-projection',
    outputs: ['svg', 'html'],
    loading: { mode: 'eager' },
    security: { network: false, filesystem: false },
    note: 'Existing World IR mode (viewregistry.js/validate.js) — internal logic unchanged, registered here only.',
  },
  'chart-renderer': {
    id: 'visual.chart-renderer',
    status: 'active',
    domains: ['visual'],
    kind: 'chart-ir',
    types: ['bar', 'line', 'pie'],
    outputs: ['svg'],
    loading: { mode: 'eager' },
    security: { network: false, filesystem: false },
    note: 'Single-series only — no legend/axis story for multiple series yet, a real deferred extension. Reachable standalone (::: chart :::) or from AIMD-C data (aimd-view renderer="chart").',
  },
  'function-plot-renderer': {
    id: 'visual.function-plot-renderer',
    status: 'active',
    domains: ['visual'],
    kind: 'function-plot-ir',
    outputs: ['svg'],
    loading: { mode: 'eager' },
    security: { network: false, filesystem: false },
    note: 'Single-variable real functions only, sampled over a domain via AIMD-C\'s own expression evaluator (src/aimdc/evaluator.js) — same closed grammar, no eval. Standalone block only (::: plot :::) — not reachable from aimd-view yet (that would mean referencing a function\'s definition, not a resolved value).',
  },
}

export function getVisualBackend(id) {
  return VISUAL_BACKENDS[id] || null
}
