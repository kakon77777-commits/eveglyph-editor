// ─── AIMD-C type system (roadmap Phase 3, AIMD-C v0.1) ─────────────────────
// MVP type set per whitepaper §5.1: Number, Boolean, String, List<T>, Table.
// Checking here is dynamic — verified at bind/evaluate time against real
// runtime values — not static inference over the expression grammar. A real
// static type checker for the expression language is a bigger undertaking
// than this phase's scope; this still satisfies the whitepaper's actual
// requirement (§5.3: "在執行前，Runtime 必須確認 Γ⊢e:τ" — reject before
// running with a real TypeError, not silently coerce) through a simpler
// mechanism that's honest about not being full static analysis.

const LIST_RE = /^List<(\w+)>$/

export function parseTypeName(raw) {
  const s = String(raw || '').trim()
  const m = LIST_RE.exec(s)
  if (m) return { kind: 'List', of: m[1] }
  return { kind: s }
}

export function typeOfValue(v) {
  if (typeof v === 'number') return { kind: 'Number' }
  if (typeof v === 'boolean') return { kind: 'Boolean' }
  if (typeof v === 'string') return { kind: 'String' }
  if (Array.isArray(v)) {
    if (v.length && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) return { kind: 'Table' }
    const of = v.length ? typeOfValue(v[0]).kind : 'Number'
    return { kind: 'List', of }
  }
  if (v && typeof v === 'object') return { kind: 'Table' }
  return { kind: 'Unknown' }
}

export function typeLabel(t) {
  return t.kind === 'List' ? `List<${t.of}>` : t.kind
}

// Throws a TypeError-shaped Error (matches the whitepaper's own §5.3 example
// message format) when `value`'s runtime type doesn't match `expectedRaw`.
export function checkType(value, expectedRaw, context) {
  const expected = parseTypeName(expectedRaw)
  const actual = typeOfValue(value)
  if (expected.kind === 'List') {
    if (actual.kind !== 'List') throw new Error(`TypeError: ${context} expected ${typeLabel(expected)}, received ${typeLabel(actual)}.`)
    return
  }
  if (expected.kind !== actual.kind) {
    throw new Error(`TypeError: ${context} expected ${expected.kind}, received ${typeLabel(actual)}.`)
  }
}
