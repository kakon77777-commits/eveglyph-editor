// ─── DYNAMIC LOGIC DOCUMENT RUNTIME ────────────────────────────────────────
// Builds a deterministic event sequence from document-declared claim/evidence
// blocks, reduces it, and exposes flat refs so existing AIMD-C blocks can read
// dynamic judgment values (e.g. @weather-judge.support).
import { DYNAMIC_LOGIC_RUNTIME_VERSION, canonicalJudgmentState, initialJudgmentState, reduceJudgment } from './reducer.js'
import { getReplayCursor } from './replay.js'

const round = (n) => n === null || n === undefined ? null : Math.round(n * 10000) / 10000

function makeEvent(sequence, type, claimId, payload = {}) {
  return { sequence, type, claim_id: claimId, payload, runtime_version: DYNAMIC_LOGIC_RUNTIME_VERSION }
}

function sortedEvidence(blocks, claimId) {
  return blocks
    .map((block, sourceIndex) => ({ block, sourceIndex }))
    .filter(x => x.block.kind === 'dl-evidence' && x.block.claim === claimId)
    .sort((a, b) => {
      const as = a.block.sequence ?? a.sourceIndex
      const bs = b.block.sequence ?? b.sourceIndex
      return as - bs || a.sourceIndex - b.sourceIndex
    })
    .map(x => x.block)
}

function shouldReopen(before, after, policy) {
  if (!['provisionally_true', 'provisionally_false'].includes(before.state)) return false
  if (before.support_score === null || after.support_score === null) return false
  // A closed state must reopen if it no longer satisfies the policy that
  // justified its closure, even when several individually-small evidence
  // updates drift across the threshold without any one update exceeding rho.
  if (before.state === 'provisionally_true' && after.support_score < policy.supportThreshold) return true
  if (before.state === 'provisionally_false' && after.support_score > policy.opposeThreshold) return true
  return Math.abs(after.support_score - before.support_score) >= policy.reopenDelta
}

function shouldCloseTrue(state, policy) {
  return state.evidence_completeness >= 1 &&
    state.support_score !== null && state.support_score >= policy.supportThreshold
}

function shouldCloseFalse(state, policy) {
  return state.evidence_completeness >= 1 &&
    state.support_score !== null && state.support_score <= policy.opposeThreshold
}

function reduceWithHistory(state, event, policy, history) {
  const next = reduceJudgment(state, event, policy)
  history.push({
    sequence: event.sequence,
    type: event.type,
    state: next.state,
    projection_3: next.projection_3,
    support_score: round(next.support_score),
    counterpressure: round(next.counterpressure),
    evidence_completeness: round(next.evidence_completeness),
    label: event.payload?.label || event.payload?.reason || event.payload?.evidence?.label || event.type,
  })
  return next
}

function evaluateJudgment(judgment, blocks, replayKey) {
  const policy = judgment.policy
  const allEvidence = sortedEvidence(blocks, judgment.claim)
  const replayCursor = getReplayCursor(replayKey, allEvidence.length)
  const evidence = allEvidence.slice(0, replayCursor)
  let sequence = 0
  let state = initialJudgmentState(judgment.claim)
  const history = []

  state = reduceWithHistory(state, makeEvent(++sequence, 'CLAIM_CREATED', judgment.claim, { label: 'Claim created' }), policy, history)

  for (const ev of evidence) {
    const before = state
    const added = makeEvent(++sequence, 'EVIDENCE_ADDED', judgment.claim, {
      label: `${ev.direction}: ${ev.label}`,
      evidence: {
        id: ev.id,
        direction: ev.direction,
        source_type: ev.sourceType,
        weight: ev.weight,
        verified: ev.verified,
        label: ev.label,
        source: ev.source,
      },
    })
    state = reduceWithHistory(state, added, policy, history)

    if (shouldReopen(before, state, policy)) {
      state = reduceWithHistory(state, makeEvent(++sequence, 'STATE_REOPENED', judgment.claim, {
        reason: 'Closed judgment no longer satisfies its closure/reopen policy',
      }), policy, history)
    }

    if (['open', 'generating', 'conflicted'].includes(state.state)) {
      if (shouldCloseTrue(state, policy)) {
        state = reduceWithHistory(state, makeEvent(++sequence, 'STATE_CLOSED_TRUE', judgment.claim, {
          reason: 'Support closure policy satisfied',
        }), policy, history)
      } else if (shouldCloseFalse(state, policy)) {
        state = reduceWithHistory(state, makeEvent(++sequence, 'STATE_CLOSED_FALSE', judgment.claim, {
          reason: 'Oppose closure policy satisfied',
        }), policy, history)
      }
    }
  }

  return { state, history, policy, replayCursor, evidenceCount: allEvidence.length, replayKey }
}

