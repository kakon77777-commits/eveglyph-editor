// ─── EVEGLYPH-MD FRONTMATTER (v0.1 schema) ───────────────────────────
// The minimal semantic-classification layer for a document: type / status / tags
// (whitepaper §4.5, supplement memo §4.3). Defined at v0.3 so the frontmatter habit
// forms early and an existing corpus doesn't need a painful metadata backfill later;
// it also gives the context compiler a basic document class to hand the agent.
//
// Deliberately a tiny hand-rolled YAML SUBSET — not a general parser. It UNDERSTANDS
// only scalars + a flat string list (the schema's shape), but it never DESTROYS what
// it doesn't understand: upsertFrontmatter edits the raw block line-by-line, so a
// human's block scalars, nested maps, comments and spacing survive a rewrite untouched.
// The enum lists live in the config contract.
import { CONFIG } from './config.js'

export const EVEGLYPH_TYPES    = CONFIG.eveglyphMd.types
export const EVEGLYPH_STATUSES = CONFIG.eveglyphMd.statuses

// A leading frontmatter block: the doc must OPEN with `---` on its own line (an
// optional BOM is tolerated) and the block must CLOSE with `---` or `...`. With no
// closing fence we treat it as NOT frontmatter, so a `---` thematic break in ordinary
// prose is never mis-parsed as metadata. CRLF tolerant. Groups: 1=opening fence (incl
// BOM + newline), 2=inner body, 3=closing fence (leading newline + fence + trailing).
const FM_RE = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/

const RESERVED = ['type', 'status', 'tags']

// → { hasFm, data, order, body, endIndex, _open, _inner, _close }. `order` preserves
// key order; the `_*` fields hold the raw block so upsert can edit it byte-faithfully.
export function parseFrontmatter(text = '') {
  const m = text.match(FM_RE)
  if (!m) return { hasFm: false, data: {}, order: [], body: text, endIndex: 0, _open: '', _inner: '', _close: '' }

  const data = {}
  const order = []
  const lines = m[2].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue          // blank / comment line
    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/)
    if (!kv) continue                                         // indented / unsupported → skip (kept on rewrite)
    const key = kv[1]
    const rest = kv[2].trim()

    if (rest === '') {
      // A block list:  key:\n  - a\n  - b   (consume following `- ` lines)
      const items = []
      while (i + 1 < lines.length && /^[ \t]+-[ \t]+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^[ \t]+-[ \t]+/, '').trim()))
      }
      // Empty value with no list items may be a block scalar / nested map we don't
      // model — record '' for our schema view; the raw bytes still round-trip via upsert.
      data[key] = items.length ? items.filter(Boolean) : ''
    } else if (/^\[.*\]$/.test(rest)) {
      data[key] = parseInlineArray(rest)
    } else {
      data[key] = unquote(rest)
    }
    if (!order.includes(key)) order.push(key)
  }
  return { hasFm: true, data, order, body: text.slice(m[0].length), endIndex: m[0].length, _open: m[1], _inner: m[2], _close: m[3] }
}

// Reverse of formatScalar's quoting. Double-quoted: de-escape \" and \\. Single-quoted
// (YAML): a literal quote is written doubled ('') — collapse it. Symmetric so a value
// never grows backslashes across save cycles.
function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

// Inline `[a, b, "c, d"]`. Splits on commas not inside quotes (a `\"` inside a
// double-quoted element is NOT a delimiter), then de-quotes each element via unquote.
function parseInlineArray(s) {
  const inner = s.slice(1, -1)
  const out = []
  let buf = '', q = '', esc = false
  for (const ch of inner) {
    if (esc) { buf += ch; esc = false; continue }
    if (q === '"' && ch === '\\') { buf += ch; esc = true; continue }   // keep backslash; next char is literal
    if (q) { buf += ch; if (ch === q) q = ''; continue }
    if (ch === '"' || ch === "'") { q = ch; buf += ch; continue }
    if (ch === ',') { const t = buf.trim(); if (t) out.push(unquote(t)); buf = ''; continue }
    buf += ch
  }
  const t = buf.trim(); if (t) out.push(unquote(t))
  return out
}

// Serialize a fresh block from `data` (only used when no frontmatter exists yet).
// Arrays render inline; scalars are quoted only when a bare value would confuse the parser.
export function stringifyFrontmatter(data, order = Object.keys(data), body = '') {
  const keys = [...new Set([...order, ...Object.keys(data)])].filter(k => k in data)
  const lines = keys.map(k => renderLine(k, data[k]))
  const block = `---\n${lines.join('\n')}\n---\n`
  const trimmedBody = body.replace(/^\r?\n+/, '')
  return trimmedBody ? `${block}\n${trimmedBody}` : `${block}\n`
}

