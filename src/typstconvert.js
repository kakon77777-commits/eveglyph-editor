// ─── Markdown → Typst converter (Phase 2 + callout/AIMD pass) ──────────────
// Walks marked's token tree (marked.lexer()) and emits Typst markup — not a
// from-scratch Markdown parser (marked already is one) and not a Typst
// compiler (typstexport.js is that). Just the translation layer in between.
// Math ($...$ / $$...$$) is pulled out before tokenizing — marked has no math
// token type, and math bodies routinely contain characters (`_`, `*`, `\`)
// that would otherwise get misread as Markdown syntax — then converted via
// tex2typst and spliced back into the finished Typst text.
//
// EveGlyph-MD's `::: type ... :::` blocks (callouts + AIMD) are a custom
// syntax marked doesn't know about, so they're split out at the raw-source
// level BEFORE tokenizing (mirrors preview.js's own regex-based approach —
// same shallow, non-nesting behavior, not a regression from what the app
// already does). Each callout becomes a colored Typst box; AIMD's inner
// syntax (meta/trunk/status/coupling) becomes a static print rendering —
// no compute buttons or collapsible folding in a PDF, just the last-known
// state as written in the document.
import { marked } from 'marked'
import { tex2typst } from 'tex2typst'
import { parseFrontmatter } from './frontmatter.js'
import { buildPreamble } from './typst/preamble.js'
import { isAimdcType, parseAimdcBlock } from './aimdc/parser.js'
import { evaluateDocument, resolveRef } from './aimdc/graph.js'

// Private-use-area code point built at runtime (never typed literally) — an
// inert placeholder delimiter that survives marked's tokenizer as plain text.
const MATH_MARK = String.fromCharCode(0xE000)
const MATH_RE = new RegExp(MATH_MARK + '(\\d+)' + MATH_MARK, 'g')

