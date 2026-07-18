// ─── AIMD-C block parser (roadmap Phase 3, AIMD-C v0.1) ────────────────────
// Parses one `::: aimd-<kind> {attrs} ... :::` block's already-extracted
// (type, attrs-string, body) into a structured object per kind. Reuses
// js-yaml (already a dependency, used the same way for World IR) for the
// genuinely YAML-shaped parts (input:/output: type maps, aimd-value/table
// literal bodies); hand-rolled line splitting for the parts that aren't
// safely YAML (a function's `expression:` value is a program, not data —
// handed to evaluator.js's own tokenizer/parser instead of coerced into a
// YAML scalar).
import jsYaml from 'js-yaml'
import { parseAssignment, parseExpression, tokenize } from './evaluator.js'

// {id="radius" type="Number"} — every AIMD-C block kind uses this same
// attribute shape.
export function parseAttrs(rest) {
  const attrs = {}
  const re = /([\w-]+)="([^"]*)"/g
  let m
  while ((m = re.exec(rest))) attrs[m[1]] = m[2]
  return attrs
}

function parseTypeMap(yamlText) {
  if (!yamlText || !yamlText.trim()) return {}
  let doc
  try { doc = jsYaml.load(yamlText) } catch (e) { throw new Error(`invalid input/output declaration: ${e.message}`) }
  if (!doc || typeof doc !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(doc)) out[k] = String(v)
  return out
}

// Splits a body into its top-level (column-0 `key:`) sections. A function
// block has input:/output:/expression:; other kinds may use a subset.
function splitSections(body) {
  const sections = {}
  let current = null
  for (const line of body.split('\n')) {
    const m = /^(\w+):\s*(.*)$/.exec(line)
    if (m && !/^[ \t]/.test(line)) {
      current = m[1]
      sections[current] = m[2] ? [m[2]] : []
    } else if (current) {
      sections[current].push(line)
    }
  }
  const out = {}
  for (const [k, lines] of Object.entries(sections)) out[k] = dedent(lines)
  return out
}

// `.trim()` alone only strips the outer edges of the whole joined string —
// a multi-line section like "  current: Number\n  previous: Number" loses
// its indent on the FIRST line only (trim() touches string edges, not each
// line), leaving the second line more indented than the first once joined —
// invalid YAML ("bad indentation of a mapping entry"). Strip the shared
// leading whitespace from every line instead, a standard dedent.
function dedent(lines) {
  const nonEmpty = lines.filter(l => l.trim())
  if (!nonEmpty.length) return ''
  const minIndent = Math.min(...nonEmpty.map(l => l.match(/^[ \t]*/)[0].length))
  return lines.map(l => l.slice(minIndent)).join('\n').trim()
}

export function parseFunctionBlock(attrs, body) {
  if (!attrs.id) throw new Error('aimd-function is missing a required id="..." attribute')
  const sections = splitSections(body)
  const input = parseTypeMap(sections.input)
  const output = parseTypeMap(sections.output)
  if (!sections.expression) throw new Error(`aimd-function "${attrs.id}" has no expression: section`)
  const assignment = parseAssignment(tokenize(sections.expression))
  if (!(assignment.name in output)) {
    throw new Error(`aimd-function "${attrs.id}": expression assigns "${assignment.name}", but output declares "${Object.keys(output).join(', ') || '(none)'}"`)
  }
  return { kind: 'function', id: attrs.id, pure: attrs.pure !== 'false', input, output, assignment }
}

export function parseValueBlock(attrs, body) {
  if (!attrs.id) throw new Error('aimd-value is missing a required id="..." attribute')
  const raw = body.trim()
  let value
  try { value = jsYaml.load(raw) } catch (e) { throw new Error(`aimd-value "${attrs.id}": ${e.message}`) }
  return { kind: 'value', id: attrs.id, type: attrs.type, value }
}

// One or more `name := @ref` / `name := literal` binding lines — the RHS is
// a full expression (usually just a bare `@ref` or literal, but nothing
// stops `r := @radius * 2`), reusing evaluator.js's own expression parser.
export function parseComputeBlock(attrs, body) {
  if (!attrs.id) throw new Error('aimd-compute is missing a required id="..." attribute')
  if (!attrs.use) throw new Error(`aimd-compute "${attrs.id}" is missing a required use="<function-id>" attribute`)
  const bindings = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t) continue
    bindings.push(parseAssignment(tokenize(t)))
  }
  return { kind: 'compute', id: attrs.id, use: attrs.use, bindings }
}

export function parseAssertBlock(attrs, body) {
  if (!attrs.id) throw new Error('aimd-assert is missing a required id="..." attribute')
  const raw = body.trim()
  const expr = parseExpression(tokenize(raw))
  return { kind: 'assert', id: attrs.id, expr, raw }
}

// The body's shape differs by renderer per the whitepaper's own examples: a
// bare label for `formula` (e.g. just the text "area"), a YAML config object
// for `number` (e.g. `format: "0.00"`). Try YAML first; an object means
// config, anything else (plain string, parse failure) means label text.
export function parseViewBlock(attrs, body) {
  if (!attrs.source) throw new Error('aimd-view is missing a required source="@..." attribute')
  const raw = body.trim()
  let config = {}
  let label = ''
  if (raw) {
    let parsed
    try { parsed = jsYaml.load(raw) } catch (_) { parsed = null }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed
    else label = raw
  }
  return { kind: 'view', id: attrs.id || null, source: attrs.source.replace(/^@/, ''), renderer: attrs.renderer || 'formula', config, label }
}

export function parseTableBlock(attrs, body) {
  let rows = []
  const raw = body.trim()
  if (raw) { try { rows = jsYaml.load(raw) || [] } catch (e) { throw new Error(`aimd-table "${attrs.id || ''}": ${e.message}`) } }
  return { kind: 'table', id: attrs.id, rows }
}

const PARSERS = {
  'aimd-value': parseValueBlock,
  'aimd-function': parseFunctionBlock,
  'aimd-compute': parseComputeBlock,
  'aimd-assert': parseAssertBlock,
  'aimd-table': parseTableBlock,
  'aimd-view': parseViewBlock,
}

export function isAimdcType(type) {
  return type.toLowerCase() in PARSERS
}

// Never throws — a malformed block becomes a `{ kind: 'error', ... }` node
// so one bad block doesn't take down the whole document's graph, matching
// this app's "diagnose, don't crash" posture elsewhere (Phase 1's math
// diagnostics, World IR's validator).
export function parseAimdcBlock(type, rest, body) {
  const attrs = parseAttrs(rest)
  const parse = PARSERS[type.toLowerCase()]
  try {
    return parse(attrs, body)
  } catch (e) {
    return { kind: 'error', id: attrs.id || null, message: e?.message || String(e) }
  }
}
