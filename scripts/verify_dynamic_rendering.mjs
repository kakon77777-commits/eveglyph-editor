import assert from 'node:assert/strict'
import { evaluateDynamicDocument } from '../src/dynamiclogic/runtime.js'
import { clearReplayCursor, getReplayCursor, setReplayCursor } from '../src/dynamiclogic/replay.js'
import { annotateDynamicMotion, clearDynamicMotion } from '../src/dynamiclogic/motion.js'
import { isReplayPlaying, startReplayPlayback, stopReplayPlayback } from '../src/dynamiclogic/playback.js'
import { renderBlock as renderAimdBlock, substituteInlineRefs } from '../src/aimdc/render.js'

const namespace = 'render-test'
const claim = 'weather-claim'
const replayKey = `${namespace}::${claim}`

const blocks = [
  { kind: 'dl-claim', id: claim, statement: 'Tomorrow afternoon will be rainy.', scope: {} },
  { kind: 'dl-evidence', id: 'a', claim, direction: 'support', sourceType: 'document', weight: 0.9, verified: true, sequence: 1, label: 'A' },
  { kind: 'dl-evidence', id: 'b', claim, direction: 'support', sourceType: 'document', weight: 0.8, verified: true, sequence: 2, label: 'B' },
  { kind: 'dl-evidence', id: 'c', claim, direction: 'oppose', sourceType: 'document', weight: 5, verified: true, sequence: 3, label: 'C' },
  { kind: 'dl-evidence', id: 'd', claim, direction: 'oppose', sourceType: 'document', weight: 5, verified: true, sequence: 4, label: 'D' },
  {
    kind: 'dl-judgment', id: 'judge', claim,
    policy: { supportThreshold: 0.8, opposeThreshold: 0.2, minEvidenceCount: 2, reopenDelta: 0.2 },
  },
]

function frameAt(cursor) {
  setReplayCursor(replayKey, cursor, 4)
  return annotateDynamicMotion(evaluateDynamicDocument(blocks, namespace))
}

clearDynamicMotion(replayKey)
clearReplayCursor(replayKey)

let doc = frameAt(0)
let motion = doc.motionByJudgment.get('judge')
assert.equal(motion.firstFrame, true)
assert.equal(motion.changed, false)

// Re-rendering an unchanged all-null/open frame must also stay still. This
// guards against treating a non-numeric null delta as if it were a real change.
doc = frameAt(0)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.firstFrame, false)
assert.equal(motion.changed, false)
assert.equal(motion.cursorDelta, 0)

// A real replay-step change creates motion even when the epistemic state remains omega.
doc = frameAt(1)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.changed, true)
assert.equal(motion.cursorDelta, 1)
assert.equal(motion.current.state, 'generating')

// Closure is a state transition and must be marked as such.
doc = frameAt(2)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.stateChanged, true)
assert.equal(motion.previous.state, 'generating')
assert.equal(motion.current.state, 'provisionally_true')

// Counterevidence changes the external support ref and reopens the judgment.
doc = frameAt(3)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.stateChanged, true)
assert.ok(motion.supportDelta < 0)
assert.equal(doc.refTransitions['judge.support'].changed, true)
assert.equal(doc.refTransitions['judge.state'].changed, true)

// AIMD-C remains the formula renderer, but receives a read-only presentation
// transition map so the changed external ref visibly animates and gets a delta.
const aimdDoc = {
  byId: new Map(),
  results: new Map(),
  issues: [],
  externalRefs: doc.refs,
  externalTransitions: doc.refTransitions,
}
const formulaHtml = renderAimdBlock({
  kind: 'view', id: null, source: 'judge.support', renderer: 'formula', config: {}, label: 'S_t',
}, aimdDoc)
assert.match(formulaHtml, /dl-formula-changed/)
assert.match(formulaHtml, /dl-formula-delta/)
assert.match(formulaHtml, /Δ -74\.63 pp/)

const inlineHtml = substituteInlineRefs('support={{ judge.support }}', aimdDoc)
assert.match(inlineHtml, /dl-inline-ref-changed/)
assert.match(inlineHtml, /0\.2537/)

// Re-rendering the same numeric frame must stay still: no fake idle animation.
doc = frameAt(3)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.changed, false)
assert.equal(motion.cursorDelta, 0)

// Setting replay to the current max must normalize to true Live mode. If new
// evidence is appended afterwards, Live follows the new max instead of freezing
// at the old terminal cursor.
setReplayCursor(replayKey, 4, 4)
assert.equal(getReplayCursor(replayKey, 4), 4)
assert.equal(getReplayCursor(replayKey, 5), 5)

// Playback uses event-driven timers and reaches the final evidence cursor.
clearReplayCursor(replayKey)
let refreshes = 0
assert.equal(startReplayPlayback(replayKey, 2, () => { refreshes += 1 }, 150), true)
assert.equal(isReplayPlaying(replayKey), true)
await new Promise(resolve => setTimeout(resolve, 380))
assert.equal(getReplayCursor(replayKey, 2), 2)
assert.equal(isReplayPlaying(replayKey), false)
assert.ok(refreshes >= 3) // start frame + step 1 + final frame
// Final playback position is also true Live: a later longer stream follows it.
assert.equal(getReplayCursor(replayKey, 3), 3)

// In a browser, playback must stop if the source structure changes mid-run.
// Simulate the visible History block reporting a different evidence max.
globalThis.document = {
  querySelectorAll: () => [{ dataset: { dlReplayKey: replayKey, dlMax: '3' } }],
}
clearReplayCursor(replayKey)
refreshes = 0
assert.equal(startReplayPlayback(replayKey, 2, () => { refreshes += 1 }, 150), true)
await new Promise(resolve => setTimeout(resolve, 190))
assert.equal(isReplayPlaying(replayKey), false)
assert.equal(getReplayCursor(replayKey, 2), 0)
assert.equal(refreshes, 1) // initial frame only; no mixed-history refresh
delete globalThis.document

stopReplayPlayback(replayKey)
clearReplayCursor(replayKey)
clearDynamicMotion(replayKey)
console.log('Dynamic Logic browser rendering verification: OK')