// Typst markup-mode characters that are ALWAYS special, position-independent.
// (`-`/`+`/`=`/digits are only special at line start — line-start collisions
// are handled separately by prefixing list/heading markers ourselves, not by
// escaping every hyphen in prose.)
const ESCAPE_RE = /[\\#*_`$<>@\[\]~]/g
// marked's inline tokenizer pre-escapes bare &/</>/"/' inside plain 'text'
// tokens into HTML entities (defense for its OWN HTML renderer — irrelevant
// here, but it means t.text for "A <---> B" arrives as "A &lt;---&gt; B").
// Decode those back to real characters before applying Typst's own escaping,
// or literal angle brackets/ampersands in prose leak as raw "&lt;" text.
const HTML_ENTITY_RE = /&(amp|lt|gt|quot|#39);/g
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
function unescapeHtmlEntities(s) {
  return String(s).replace(HTML_ENTITY_RE, (_, name) => HTML_ENTITIES[name])
}
function esc(s) {
  return unescapeHtmlEntities(s).replace(ESCAPE_RE, c => '\\' + c)
}

// tex2typst (v0.6.2) understands `align`/`aligned` but not the LaTeX `split`
// environment, even though they're the same alignment semantics — leaves
// `\begin{split}`/`\end{split}` untranslated in its output, which then
// breaks Typst's math parser (bare "begin"/"end" reads as implicit
// variable multiplication, "b*e*g*i*n"). Normalize the alias before
// handing TeX to the converter rather than waiting on an upstream fix.
function normalizeTexAliases(tex) {
  return tex.replace(/\\begin\{split\}/g, '\\begin{aligned}').replace(/\\end\{split\}/g, '\\end{aligned}')
}

function extractMath(source) {
  const stash = []
  const stow = (tex, block) => {
    const i = stash.push({ tex: tex.trim(), block }) - 1
    return MATH_MARK + i + MATH_MARK
  }
  let out = source.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => `\n\n${stow(tex, true)}\n\n`)
  out = out.replace(/\$([^\$\n]+?)\$/g, (_, tex) => stow(tex, false))
  return { out, stash }
}

function restoreMath(typstText, stash) {
  return typstText.replace(MATH_RE, (_, idxStr) => {
    const entry = stash[Number(idxStr)]
    if (!entry) return ''
    let body
    try { body = tex2typst(normalizeTexAliases(entry.tex)) } catch { body = null }
    // tex2typst silently leaves unsupported LaTeX environments/commands
    // untranslated rather than throwing — a literal `\begin{...}` reaching
    // Typst's math parser breaks it (and the resulting compiler warning is
    // cryptic: "did you mean b*e*g*i*n?"). Fall back to showing the raw
    // LaTeX as a clearly-marked plain-text note instead of feeding Typst
    // math syntax it can't parse — an honest gap, not a silent break.
    if (body == null || /\\(begin|end)\{/.test(body)) {
      return `#text(fill: rgb("#999999"), style: "italic")[[math: ${esc(entry.tex)}]]`
    }
    return entry.block ? `$ ${body} $` : `$${body}$`
  })
}

function inline(tokens = []) {
  return tokens.map(inlineOne).join('')
}

function inlineOne(t) {
  switch (t.type) {
    case 'text':
    case 'escape':
      return esc(t.text)
    case 'strong':
      return `*${inline(t.tokens)}*`
    case 'em':
      return `_${inline(t.tokens)}_`
    case 'del':
      return `#strike[${inline(t.tokens)}]`
    case 'codespan':
      return '`' + t.text + '`'
    case 'link':
      return `#link("${t.href}")[${inline(t.tokens)}]`
    case 'image':
      return `#figure(image("${t.href}"))`
    case 'br':
      return ' \\\n'
    default:
      return t.text != null ? esc(t.text) : ''
  }
}

function list(t, depth) {
  const pad = '  '.repeat(depth)
  const marker = t.ordered ? '+' : '-'
  return t.items.map(item => {
    const nested = item.tokens?.find(tok => tok.type === 'list')
    const own = item.tokens?.filter(tok => tok.type !== 'list') || []
    const body = own.map(tok =>
      tok.type === 'text' ? inline(tok.tokens || [{ type: 'text', text: tok.text }]) : block(tok)
    ).join('').trim()
    let line = `${pad}${marker} ${body}\n`
    if (nested) line += list(nested, depth + 1)
    return line
  }).join('')
}

function table(t) {
  const cols = t.header.length
  let out = `#table(\n  columns: ${cols},\n  stroke: 0.5pt + rgb("#d0d0d0"),\n  fill: (_, row) => if row == 0 { rgb("#00000008") },\n  `
  out += t.header.map(h => `[*${inline(h.tokens)}*]`).join(', ') + ',\n'
  for (const row of t.rows) {
    out += '  ' + row.map(c => `[${inline(c.tokens)}]`).join(', ') + ',\n'
  }
  return out + ')\n\n'
}

function block(t) {
  switch (t.type) {
    case 'heading':
      return `${'='.repeat(Math.min(t.depth, 6))} ${inline(t.tokens)}\n\n`
    case 'paragraph':
      return `${inline(t.tokens)}\n\n`
    case 'blockquote':
      return `#quote(block: true)[\n${(t.tokens || []).map(block).join('')}]\n\n`
    case 'code':
      return '```' + (t.lang ? t.lang.split(/\s+/)[0] : '') + '\n' + t.text + '\n```\n\n'
    case 'list':
      return list(t, 0) + '\n'
    case 'table':
      return table(t)
    case 'hr':
      return '#line(length: 100%)\n\n'
    case 'space':
      return ''
    default:
      return t.raw ? esc(t.raw) : ''
  }
}

// Plain Markdown (no ::: blocks at this level) → Typst, math-aware.
function convertMarkdownFragment(md) {
  const { out, stash } = extractMath(md)
  const tokens = marked.lexer(out)
  const typst = tokens.map(block).join('')
  return restoreMath(typst, stash)
}

// ─── Callout boxes ──────────────────────────────────────────────────────
// Mirrors preview.js's `.cfp-*` color scheme so a printed doc matches what
// the in-app preview already shows.
const CALLOUT_COLORS = {
  definition: '#3b82f6',
  theorem: '#8b5cf6',
  lemma: '#a78bfa',
  note: '#f59e0b',
  warning: '#ef4444'
}

// Roadmap Phase 4 (semantic components + numbering): theorem/lemma/
// definition get their own sequential counter each (standard academic
// convention — a THEOREM and a LEMMA number independently, not off one
// shared sequence). `proof`/`note`/`warning` stay unnumbered — a proof
// refers back to its theorem by proximity, not a number of its own; note/
// warning are call-outs, not citable claims. Typst's `#context` is
// required to read a counter's live value inside markup (0.12+).
const NUMBERED_TYPES = new Set(['theorem', 'lemma', 'definition'])

function calloutBox(type, title, innerTypst) {
  const key = type.toLowerCase()
  const color = CALLOUT_COLORS[key] || '#6b7280'
  const italic = key === 'proof' ? ', style: "italic"' : ', weight: "bold"'
  const titleSuffix = title ? `: ${esc(title)}` : ''

  const labelBlock = NUMBERED_TYPES.has(key)
    ? `#counter("eg-${key}").step()\n` +
      `#text(fill: rgb("${color}"), size: 9pt${italic})[${type.toUpperCase()} #context counter("eg-${key}").display()${titleSuffix}]`
    : `#text(fill: rgb("${color}"), size: 9pt${italic})[${type.toUpperCase()}${titleSuffix}]`

  return `#block(fill: rgb("${color}").lighten(90%), stroke: (left: 2.5pt + rgb("${color}")), ` +
    `inset: 10pt, radius: 3pt, width: 100%, breakable: true)[\n` +
    `${labelBlock}\n#v(4pt)\n${innerTypst}]\n\n`
}

// ─── AIMD blocks ────────────────────────────────────────────────────────
// Static print rendering: last-known state as written, no compute buttons
// (nothing to click in a PDF) and no folded Coupling Nodes (nothing to
// "collapse" once it's on paper — content is materialized inline instead).
const AIMD_STATUS_COLORS = { ok: '#22c55e', err: '#ef4444', warn: '#f59e0b', neutral: '#9ca3af' }

function aimdStatusClass(status) {
  const key = String(status).trim().toLowerCase()
  if (key.includes('verif')) return 'ok'
  if (key.includes('fail') || key.includes('error')) return 'err'
  if (key.includes('pend') || key.includes('wait')) return 'warn'
  return 'neutral'
}

function convertAimdBlock(inner) {
  const lines = inner.split('\n')

  let i = 0
  const metaParts = []
  while (i < lines.length && /^@\w+:/.test(lines[i].trim())) {
    const m = lines[i].trim().match(/^@(\w+):\s*(.*)$/)
    if (m) metaParts.push(`${m[1]}: ${m[2]}`)
    i++
  }
  const metaTypst = metaParts.length
    ? `#text(size: 8pt, fill: rgb("#888888"))[${esc(metaParts.join('  ·  '))}]\n#v(4pt)\n`
    : ''

  // Pull out <Coupling Node: LABEL>...</Coupling> blocks first (multi-line).
  const couplings = []
  const body = lines.slice(i).join('\n').replace(
    /<Coupling Node:\s*([^>]*)>([\s\S]*?)<\/Coupling>/g,
    (_, label, content) => {
      couplings.push({ label: label.trim(), content: content.trim() })
      return `AIMD_COUPLING_PLACEHOLDER_${couplings.length - 1}`
    }
  )

  const parts = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const ph = line.match(/^AIMD_COUPLING_PLACEHOLDER_(\d+)$/)
    if (ph) {
      const c = couplings[Number(ph[1])]
      const label = c.label && c.label !== '⋈' ? `Coupling Node: ${c.label}` : 'Coupling Node ⋈'
      parts.push(
        `#block(stroke: 0.5pt + rgb("#999999"), inset: 8pt, radius: 3pt, width: 100%, breakable: true)[` +
        `#text(style: "italic", size: 8pt, fill: rgb("#888888"))[${esc(label)}]\n#v(3pt)\n` +
        `${convertMarkdownFragment(c.content)}]\n\n`
      )
      continue
    }

    const trunk = line.match(/^>\s*\[D_G=(\d+)(?:,\s*λ=([\d.]+))?\]\s*(.*)$/)
    if (trunk) {
      const [, depth, lambda, text] = trunk
      const tag = `D_G=${depth}` + (lambda ? `  ·  λ=${lambda}` : '')
      parts.push(
        `#block(fill: rgb("#00000008"), inset: 8pt, radius: 3pt, width: 100%, breakable: true)[` +
        `#text(size: 8pt, fill: rgb("#888888"))[${esc(tag)}]\n#v(2pt)\n${esc(text)}]\n\n`
      )
      continue
    }

    const status = line.match(/^\[Logic_Node:\s*([^\]|]+?)(?:\s*\|\s*expr="([^"]*)")?\]\s*狀態:\s*([^|]+)\|\s*相干度:\s*([^|]+)\|\s*驗證器:\s*(.+)$/)
    if (status) {
      const [, id, , state, coherence, verifier] = status
      const color = AIMD_STATUS_COLORS[aimdStatusClass(state)]
      parts.push(
        `#text(fill: rgb("${color}"))[●] *${esc(id.trim())}* ` +
        `狀態: ${esc(state.trim())}  相干度: ${esc(coherence.trim())}  驗證器: ${esc(verifier.trim())}\n\n`
      )
      continue
    }

    // Ordinary prose mixed into the block.
    parts.push(convertMarkdownFragment(raw))
  }

  return `#block(fill: rgb("#00000005"), inset: 10pt, radius: 3pt, width: 100%, breakable: true)[\n${metaTypst}${parts.join('')}]\n\n`
}

// ─── AIMD-C blocks → Typst (roadmap Phase 4: AIMD-C Projection meets the
// Backend Router) ────────────────────────────────────────────────────────
// Reuses src/aimdc/parser.js + graph.js verbatim — both pure logic, no DOM
// dependency — so the SAME parsing/evaluation runs for the live preview and
// PDF export. One source of truth for what a document's AIMD-C blocks
// compute, not two implementations that could silently drift apart. Blocks
// are collected (not rendered) while walking the document, because
// rendering any ONE of them correctly needs the WHOLE document's dependency
// graph evaluated first — same two-pass shape as preview.js, just with a
// text-placeholder substitution instead of a DOM one.
let pendingAimdcBlocks = []

function fmtAimdcValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `[${v.map(fmtAimdcValue).join(', ')}]`
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function formatAimdcNumber(value, fmt) {
  const m = /^0\.(0+)$/.exec(String(fmt || ''))
  if (m && typeof value === 'number') return value.toFixed(m[1].length)
  return fmtAimdcValue(value)
}

function issueFor(id, doc) {
  return doc.issues.find(i => i.id === id)?.message
}

const AIMDC_COLORS = { value: '#60a5fa', function: '#a78bfa', compute: '#4ade80', assert: '#fbbf24', error: '#ef4444' }

function aimdcBadge(kind, color) {
  return `#text(fill: rgb("${color}"), size: 8pt, weight: "bold")[${kind.toUpperCase()}]`
}

function aimdcBox(color, inner) {
  return `#block(fill: rgb("#00000005"), stroke: (left: 2pt + rgb("${color}")), inset: 8pt, radius: 3pt, width: 100%, breakable: true)[\n${inner}\n]\n\n`
}

function renderAimdcTableTypst(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
    return aimdcBox('#6b7280', 'No rows.')
  }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r || {})))]
  let out = `#table(\n  columns: ${cols.length},\n  stroke: 0.5pt + rgb("#d0d0d0"),\n  fill: (_, row) => if row == 0 { rgb("#00000008") },\n  `
  out += cols.map(c => `[*${esc(c)}*]`).join(', ') + ',\n'
  for (const row of rows) out += '  ' + cols.map(c => `[${esc(fmtAimdcValue(row[c] ?? ''))}]`).join(', ') + ',\n'
  return out + ')\n\n'
}

