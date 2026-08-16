import assert from 'node:assert/strict'
import { evaluateDynamicDocument } from '../src/dynamiclogic/runtime.js'
import { clearReplayCursor, getReplayCursor, setReplayCursor } from '../src/dynamiclogic/replay.js'
import { annotateDynamicMotion, clearDynamicMotion } from '../src/dynamiclogic/motion.js'
import { isReplayPlaying, startReplayPlayback, stopReplayPlayback } from '../src/dynamiclogic/playback.js'

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

// Re-rendering the same numeric frame must stay still: no fake idle animation.
doc = frameAt(3)
motion = doc.motionByJudgment.get('judge')
assert.equal(motion.changed, false)
assert.equal(motion.cursorDelta, 0)

// Playback uses event-driven timers and reaches the final evidence cursor.
clearReplayCursor(replayKey)
let refreshes = 0
assert.equal(startReplayPlayback(replayKey, 2, () => { refreshes += 1 }, 150), true)
assert.equal(isReplayPlaying(replayKey), true)
await new Promise(resolve => setTimeout(resolve, 380))
assert.equal(getReplayCursor(replayKey, 2), 2)
assert.equal(isReplayPlaying(replayKey), false)
assert.ok(refreshes >= 3) // start frame + step 1 + final frame

stopReplayPlayback(replayKey)
clearReplayCursor(replayKey)
clearDynamicMotion(replayKey)
console.log('Dynamic Logic browser rendering verification: OK')
