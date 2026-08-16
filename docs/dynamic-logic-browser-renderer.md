# Dynamic Logic Browser Renderer v0.1

This increment turns the merged Dynamic Logic MVP from manual snapshot replay
into an event-driven browser projection.

## Core rule

**No event, no motion.**

The renderer never runs a decorative `requestAnimationFrame` thinking loop.
Motion is emitted only when the browser observes a real change in replay cursor,
judgment state, or Dynamic Logic external-ref value.

## Pipeline

```text
Document-declared evidence prefix
  -> Dynamic Logic reducer
  -> judgment frame diff
  -> external refs + transition metadata
  -> AIMD-C compute/view
  -> KaTeX
  -> browser transition
```

AIMD-C remains the formula/expression runtime. Dynamic Logic only supplies
validated external values and read-only presentation metadata saying whether a
ref changed in this frame.

## Browser behavior

- `▶ Play` auto-advances one real evidence step at a time.
- `⏸ Pause` freezes the selected historical projection.
- `←` / `→` remain deterministic manual replay.
- `Live` clears the replay cursor and follows the latest evidence stream.
- Reaching the final replay step also normalizes to true Live mode; a later
  appended evidence event is therefore included automatically.
- Playback stops if the source document disappears from view or if editing
  changes the evidence count mid-session. It never mixes two event sequences.
- Evidence cards outside the selected prefix remain visible but de-emphasized;
  the newly reached card gets one arrival transition.
- Judgment state transitions pulse once and show the actual state/delta summary.
- Support/counterpressure/completeness show one-frame metric deltas.
- AIMD-C formula/number views sourced from a changed Dynamic Logic external ref
  animate once and display the numeric delta when available.
- Inline `{{ judgment.field }}` references briefly highlight when changed.
- `prefers-reduced-motion` disables the CSS motion while keeping every state and
  delta visible.

## Intentional boundary

This is **replay-driven dynamic rendering**, not yet a continuously connected
external evidence stream. The next runtime increment may append events from an
external sidecar / research agent, but the same browser transition layer can
render those events without changing the semantic contract.

## Verification

```bash
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
npm run build
```

Browser regression target: `examples/dynamic-logic-demo.md`.