function renderAimdcBlockTypst(block, doc) {
  switch (block.kind) {
    case 'value':
      return aimdcBox(AIMDC_COLORS.value,
        `${aimdcBadge('value', AIMDC_COLORS.value)} #text(weight: "bold")[${esc(block.id)}] ` +
        (block.type ? `#text(size: 8pt, fill: rgb("#888888"))[${esc(block.type)}] ` : '') +
        `= ${esc(fmtAimdcValue(block.value))}`)
    case 'function': {
      const inSig = Object.entries(block.input).map(([k, v]) => `${k}: ${v}`).join(', ')
      const outSig = Object.entries(block.output).map(([k, v]) => `${k}: ${v}`).join(', ')
      return aimdcBox(AIMDC_COLORS.function,
        `${aimdcBadge('function', AIMDC_COLORS.function)} #text(weight: "bold")[${esc(block.id)}] ` +
        `#raw("(${inSig}) -> (${outSig})")`)
    }
    case 'compute': {
      const result = doc.results.get(block.id)
      const failed = !result || result.error
      const color = failed ? AIMDC_COLORS.error : AIMDC_COLORS.compute
      const state = !result ? 'blocked' : result.error ? 'failed' : 'completed'
      const detail = result?.outputs
        ? Object.entries(result.outputs).map(([k, v]) => `${k} = ${fmtAimdcValue(v)}`).join(', ')
        : (result?.error || issueFor(block.id, doc) || '')
      return aimdcBox(color,
        `${aimdcBadge('compute', color)} #text(weight: "bold")[${esc(block.id)}] ` +
        `#text(fill: rgb("${color}"))[${state}] ${esc(detail)}`)
    }
    case 'assert': {
      const result = doc.results.get(block.id)
      const passed = result && !result.error && result.passed
      const color = passed ? AIMDC_COLORS.compute : AIMDC_COLORS.error
      const state = !result ? 'blocked' : result.error ? 'failed' : result.passed ? 'verified' : 'failed'
      return aimdcBox(color, `${aimdcBadge('assert', color)} #raw("${block.raw.replace(/"/g, '\\"')}") #text(fill: rgb("${color}"))[${state}]`)
    }
    case 'table':
      return renderAimdcTableTypst(block.rows)
    case 'view': {
      let value
      try { value = resolveRef(block.source, doc.byId, doc.results) }
      catch (e) { return aimdcBox(AIMDC_COLORS.error, `${aimdcBadge('view', AIMDC_COLORS.error)} ${esc(e.message)}`) }
      if (block.renderer === 'table' && Array.isArray(value)) return renderAimdcTableTypst(value)
      if (block.renderer === 'number') {
        const text = block.config.format ? formatAimdcNumber(value, block.config.format) : fmtAimdcValue(value)
        return `#text(size: 14pt, weight: "bold")[${esc(text)}]\n\n`
      }
      // 'formula' (default) — real Typst math, not a picture of it. The
      // label is NOT run through esc() (that's markup-mode escaping, wrong
      // rule set for math mode) — instead it's wrapped in a quoted string
      // literal, which is Typst math mode's own way to render a bare word
      // as upright text instead of trying to evaluate it as a variable
      // reference (confirmed empirically: `$ area = 1 $` throws "unknown
      // variable: area" — Typst math mode never treats a bare multi-letter
      // word as literal text on its own).
      const label = block.label || block.source.split('.').pop()
      return `$ "${label.replace(/"/g, '\\"')}" = ${fmtAimdcValue(value)} $\n\n`
    }
    case 'error':
      return aimdcBox(AIMDC_COLORS.error,
        `${aimdcBadge('invalid', AIMDC_COLORS.error)} ${block.id ? `#text(weight: "bold")[${esc(block.id)}] ` : ''}${esc(block.message)}`)
    default:
      return ''
  }
}

// ─── Top-level split: ::: blocks vs. plain Markdown ────────────────────
// Type token allows hyphens ([\w-]+, not \w+) so AIMD-C block kinds
// (aimd-value, aimd-function, ...) get captured whole instead of being
// mis-split into type="aimd" + a garbled "-value {...}" rest string — same
// bug, same fix, as preview.js's own block regex (roadmap Phase 3).
const CALLOUT_RE = /^:::[ \t]+([\w-]+)([^\n]*)\r?\n([\s\S]*?)^:::[ \t]*$/gm

function convertBody(md) {
  CALLOUT_RE.lastIndex = 0
  let out = ''
  let last = 0
  let m
  while ((m = CALLOUT_RE.exec(md))) {
    out += convertMarkdownFragment(md.slice(last, m.index))
    const [, type, rest, inner] = m
    if (type.toLowerCase() === 'aimd') {
      out += convertAimdBlock(inner)
    } else if (isAimdcType(type)) {
      const block = parseAimdcBlock(type, rest, inner)
      const idx = pendingAimdcBlocks.push(block) - 1
      out += `AIMDC_TYPST_PLACEHOLDER_${idx}\n\n`
    } else {
      const tm = rest.match(/title="([^"]*)"/)
      out += calloutBox(type, tm ? tm[1] : '', convertMarkdownFragment(inner))
    }
    last = CALLOUT_RE.lastIndex
  }
  out += convertMarkdownFragment(md.slice(last))
  return out
}

