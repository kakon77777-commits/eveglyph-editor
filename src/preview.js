// ─── PREVIEW ──────────────────────────────────────────────────────
import { marked }             from 'marked'
import DOMPurify              from 'dompurify'
import renderMathInElement    from 'katex/contrib/auto-render'
import { editorGet }          from './editor.js'
import { parseFrontmatter, validateClass } from './frontmatter.js'

export function previewUpdate() {
  const el  = document.getElementById('preview-body')
  const src = editorGet()
  if (!src) { el.innerHTML = ''; return }

  // Sanitize before injecting: marked passes raw HTML through, and the editor
  // may hold untrusted/agent-written Markdown on a page that can call the local
  // bridge — so strip script/iframe/event-handlers/javascript: URLs (XSS guard).
  const processed = cfpPreprocess(src)
  const rawHtml   = marked ? marked.parse(processed) : processed
  el.innerHTML    = DOMPurify.sanitize(rawHtml)

  if (renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [
          { left:'$$', right:'$$', display:true },
          { left:'$',  right:'$',  display:false }
        ],
        throwOnError: false
      })
    } catch(_) {}
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

// Render the leading frontmatter as a compact metadata header: type/status as
// schema badges (out-of-enum values flagged), tags as #chips, any extra keys as
// key:value lines. Values are HTML-escaped here AND the whole preview is run through
// DOMPurify, so agent-written frontmatter can't inject markup.
function fmDisplayHtml(parsed) {
  const type   = typeof parsed.data.type === 'string' ? parsed.data.type : ''
  const status = typeof parsed.data.status === 'string' ? parsed.data.status : ''
  const tags   = Array.isArray(parsed.data.tags) ? parsed.data.tags : []
  const issues = validateClass({ type, status, tags })
  const bad = (f) => issues.some(i => i.field === f) ? ' fm-invalid' : ''
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '')

  const badges = []
  if (type)   badges.push(`<span class="fm-badge fm-type${bad('type')}">${esc(type)}</span>`)
  if (status) badges.push(`<span class="fm-badge fm-status fm-status-${slug(status)}${bad('status')}">${esc(status)}</span>`)
  for (const t of tags) badges.push(`<span class="fm-tag">#${esc(t)}</span>`)

  const extra = parsed.order
    .filter(k => !['type', 'status', 'tags'].includes(k))
    .map(k => {
      const v = parsed.data[k]
      const val = Array.isArray(v) ? v.join(', ') : v
      return `<span class="fm-key">${esc(k)}</span>: <span class="fm-val">${esc(val)}</span>`
    }).join('<br>')

  return `<div class="fm-display">` +
    (badges.length ? `<div class="fm-badges">${badges.join(' ')}</div>` : '') +
    (extra ? `<div class="fm-extra">${extra}</div>` : '') +
    `</div>\n`
}

function cfpPreprocess(src) {
  let out = src

  // YAML frontmatter → styled metadata header (never rendered as raw `---` text).
  const parsed = parseFrontmatter(src)
  if (parsed.hasFm) out = fmDisplayHtml(parsed) + parsed.body

  // ::: block_type {title="..."} ... :::
  out = out.replace(/^:::\s+(\w+)([^\n]*)\n([\s\S]*?)^:::/gm, (_, type, rest, inner) => {
    const tm = rest.match(/title="([^"]*)"/)
    const title = tm ? tm[1] : ''
    const label = `${type.toUpperCase()}${title ? ': ' + title : ''}`
    const parsed = marked ? marked.parse(inner.trim()) : inner
    return `<div class="cfp-block cfp-${type.toLowerCase()}">
      <div class="cfp-label">${label}</div>
      ${parsed}
    </div>\n`
  })

  return out
}
