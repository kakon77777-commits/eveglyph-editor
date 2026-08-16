// ─── DYNAMIC LOGIC MOTION FRAMES ───────────────────────────────────────────
// Browser-rendering metadata only. A frame records the last *rendered*
// judgment projection for a document-scoped replay key; it never changes the
// reducer, evidence set, replay cursor, Markdown buffer, or disk state.
//
// The renderer uses these diffs to animate only real state/value changes. No
// event -> no motion. This is intentionally not a requestAnimationFrame loop.

const frames = new Map()

const numberDelta = (before, after) => {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null
  return Math.round((after - before) * 10000) / 10000
}

function snapshot(result) {
  const s = result.state
  return {
    state: s.state,
    projection: s.projection_3,
    support: s.support_score,
    counterpressure: s.counterpressure,
    completeness: s.evidence_completeness,
    evidenceCursor: result.replayCursor,
    eventCursor: s.event_cursor,
  }
}

function frameKey(judgmentId, result) {
  return `${result.replayKey || 'document'}::judgment:${judgmentId}`
}

function diffFrame(previous, current) {
  if (!previous) {
    return {
      changed: false,
      firstFrame: true,
      stateChanged: false,
      projectionChanged: false,
      cursorDelta: 0,
      supportDelta: null,
      counterpressureDelta: null,
      completenessDelta: null,
      previous: null,
      current,
    }
  }

  const supportDelta = numberDelta(previous.support, current.support)
  const counterpressureDelta = numberDelta(previous.counterpressure, current.counterpressure)
  const completenessDelta = numberDelta(previous.completeness, current.completeness)
  const stateChanged = previous.state !== current.state
  const projectionChanged = previous.projection !== current.projection
  const cursorDelta = current.evidenceCursor - previous.evidenceCursor
  const changed = stateChanged || projectionChanged || cursorDelta !== 0 ||
    supportDelta !== 0 || counterpressureDelta !== 0 || completenessDelta !== 0

  return {
    changed,
    firstFrame: false,
    stateChanged,
    projectionChanged,
    cursorDelta,
    supportDelta,
    counterpressureDelta,
    completenessDelta,
    previous,
    current,
  }
}

export function annotateDynamicMotion(doc) {
  const motionByJudgment = new Map()
  const refTransitions = {}

  for (const [judgmentId, result] of doc.results) {
    const key = frameKey(judgmentId, result)
    const current = snapshot(result)
    const previous = frames.get(key) || null
    const motion = diffFrame(previous, current)
    motionByJudgment.set(judgmentId, motion)

    const fields = [
      ['support', 'support', motion.supportDelta],
      ['counterpressure', 'counterpressure', motion.counterpressureDelta],
      ['completeness', 'completeness', motion.completenessDelta],
      ['state', 'state', null],
      ['projection', 'projection', null],
    ]
    for (const [refField, frameField, delta] of fields) {
      const from = previous?.[frameField]
      const to = current[frameField]
      refTransitions[`${judgmentId}.${refField}`] = {
        changed: previous !== null && from !== to,
        from: previous === null ? null : from,
        to,
        delta,
      }
    }

    frames.set(key, current)
  }

  return { ...doc, motionByJudgment, refTransitions }
}

export function clearDynamicMotion(replayKeyPrefix = '') {
  if (!replayKeyPrefix) {
    frames.clear()
    return
  }
  for (const key of frames.keys()) {
    if (key.startsWith(replayKeyPrefix)) frames.delete(key)
  }
}