// ─── Document-level typesetting ─────────────────────────────────────────
// Theme + layout selection (roadmap Phase 4: Typst Theme Compiler) — an
// optional `typst_theme` / `typst_layout` frontmatter key picks a
// TYPST_THEMES / TYPST_LAYOUTS id (src/typst/theme.js, layout.js); anything
// unset or unrecognized falls back to the defaults, which are built to
// match the pre-Phase-4 hardcoded preamble exactly — a document with no
// opinion on this renders the same PDF as before this phase, not a
// surprise change.
export function markdownToTypst(source) {
  const { data, body } = parseFrontmatter(source)
  const preamble = buildPreamble(data.typst_theme, data.typst_layout)
  pendingAimdcBlocks = []
  let typst = convertBody(body)
  if (pendingAimdcBlocks.length) {
    const aimdcDoc = evaluateDocument(pendingAimdcBlocks)
    typst = typst.replace(/AIMDC_TYPST_PLACEHOLDER_(\d+)/g, (_, i) => renderAimdcBlockTypst(pendingAimdcBlocks[Number(i)], aimdcDoc))
    // {{ id.field }} inline references — resolved from the SAME evaluated
    // graph as the block rendering above, so a PDF export shows identical
    // computed values to the live preview, not a second guess at them.
    typst = typst.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
      try { return esc(fmtAimdcValue(resolveRef(path, aimdcDoc.byId, aimdcDoc.results))) }
      catch (e) { return `#text(fill: rgb("#ef4444"))[{{ ${esc(path)}: ${esc(e.message)} }}]` }
    })
  }
  return preamble + typst
}
