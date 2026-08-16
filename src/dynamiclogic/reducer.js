// ─── DYNAMIC LOGIC DETERMINISTIC REDUCER ──────────────────────────────────
// Event -> state semantics only. No LLM calls, no DOM, no disk effects.
// Runtime generation may be stochastic, but only validated committed events
// reach this reducer; replaying the same event sequence must reproduce the
// same canonical state for this reducer version.

export const DYNAMIC_LOGIC_RUNTIME_VERSION = '0.1.0'

export function initialJudgmentState(claimId) {
  return {
    claim_id: claimId,
    state: 'open',
    projection_3: 'omega',
    runtime_status: 'ok',
    event_cursor: 0,
    evidence: [],
    support_score: null,
    counterpressure: null,
    evidence_completeness: 0,
    closure_reason: null,
  }
}

function projection3(state) {
  if (state === 'provisionally_true') return 'true'
  if (state === 'provisionally_false') return 'false'
  return 'omega'
}

function metrics(evidence, policy) {
  const usable = evidence.filter(e => e.verified !== false)
  let support = 0
  let oppose = 0
  for (const e of usable) {
    if (e.direction === 'support') support += e.weight
    if (e.direction === 'oppose') oppose += e.weight
  }
  const directional = support + oppose
  return {
    support_score: directional > 0 ? support / directional : null,
    counterpressure: directional > 0 ? oppose / directional : null,
    evidence_completeness: Math.min(1, usable.length / Math.max(1, policy.minEvidenceCount)),
  }
}

export function reduceJudgment(previous, event, policy) {
  if (!event || typeof event !== 'object') throw new Error('event must be an object')
  if (!Number.isInteger(event.sequence) || event.sequence !== previous.event_cursor + 1) {
    throw new Error(`expected event sequence ${previous.event_cursor + 1}, got ${event.sequence}`)
  }
  if (previous.claim_id && event.claim_id !== previous.claim_id) throw new Error('claim mismatch')

  const next = {
    ...previous,
    event_cursor: event.sequence,
    evidence: [...previous.evidence],
  }

  switch (event.type) {
    case 'CLAIM_CREATED':
      next.state = 'open'
      next.closure_reason = null
      break

    case 'EVIDENCE_ADDED': {
      const ev = event.payload?.evidence
      if (!ev) throw new Error('EVIDENCE_ADDED is missing payload.evidence')
      next.evidence.push(ev)
      Object.assign(next, metrics(next.evidence, policy))
      if (previous.state === 'open') next.state = 'generating'
      // A closed state stays closed until an explicit STATE_REOPENED event.
      break
    }

    case 'EVIDENCE_INVALIDATED':
      next.evidence = next.evidence.filter(e => e.id !== event.payload?.evidence_id)
      Object.assign(next, metrics(next.evidence, policy))
      break

    case 'STATE_CLOSED_TRUE':
      if (!['open', 'generating', 'conflicted'].includes(previous.state)) {
        throw new Error(`cannot close true from ${previous.state}`)
      }
      next.state = 'provisionally_true'
      next.closure_reason = event.payload?.reason || null
      break

    case 'STATE_CLOSED_FALSE':
      if (!['open', 'generating', 'conflicted'].includes(previous.state)) {
        throw new Error(`cannot close false from ${previous.state}`)
      }
      next.state = 'provisionally_false'
      next.closure_reason = event.payload?.reason || null
      break

    case 'STATE_REOPENED':
      if (!['provisionally_true', 'provisionally_false'].includes(previous.state)) {
        throw new Error(`cannot reopen from ${previous.state}`)
      }
      next.state = 'generating'
      next.closure_reason = null
      break

    case 'STATE_CONFLICTED':
      if (!['open', 'generating', 'conflicted'].includes(previous.state)) {
        throw new Error(`cannot mark conflicted from ${previous.state}`)
      }
      next.state = 'conflicted'
      next.closure_reason = null
      break

    case 'RUNTIME_FAILED':
      next.runtime_status = 'error'
      // Runtime failure never overwrites epistemic judgment state.
      break

    default:
      throw new Error(`unsupported dynamic-logic event type "${event.type}"`)
  }

  next.projection_3 = projection3(next.state)
  return next
}

export function canonicalJudgmentState(state) {
  return {
    claim_id: state.claim_id,
    state: state.state,
    projection_3: state.projection_3,
    runtime_status: state.runtime_status,
    event_cursor: state.event_cursor,
    evidence_ids: state.evidence.map(e => e.id),
    support_score: state.support_score,
    counterpressure: state.counterpressure,
    evidence_completeness: state.evidence_completeness,
    closure_reason: state.closure_reason,
  }
}
