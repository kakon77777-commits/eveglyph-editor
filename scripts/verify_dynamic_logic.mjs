import assert from 'node:assert/strict'
import { evaluateDynamicDocument } from '../src/dynamiclogic/runtime.js'
import { clearReplayCursor, setReplayCursor } from '../src/dynamiclogic/replay.js'
import { initialJudgmentState, reduceJudgment } from '../src/dynamiclogic/reducer.js'
import { parseDynamicLogicBlock } from '../src/dynamiclogic/parser.js'
import { resolveRef } from '../src/aimdc/graph.js'

const blocks = [
  { kind: 'dl-claim', id: 'weather-claim', statement: 'Tomorrow afternoon will be rainy.', scope: {} },
  { kind: 'dl-evidence', id: 'forecast-a', claim: 'weather-claim', direction: 'support', sourceType: 'document', weight: 0.9, verified: true, sequence: 1, label: 'Forecast A', source: null },
  { kind: 'dl-evidence', id: 'forecast-b', claim: 'weather-claim', direction: 'support', sourceType: 'document', weight: 0.8, verified: true, sequence: 2, label: 'Forecast B', source: null },
  { kind: 'dl-evidence', id: 'front-shift', claim: 'weather-claim', direction: 'oppose', sourceType: 'document', weight: 5, verified: true, sequence: 3, label: 'Front shift', source: null },
  { kind: 'dl-evidence', id: 'radar-update', claim: 'weather-claim', direction: 'oppose', sourceType: 'document', weight: 5, verified: true, sequence: 4, label: 'Radar update', source: null },
  {
    kind: 'dl-judgment',
    id: 'weather-judge',
    claim: 'weather-claim',
    policy: { supportThreshold: 0.8, opposeThreshold: 0.2, minEvidenceCount: 2, reopenDelta: 0.2 },
  },
  { kind: 'dl-history', id: null, claim: 'weather-claim' },
]

function stateAt(cursor) {
  if (cursor === null) clearReplayCursor('weather-claim')
  else setReplayCursor('weather-claim', cursor, 4)
  const doc = evaluateDynamicDocument(blocks)
  assert.equal(doc.issues.length, 0)
  return doc
}

// Parser boundary: source type is mandatory and unverified is the safe default.
const parsedEvidence = parseDynamicLogicBlock(
  'aimd-evidence',
  ' {id="parser-e" claim="@weather-claim" direction="support" weight="1"}',
  'source_type: inference\nlabel: model hypothesis'
)
assert.equal(parsedEvidence.kind, 'dl-evidence')
assert.equal(parsedEvidence.sourceType, 'inference')
assert.equal(parsedEvidence.verified, false)

const rejectedEvidence = parseDynamicLogicBlock(
  'aimd-evidence',
  ' {id="parser-bad" claim="@weather-claim" direction="support"}',
  'label: missing provenance class'
)
assert.equal(rejectedEvidence.kind, 'dl-error')

const rejectedPolicy = parseDynamicLogicBlock(
  'aimd-judgment',
  ' {id="bad-policy" claim="@weather-claim"}',
  'support_threshold: 1.2'
)
assert.equal(rejectedPolicy.kind, 'dl-error')

let doc = stateAt(0)
assert.equal(doc.results.get('weather-judge').state.state, 'open')
assert.equal(doc.refs['weather-judge.projection'], 'omega')

doc = stateAt(1)
assert.equal(doc.results.get('weather-judge').state.state, 'generating')
assert.equal(doc.refs['weather-judge.projection'], 'omega')

doc = stateAt(2)
assert.equal(doc.results.get('weather-judge').state.state, 'provisionally_true')
assert.equal(doc.refs['weather-judge.projection'], 'true')
assert.equal(doc.refs['weather-judge.support'], 1)

doc = stateAt(3)
assert.equal(doc.results.get('weather-judge').state.state, 'generating')
assert.equal(doc.refs['weather-judge.projection'], 'omega')
assert.ok(doc.results.get('weather-judge').history.some(e => e.type === 'STATE_REOPENED'))

doc = stateAt(4)
assert.equal(doc.results.get('weather-judge').state.state, 'provisionally_false')
assert.equal(doc.refs['weather-judge.projection'], 'false')
assert.ok(doc.results.get('weather-judge').history.some(e => e.type === 'STATE_CLOSED_FALSE'))

// Existing AIMD-C resolver can read the Dynamic Logic runtime namespace.
assert.equal(resolveRef('weather-judge.support', new Map(), new Map(), doc.refs), doc.refs['weather-judge.support'])

// Same local claim id in two files must not share the UI replay cursor.
setReplayCursor('doc-a.md::weather-claim', 2, 4)
const docA = evaluateDynamicDocument(blocks, 'doc-a.md')
const docB = evaluateDynamicDocument(blocks, 'doc-b.md')
assert.equal(docA.results.get('weather-judge').state.state, 'provisionally_true')
assert.equal(docB.results.get('weather-judge').state.state, 'provisionally_false')
clearReplayCursor('doc-a.md::weather-claim')

// Runtime failure is orthogonal to epistemic state: ERROR must not become false by mutation.
const policy = { supportThreshold: 0.8, opposeThreshold: 0.2, minEvidenceCount: 2, reopenDelta: 0.2 }
let errorState = initialJudgmentState('error-claim')
errorState = reduceJudgment(errorState, { sequence: 1, type: 'CLAIM_CREATED', claim_id: 'error-claim', payload: {} }, policy)
errorState = reduceJudgment(errorState, { sequence: 2, type: 'RUNTIME_FAILED', claim_id: 'error-claim', payload: {} }, policy)
assert.equal(errorState.runtime_status, 'error')
assert.equal(errorState.state, 'open')
assert.equal(errorState.projection_3, 'omega')

clearReplayCursor('weather-claim')
console.log('Dynamic Logic MVP verification: OK')
