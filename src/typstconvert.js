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
    try { body = tex2typst(entry.tex) } catch { body = entry.tex }
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

function calloutBox(type, title, innerTypst) {
  const key = type.toLowerCase()
  const color = CALLOUT_COLORS[key] || '#6b7280'
  const label = title ? `${type.toUpperCase()}: ${title}` : type.toUpperCase()
  const italic = key === 'proof' ? ', style: "italic"' : ', weight: "bold"'
  return `#block(fill: rgb("${color}").lighten(90%), stroke: (left: 2.5pt + rgb("${color}")), ` +
    `inset: 10pt, radius: 3pt, width: 100%, breakable: true)[\n` +
    `#text(fill: rgb("${color}"), size: 9pt${italic})[${esc(label)}]\n#v(4pt)\n${innerTypst}]\n\n`
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

// ─── Top-level split: ::: blocks vs. plain Markdown ────────────────────
const CALLOUT_RE = /^:::[ \t]+(\w+)([^\n]*)\r?\n([\s\S]*?)^:::[ \t]*$/gm

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
// Tested standalone (page/text/heading/raw/link rules) before wiring in —
// Libertinus Serif first, falling back to Noto Serif TC per-glyph for CJK
// (both already loaded by typstexport.js), rather than leaving font choice
// to the compiler's own implicit fallback search.
const PREAMBLE = `#set page(paper: "a4", margin: (x: 2.2cm, y: 2.5cm))
#set text(font: ("Libertinus Serif", "Noto Serif TC"), size: 10.5pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: none)
#show heading: it => {
  set text(weight: "bold")
  set text(size: (17pt, 13.5pt, 11.5pt, 10.5pt).at(calc.min(it.level - 1, 3)))
  v(0.5em, weak: true)
  it.body
  v(0.35em, weak: true)
}
#show raw.where(block: true): it => block(fill: rgb("#f4f4f5"), inset: 8pt, radius: 3pt, width: 100%, it)
#show raw.where(block: false): it => box(fill: rgb("#f0f0f0"), inset: (x: 3pt, y: 0pt), outset: (y: 2pt), radius: 2pt, it)
#show link: it => text(fill: rgb("#2563eb"), it)

`

// Converts EveGlyph-MD (frontmatter stripped) source to Typst markup.
export function markdownToTypst(source) {
  const { body } = parseFrontmatter(source)
  return PREAMBLE + convertBody(body)
}