function renderLine(k, v) {
  return Array.isArray(v)
    ? `${k}: [${v.map(formatScalar).join(', ')}]`
    : `${k}: ${formatScalar(v)}`
}

// Quote only when needed. A value containing a double-quote is SINGLE-quoted (YAML
// single-quotes need no backslash escaping for "), so parse/serialize stay symmetric
// and a value never accumulates backslashes. Reserve double-quote+escape for the rare
// value holding both quote kinds.
function formatScalar(v) {
  const s = String(v ?? '')
  if (s === '') return "''"
  const needsQuote = /[:#[\]{},"']/.test(s) || /^[ \t]/.test(s) || /[ \t]$/.test(s) || /^(true|false|null|yes|no|on|off)$/i.test(s)
  if (!needsQuote) return s
  if (s.includes('"') && !s.includes("'")) return `'${s}'`
  if (s.includes("'") && !s.includes('"')) return `"${s}"`
  if (!s.includes('"') && !s.includes("'")) return `'${s}'`
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`   // both kinds present → escape
}

// The schema-relevant view of a document's frontmatter. Always returns the three
// fields in their canonical shape (string / string / string[]).
export function getClass(text = '') {
  const { data } = parseFrontmatter(text)
  return {
    type:   typeof data.type === 'string' ? data.type : '',
    status: typeof data.status === 'string' ? data.status : '',
    tags:   Array.isArray(data.tags) ? data.tags
          : (typeof data.tags === 'string' && data.tags ? [data.tags] : []),
  }
}

// Advisory schema check — unknown enum values warn (never block): a human may use a
// type/status this build doesn't know, and the format must tolerate that.
export function validateClass(cls) {
  const issues = []
  if (cls.type && !EVEGLYPH_TYPES.includes(cls.type)) {
    issues.push({ field: 'type', level: 'warn', msg: `Unknown type "${cls.type}"` })
  }
  if (cls.status && !EVEGLYPH_STATUSES.includes(cls.status)) {
    issues.push({ field: 'status', level: 'warn', msg: `Unknown status "${cls.status}"` })
  }
  return issues
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Edit one top-level `key:` line in the raw inner-block lines, removing any of its
// indented continuation lines (block list / block scalar / nested map). Appends a new
// line if the key is absent; removes it when `v` is null. Everything else is untouched.
function upsertKeyLine(lines, key, v) {
  const rendered = (v === undefined || v === null) ? null : renderLine(key, v)
  const keyRe = new RegExp(`^${escRe(key)}:`)
  const idx = lines.findIndex(l => keyRe.test(l))
  if (idx === -1) return rendered === null ? lines : [...lines, rendered]

  // Span the key's value: itself + following indented or `- ` continuation lines.
  let end = idx + 1
  while (end < lines.length && (/^[ \t]/.test(lines[end]) || /^-[ \t]/.test(lines[end]))) end++
  const out = lines.slice(0, idx)
  if (rendered !== null) out.push(rendered)
  out.push(...lines.slice(end))
  return out
}

// Merge `patch` into a doc's frontmatter and return the new text. When a block already
// exists, only the patched top-level lines change — block scalars, nested maps, comments
// and spacing in the rest of the block survive byte-for-byte. When absent, a fresh block
// is created. A key set to null/undefined is removed.
export function upsertFrontmatter(text = '', patch = {}) {
  const parsed = parseFrontmatter(text)
  if (!parsed.hasFm) {
    const data = {}, order = []
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue
      data[k] = v; order.push(k)
    }
    return order.length ? stringifyFrontmatter(data, order, text) : text
  }
  let lines = parsed._inner.split(/\r?\n/)
  for (const [k, v] of Object.entries(patch)) lines = upsertKeyLine(lines, k, v)
  return parsed._open + lines.join('\n') + parsed._close + parsed.body
}

// Fill in only the MISSING schema fields with defaults — used to stamp new files and
// as a non-destructive "add frontmatter" action. Existing values are never touched.
export function stampDefaults(text = '', type = CONFIG.eveglyphMd.defaultType, status = CONFIG.eveglyphMd.defaultStatus) {
  const { data } = parseFrontmatter(text)
  const patch = {}
  if (!data.type)            patch.type = type
  if (!data.status)          patch.status = status
  if (!('tags' in data))     patch.tags = []
  return Object.keys(patch).length ? upsertFrontmatter(text, patch) : text
}

export const EVEGLYPH_RESERVED = RESERVED
