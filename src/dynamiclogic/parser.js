// ─── DYNAMIC LOGIC BLOCK PARSER ────────────────────────────────────────────
// Parses the first MVP block kinds layered above AIMD-C. These blocks do not
// evaluate arithmetic themselves; they describe claims, evidence, judgment
// policy, and history views. Formula computation stays in AIMD-C.
import jsYaml from 'js-yaml'
import { parseAttrs } from '../aimdc/parser.js'

const TYPES = new Set(['aimd-claim', 'aimd-evidence', 'aimd-judgment', 'aimd-history'])
const SOURCE_TYPES = new Set(['observation', 'document', 'derived', 'inference'])

const num = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  return String(value).toLowerCase() === 'true'
}

function unitInterval(value, label) {
  if (!(value >= 0 && value <= 1)) throw new Error(`${label} must be between 0 and 1`)
  return value
}

function yamlObject(body, label) {
  const raw = body.trim()
  if (!raw) return {}
  let parsed
  try { parsed = jsYaml.load(raw) } catch (e) { throw new Error(`${label}: ${e.message}`) }
  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  return { value: parsed }
}

function claim(attrs, body) {
  if (!attrs.id) throw new Error('aimd-claim is missing a required id="..." attribute')
  const data = yamlObject(body, `aimd-claim "${attrs.id}"`)
  const statement = String(data.statement ?? data.value ?? body.trim()).trim()
  if (!statement) throw new Error(`aimd-claim "${attrs.id}" has no statement`)
  return { kind: 'dl-claim', id: attrs.id, statement, scope: data.scope || {} }
}

function evidence(attrs, body) {
  if (!attrs.id) throw new Error('aimd-evidence is missing a required id="..." attribute')
  if (!attrs.claim) throw new Error(`aimd-evidence "${attrs.id}" is missing claim="@..."`)
  const data = yamlObject(body, `aimd-evidence "${attrs.id}"`)
  const direction = String(attrs.direction || data.direction || '').toLowerCase()
  if (!['support', 'oppose', 'neutral', 'unresolved'].includes(direction)) {
    throw new Error(`aimd-evidence "${attrs.id}" has invalid direction "${direction}"`)
  }
  const sourceType = String(attrs['source-type'] || data.source_type || '').toLowerCase()
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new Error(`aimd-evidence "${attrs.id}" requires source_type: observation|document|derived|inference`)
  }
  const weight = num(attrs.weight ?? data.weight, 1)
  if (!(weight >= 0)) throw new Error(`aimd-evidence "${attrs.id}" weight must be >= 0`)
  const sequence = num(attrs.sequence ?? data.sequence, null)
  if (sequence !== null && (!Number.isInteger(sequence) || sequence < 0)) {
    throw new Error(`aimd-evidence "${attrs.id}" sequence must be a non-negative integer`)
  }
  return {
    kind: 'dl-evidence',
    id: attrs.id,
    claim: attrs.claim.replace(/^@/, ''),
    direction,
    sourceType,
    weight,
    // Fail closed: evidence is unverified unless the source explicitly says otherwise.
    verified: bool(attrs.verified ?? data.verified, false),
    sequence,
    label: String(data.label || data.source || attrs.label || attrs.id),
    source: data.source || null,
  }
}

function judgment(attrs, body) {
  if (!attrs.id) throw new Error('aimd-judgment is missing a required id="..." attribute')
  if (!attrs.claim) throw new Error(`aimd-judgment "${attrs.id}" is missing claim="@..."`)
  const data = yamlObject(body, `aimd-judgment "${attrs.id}"`)
  const supportThreshold = unitInterval(num(data.support_threshold ?? attrs['support-threshold'], 0.8), 'support_threshold')
  const opposeThreshold = unitInterval(num(data.oppose_threshold ?? attrs['oppose-threshold'], 0.2), 'oppose_threshold')
  const reopenDelta = unitInterval(num(data.reopen_delta ?? attrs['reopen-delta'], 0.2), 'reopen_delta')
  if (opposeThreshold > supportThreshold) throw new Error('oppose_threshold cannot exceed support_threshold')
  return {
    kind: 'dl-judgment',
    id: attrs.id,
    claim: attrs.claim.replace(/^@/, ''),
    policy: {
      supportThreshold,
      opposeThreshold,
      minEvidenceCount: Math.max(1, Math.trunc(num(data.min_evidence_count ?? attrs['min-evidence-count'], 2))),
      reopenDelta,
    },
  }
}

function history(attrs) {
  if (!attrs.claim) throw new Error('aimd-history is missing a required claim="@..." attribute')
  return { kind: 'dl-history', id: attrs.id || null, claim: attrs.claim.replace(/^@/, '') }
}

const PARSERS = {
  'aimd-claim': claim,
  'aimd-evidence': evidence,
  'aimd-judgment': judgment,
  'aimd-history': history,
}

export function isDynamicLogicType(type) {
  return TYPES.has(String(type).toLowerCase())
}

export function parseDynamicLogicBlock(type, rest, body) {
  const attrs = parseAttrs(rest)
  const parse = PARSERS[String(type).toLowerCase()]
  try {
    return parse(attrs, body)
  } catch (e) {
    return { kind: 'dl-error', id: attrs.id || null, message: e?.message || String(e) }
  }
}
