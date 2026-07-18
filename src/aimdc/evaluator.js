// ─── AIMD-C expression evaluator (roadmap Phase 3, AIMD-C v0.1) ────────────
// Per Decision 2 (roadmap v0.6): the shipped Tier 1 formula evaluator
// (vite-agent-bridge.js — hand-rolled tokenizer + recursive-descent parser,
// no eval/Function, closed grammar) is the seed this builds on, not a
// rewrite target. Same arithmetic/comparison/boolean core; extended here
// with named-variable resolution (Tier 1 only ever resolved `pi`/`e`) and a
// `name := expr` assignment form, since AIMD-C functions need both. Runs
// client-side (Tier 1 required a server round-trip per click — AIMD-C needs
// to re-evaluate live as the document is edited, like the rest of the
// preview pipeline already does).
//
// v0.1 scope, deliberately: arithmetic, comparisons, and/or/not, IF — the
// same operator set Tier 1 already has, plus variables. NOT included yet:
// map/filter/reduce or any List/Table-valued expression body (whitepaper
// §18.1 lists these as MVP-scope, but every worked example in the AIMD-C
// whitepaper — circle-area, yoy-growth — is pure Number arithmetic; scoping
// to what the actual examples need, not the full future grammar, keeps this
// an honest, testable slice rather than a half-finished bigger one).

const AIMD_CONSTANTS = { pi: Math.PI, e: Math.E }

const AIMD_FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp,
  power: (x, y) => Math.pow(x, y),
  mod: (x, y) => x % y,
  round: (x, digits = 0) => { const f = Math.pow(10, digits); return Math.round(x * f) / f },
  pi: () => Math.PI,
}

// Longest-match-first so `<=`/`>=`/`<>`/`:=` aren't sliced. `@[\w.-]+` is a
// single reference token (`@result.area`, `@circle-area`) — used by
// aimd-assert expressions and aimd-compute binding right-hand sides, never
// inside a function body (a function's own `input` names are always plain
// local identifiers). Block ids are commonly kebab-case (the whitepaper's
// own examples: circle-area, yoy-growth) so hyphens are part of the ref
// token, not treated as subtraction — `@radius - 1` (spaced) still splits
// into ref + minus + literal since the greedy match stops at whitespace;
// `@radius-1` (unspaced) reads as one ref path, same ambiguity most
// languages punt on by requiring a space around a binary operator.
const TOKEN_RE = /\s*(:=|<>|>=|<=|=|<|>|[+\-*/^(),]|@[A-Za-z_][\w.-]*|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\.\d+)/y

export function tokenize(src) {
  const toks = []
  let i = 0
  while (i < src.length) {
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(src)
    if (!m || m[0].length === 0) {
      if (/\s/.test(src[i])) { i++; continue }
      throw new Error(`unrecognized character at position ${i}: "${src[i]}"`)
    }
    toks.push(m[1])
    i += m[0].length
  }
  return toks
}

const COMPARE_OPS = new Set(['=', '<>', '>', '<', '>=', '<='])

// A bare expression, e.g. "pi * r^2" or "@result.area > 0".
export function parseExpression(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseCompare() {
    const lhs = parseAdd()
    if (COMPARE_OPS.has(peek())) { const op = next(); return { op, lhs, rhs: parseAdd() } }
    return lhs
  }
  function parseAdd() {
    let node = parseMul()
    while (peek() === '+' || peek() === '-') { const op = next(); node = { op, lhs: node, rhs: parseMul() } }
    return node
  }
  function parseMul() {
    let node = parsePow()
    while (peek() === '*' || peek() === '/') { const op = next(); node = { op, lhs: node, rhs: parsePow() } }
    return node
  }
  function parsePow() {
    const node = parseUnary()
    if (peek() === '^') { next(); return { op: '^', lhs: node, rhs: parsePow() } }
    return node
  }
  function parseUnary() {
    if (peek() === '-') { next(); return { op: 'neg', arg: parseUnary() } }
    return parsePrimary()
  }
  function parsePrimary() {
    const t = next()
    if (t === undefined) throw new Error('unexpected end of expression')
    if (t === '(') {
      const node = parseCompare()
      if (next() !== ')') throw new Error('expected ")"')
      return node
    }
    if (/^\d/.test(t) || t.startsWith('.')) return { op: 'num', value: Number(t) }
    if (t.startsWith('@')) return { op: 'ref', path: t.slice(1) }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        next()
        const args = []
        if (peek() !== ')') {
          args.push(parseCompare())
          while (peek() === ',') { next(); args.push(parseCompare()) }
        }
        if (next() !== ')') throw new Error('expected ")"')
        return { op: 'call', name: t.toLowerCase(), args }
      }
      return { op: 'ident', name: t.toLowerCase() }
    }
    throw new Error(`unexpected token "${t}"`)
  }

  const tree = parseCompare()
  if (pos !== tokens.length) throw new Error(`unexpected trailing token "${tokens[pos]}"`)
  return tree
}