function exposeRefs(refs, judgmentId, result) {
  const s = result.state
  refs[`${judgmentId}.state`] = s.state
  refs[`${judgmentId}.projection`] = s.projection_3
  refs[`${judgmentId}.support`] = round(s.support_score)
  refs[`${judgmentId}.counterpressure`] = round(s.counterpressure)
  refs[`${judgmentId}.completeness`] = round(s.evidence_completeness)
  refs[`${judgmentId}.event_cursor`] = s.event_cursor
  refs[`${judgmentId}.evidence_cursor`] = result.replayCursor
  refs[`${judgmentId}.evidence_count`] = result.evidenceCount
}

export function evaluateDynamicDocument(blocks, replayNamespace = '') {
  const byId = new Map()
  const results = new Map()
  const historyByClaim = new Map()
  const replayKeysByClaim = new Map()
  const issues = []
  const refs = {}
  const replayKeyForClaim = (claimId) => replayNamespace ? `${replayNamespace}::${claimId}` : claimId

  for (const b of blocks) {
    if (b.id) {
      if (byId.has(b.id)) issues.push({ id: b.id, message: `duplicate dynamic-logic id "${b.id}"` })
      else byId.set(b.id, b)
    }
    if (b.kind === 'dl-error') issues.push({ id: b.id, message: b.message })
  }

  const claims = new Map(blocks.filter(b => b.kind === 'dl-claim').map(b => [b.id, b]))
  for (const e of blocks.filter(b => b.kind === 'dl-evidence')) {
    if (!claims.has(e.claim)) issues.push({ id: e.id, message: `evidence "${e.id}" refers to missing claim "${e.claim}"` })
  }

  const seenJudgmentClaims = new Set()
  for (const j of blocks.filter(b => b.kind === 'dl-judgment')) {
    if (!claims.has(j.claim)) {
      issues.push({ id: j.id, message: `judgment "${j.id}" refers to missing claim "${j.claim}"` })
      continue
    }
    if (seenJudgmentClaims.has(j.claim)) {
      issues.push({ id: j.id, message: `MVP supports one judgment policy per claim; duplicate judgment for "${j.claim}"` })
      continue
    }
    seenJudgmentClaims.add(j.claim)
    try {
      const replayKey = replayKeyForClaim(j.claim)
      const result = evaluateJudgment(j, blocks, replayKey)
      results.set(j.id, result)
      historyByClaim.set(j.claim, result.history)
      replayKeysByClaim.set(j.claim, replayKey)
      exposeRefs(refs, j.id, result)
    } catch (e) {
      issues.push({ id: j.id, message: e?.message || String(e) })
    }
  }

  for (const c of claims.values()) refs[`${c.id}.statement`] = c.statement

  return { byId, results, historyByClaim, replayKeysByClaim, issues, refs, blocks, replayNamespace }
}

export function canonicalDynamicDocument(doc) {
  const judgments = {}
  for (const [id, result] of doc.results) judgments[id] = canonicalJudgmentState(result.state)
  return { judgments, issues: doc.issues.map(i => ({ ...i })) }
}
