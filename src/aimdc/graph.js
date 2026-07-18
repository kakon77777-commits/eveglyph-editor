// ─── AIMD-C dependency graph + evaluation (roadmap Phase 3, AIMD-C v0.1) ───
// Builds a DAG from a document's aimd-compute/aimd-assert/aimd-view blocks
// (aimd-value/aimd-function are leaves — a value holds a literal, a function
// is a definition, neither depends on anything else in the document),
// detects cycles (whitepaper §9.2: a compute graph must reject cycles, not
// silently loop), and evaluates every block in topological order.
//
// Full re-evaluation on every render, no incremental diffing — matches this
// app's existing "just re-render everything, it's cheap enough" pattern
// (previewUpdate() already re-renders the whole document on every
// keystroke; a document's AIMD-C block count is small enough that a real
// incremental-recompute engine would be solving a problem that doesn't
// exist yet here).
import { evaluate } from './evaluator.js'
import { checkType } from './types.js'
import { ledgerEntry } from './ledger.js'

function collectRefPaths(node, out) {
  if (!node || typeof node !== 'object') return
  if (node.op === 'ref') { out.add(node.path); return }
  for (const k of ['lhs', 'rhs', 'arg']) if (node[k]) collectRefPaths(node[k], out)
  if (node.args) node.args.forEach(n => collectRefPaths(n, out))
}

function resolveRef(path, byId, results) {
  const [id, field] = path.split('.')
  const block = byId.get(id)
  if (!block) throw new Error(`unresolved reference "@${path}" — no block with id "${id}"`)
  if (block.kind === 'value') return block.value
  if (block.kind === 'compute') {
    const r = results.get(id)
    if (!r) throw new Error(`"@${path}" depends on "${id}", which hasn't run yet`)
    if (r.error) throw new Error(`"@${path}" depends on "${id}", which failed: ${r.error}`)
    if (field) {
      if (!(field in r.outputs)) throw new Error(`"${id}" has no output field "${field}"`)
      return r.outputs[field]
    }
    const keys = Object.keys(r.outputs)
    if (keys.length === 1) return r.outputs[keys[0]]
    throw new Error(`"@${id}" has multiple outputs (${keys.join(', ')}) — reference a specific field, e.g. "@${id}.${keys[0]}"`)
  }
  throw new Error(`"@${path}" refers to a "${block.kind}" block, which has no value to reference`)
}

function buildRefEnv(node, byId, results) {
  const paths = new Set()
  collectRefPaths(node, paths)
  const refs = {}
  for (const p of paths) refs[p] = resolveRef(p, byId, results)
  return { refs }
}

function evalCompute(block, functions, byId, results) {
  const fn = functions.get(block.use)
  if (!fn) throw new Error(`uses undefined function "${block.use}"`)
  const env = {}
  for (const bind of block.bindings) {
    const refEnv = buildRefEnv(bind.expr, byId, results)
    env[bind.name] = evaluate(bind.expr, refEnv)
  }
  for (const [name, typeName] of Object.entries(fn.input)) {
    if (!(name in env)) throw new Error(`missing binding for "${name}" (function "${fn.id}" requires it)`)
    checkType(env[name], typeName, `${fn.id}.${name}`)
  }
  const value = evaluate(fn.assignment.expr, env)
  const outputType = fn.output[fn.assignment.name]
  if (outputType) checkType(value, outputType, `${fn.id}.${fn.assignment.name}`)
  const outputs = { [fn.assignment.name]: value }
  return { outputs, ledger: ledgerEntry(block, env, outputs) }
}

function evalAssert(block, byId, results) {
  const refEnv = buildRefEnv(block.expr, byId, results)
  const value = evaluate(block.expr, refEnv)
  if (typeof value !== 'boolean') throw new Error(`assertion did not evaluate to a boolean (got ${typeof value})`)
  return { passed: value, ledger: ledgerEntry(block, refEnv.refs, { passed: value }) }
}

// Returns { byId, results, issues, ledger }. `results` maps block id →
// { outputs } | { passed } | { error }. `issues` is a flat list of
// { id, message } for the diagnostics panel — a circular reference or a
// failed evaluation, never thrown, matching this app's "diagnose, don't
// crash" posture elsewhere (Phase 1's math diagnostics, World IR's validator).
export function evaluateDocument(blocks) {
  const byId = new Map()
  for (const b of blocks) if (b.id) byId.set(b.id, b)
  const functions = new Map()
  for (const b of blocks) if (b.kind === 'function') functions.set(b.id, b)

  const deps = new Map()
  for (const b of blocks) {
    if (!b.id) continue
    const set = new Set()
    if (b.kind === 'compute') for (const bind of b.bindings) { const p = new Set(); collectRefPaths(bind.expr, p); for (const path of p) set.add(path.split('.')[0]) }
    if (b.kind === 'assert') { const p = new Set(); collectRefPaths(b.expr, p); for (const path of p) set.add(path.split('.')[0]) }
    if (b.kind === 'view' && b.source) set.add(b.source.split('.')[0])
    deps.set(b.id, set)
  }

  const order = []
  const state = new Map()
  const issues = []
  function visit(id, path) {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      // Mark every node actually IN the cycle, not just the one where the
      // DFS happened to detect the back-edge — otherwise only one member of
      // a multi-node cycle gets flagged and the rest fall through to a
      // confusing secondary "hasn't run yet" error instead of the real cause.
      const cycleStart = path.indexOf(id)
      const cycleMembers = path.slice(cycleStart)
      const message = `circular reference: ${[...cycleMembers, id].join(' → ')}`
      for (const member of cycleMembers) issues.push({ id: member, message })
      return
    }
    if (!byId.has(id)) return
    state.set(id, 'visiting')
    for (const dep of deps.get(id) || []) visit(dep, [...path, id])
    state.set(id, 'done')
    order.push(id)
  }
  for (const b of blocks) if (b.id && b.kind !== 'function' && b.kind !== 'value') visit(b.id, [])

  const results = new Map()
  const ledger = []
  // A block that failed to parse (malformed syntax, caught in parser.js)
  // surfaces here too, not just cycle members — same "diagnose, don't
  // silently drop" posture as everything else.
  for (const b of blocks) if (b.kind === 'error' && b.id) issues.push({ id: b.id, message: b.message })
  const circularIds = new Set(issues.map(i => i.id))
  for (const id of order) {
    if (circularIds.has(id)) continue
    const b = byId.get(id)
    if (!b || b.kind === 'view' || b.kind === 'table' || b.kind === 'error') continue
    try {
      if (b.kind === 'compute') {
        const { outputs, ledger: entry } = evalCompute(b, functions, byId, results)
        results.set(id, { outputs })
        ledger.push(entry)
      } else if (b.kind === 'assert') {
        const { passed, ledger: entry } = evalAssert(b, byId, results)
        results.set(id, { passed })
        ledger.push(entry)
      }
    } catch (e) {
      const message = e?.message || String(e)
      results.set(id, { error: message })
      issues.push({ id, message })
    }
  }

  return { byId, results, issues, ledger }
}

export { resolveRef }