// `name := expr` — a function body's single assignment line, or an
// aimd-compute binding line's right-hand side reuses parseExpression alone.
export function parseAssignment(tokens) {
  if (tokens[1] !== ':=') throw new Error('expected "name := expression"')
  const name = tokens[0].toLowerCase()
  return { name, expr: parseExpression(tokens.slice(2)) }
}

const toNum  = (v) => typeof v === 'boolean' ? (v ? 1 : 0) : v
const toBool = (v) => typeof v === 'boolean' ? v : (Number.isFinite(v) && v !== 0)

// `env`: plain-name lookups (function parameters) map directly; `@`-prefixed
// dotted paths (`result.area`) resolve via `env.refs` — a flat
// `{ "result.area": value }` map the caller pre-resolves from the
// dependency graph before evaluating (graph.js's job, not this module's).
export function evaluate(node, env = {}) {
  switch (node.op) {
    case 'num': return node.value
    case 'ident': {
      if (node.name in env) return env[node.name]
      if (node.name in AIMD_CONSTANTS) return AIMD_CONSTANTS[node.name]
      throw new Error(`unbound identifier "${node.name}"`)
    }
    case 'ref': {
      const refs = env.refs || {}
      if (!(node.path in refs)) throw new Error(`unresolved reference "@${node.path}"`)
      return refs[node.path]
    }
    case 'neg': return -toNum(evaluate(node.arg, env))
    case '+': return toNum(evaluate(node.lhs, env)) + toNum(evaluate(node.rhs, env))
    case '-': return toNum(evaluate(node.lhs, env)) - toNum(evaluate(node.rhs, env))
    case '*': return toNum(evaluate(node.lhs, env)) * toNum(evaluate(node.rhs, env))
    case '/': return toNum(evaluate(node.lhs, env)) / toNum(evaluate(node.rhs, env))
    case '^': return Math.pow(toNum(evaluate(node.lhs, env)), toNum(evaluate(node.rhs, env)))
    case '=': case '<>': {
      const lhs = toNum(evaluate(node.lhs, env)), rhs = toNum(evaluate(node.rhs, env))
      const scale = Math.max(1, Math.abs(lhs), Math.abs(rhs))
      const eq = Math.abs(lhs - rhs) / scale < 1e-9
      return node.op === '=' ? eq : !eq
    }
    case '>':  return toNum(evaluate(node.lhs, env)) >  toNum(evaluate(node.rhs, env))
    case '<':  return toNum(evaluate(node.lhs, env)) <  toNum(evaluate(node.rhs, env))
    case '>=': return toNum(evaluate(node.lhs, env)) >= toNum(evaluate(node.rhs, env))
    case '<=': return toNum(evaluate(node.lhs, env)) <= toNum(evaluate(node.rhs, env))
    case 'call': return callFunction(node.name, node.args, env)
    default: throw new Error(`internal: unhandled node "${node.op}"`)
  }
}

function callFunction(name, argNodes, env) {
  if (name === 'if') {
    if (argNodes.length !== 3) throw new Error('IF expects exactly 3 arguments: IF(condition, then, else)')
    return toBool(evaluate(argNodes[0], env)) ? evaluate(argNodes[1], env) : evaluate(argNodes[2], env)
  }
  if (name === 'and') return argNodes.every(n => toBool(evaluate(n, env)))
  if (name === 'or')  return argNodes.some(n => toBool(evaluate(n, env)))
  if (name === 'not') {
    if (argNodes.length !== 1) throw new Error('NOT expects exactly 1 argument')
    return !toBool(evaluate(argNodes[0], env))
  }

  const args = argNodes.map(n => toNum(evaluate(n, env)))
  if (name === 'sum')     return args.reduce((a, b) => a + b, 0)
  if (name === 'average') { if (!args.length) throw new Error('AVERAGE needs at least 1 argument'); return args.reduce((a, b) => a + b, 0) / args.length }
  if (name === 'min')     { if (!args.length) throw new Error('MIN needs at least 1 argument'); return Math.min(...args) }
  if (name === 'max')     { if (!args.length) throw new Error('MAX needs at least 1 argument'); return Math.max(...args) }
  if (name === 'count')   return args.length

  const fn = AIMD_FUNCTIONS[name]
  if (!fn) throw new Error(`unknown function "${name.toUpperCase()}"`)
  return fn(...args)
}
