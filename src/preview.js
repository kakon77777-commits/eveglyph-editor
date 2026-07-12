// ─── PREVIEW ──────────────────────────────────────────────────────
import { marked }             from 'marked'
import DOMPurify              from 'dompurify'
import renderMathInElement    from 'katex/contrib/auto-render'
import { editorGet }          from './editor.js'
import { parseFrontmatter, validateClass } from './frontmatter.js'
import { S }                  from './state.js'
import { monitor }            from './monitor.js'

export function previewUpdate() {
  const el  = document.getElementById('preview-body')
  const src = editorGet()
  wireAimdInteractions(el)
  if (!src) { el.innerHTML = ''; return }

  // Sanitize before injecting: marked passes raw HTML through, and the editor
  // may hold untrusted/agent-written Markdown on a page that can call the local
  // bridge — so strip script/iframe/event-handlers/javascript: URLs (XSS guard).
  aimdCouplings = []   // fresh store for this render — see the comment above its declaration
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
    if (type.toLowerCase() === 'aimd') return renderAimdBlock(inner)
    const tm = rest.match(/title="([^"]*)"/)
    const title = tm ? tm[1] : ''
    const label = `${type.toUpperCase()}${title ? ': ' + title : ''}`
    const parsed = marked ? marked.parse(inner.trim()) : inner
    return `<div class="cfp-block cfp-${type.toLowerCase()}"><div class="cfp-label">${label}</div>${parsed.trimEnd()}</div>\n`
  })

  return out
}

// ─── AIMD / Cogni-Flow Protocol (whitepaper v0.5 §4) ────────────────
// Lives inside the existing `::: type ... :::` block mechanism as `::: aimd ... :::`
// rather than a new top-level syntax, so it can't collide with ordinary prose
// elsewhere in a document.

// Phase 3 storage for Coupling Node bodies, referenced from the DOM by a small
// integer index (`data-coupling-idx`) rather than embedded as a `data-content`
// attribute value. That was the first approach here and it silently lost content:
// DOMPurify's mXSS defenses strip an attribute whose (properly HTML-escaped) value
// merely contains certain dash/bracket patterns — e.g. "A &lt;---&gt; B" — even
// though it's harmless prose. Untrusted document text is too unpredictable to trust
// inside an attribute value; a plain-digit index sidesteps the whole class of
// problem, and reading via `.textContent` on mount needs no escaping at all.
// Reset once per previewUpdate() call (not per `::: aimd :::` block, so multiple
// AIMD blocks in one document still get distinct indices), so it never grows
// unbounded across edits — every call replaces #preview-body's whole subtree anyway.
let aimdCouplings = []

function aimdStatusClass(status) {
  const key = String(status).trim().toLowerCase()
  if (key.includes('verif'))            return 'ok'      // Verified / 已驗證
  if (key.includes('fail') || key.includes('error')) return 'err'
  if (key.includes('pend') || key.includes('wait'))  return 'warn'
  return 'neutral'
}

function renderAimdBlock(inner) {
  const lines = inner.split('\n')

  // Leading @Key: value header lines (@BaseSpace, @State, ...).
  const meta = []
  let i = 0
  while (i < lines.length && /^@\w+:/.test(lines[i].trim())) {
    const m = lines[i].trim().match(/^@(\w+):\s*(.*)$/)
    if (m) meta.push(`<span class="aimd-meta-k">${esc(m[1])}</span><span class="aimd-meta-v">${esc(m[2])}</span>`)
    i++
  }
  const metaHtml = meta.length ? `<div class="aimd-meta">${meta.join('')}</div>` : ''

  // Pull out <Coupling Node: LABEL>...</Coupling> blocks first (they can span
  // several lines) and swap each for a placeholder token, so the line-by-line pass
  // below never has to worry about multi-line constructs.
  const couplings = []
  const body = lines.slice(i).join('\n').replace(
    /<Coupling Node:\s*([^>]*)>([\s\S]*?)<\/Coupling>/g,
    (_, label, content) => {
      couplings.push({ label: label.trim(), content: content.trim() })
      // No delimiter characters needed around the token - line.trim() below already
      // normalizes surrounding whitespace, and this string is specific enough not to
      // collide with real prose. (An earlier version wrapped this in literal NUL
      // bytes to survive .trim(), which "worked" but was invisible in every tool used
      // to inspect the file - including making git treat it as a binary diff. Not
      // worth the confusion for what a slightly more specific placeholder string
      // solves for free.)
      return `AIMD_COUPLING_PLACEHOLDER_${couplings.length - 1}`
    }
  )

  const out = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const ph = line.match(/^AIMD_COUPLING_PLACEHOLDER_(\d+)$/)
    if (ph) {
      const c = couplings[Number(ph[1])]
      const idx = aimdCouplings.push(c) - 1   // shared store — see the comment above aimdCouplings
      // Native <details>/<summary>, collapsed by default. The body is deliberately
      // NOT in this markup - Phase 3 mounts it on open and unmounts it on close
      // (see wireAimdInteractions' `toggle` handler below), so a document with many
      // folded Coupling Nodes doesn't pay full-DOM cost for content nobody's
      // looking at. The content is local document text (no remote base-space to
      // fetch yet), so "realize" means "materialize the DOM node" here, not a
      // network round-trip - a smaller, honest claim than the whitepaper's full
      // vision. The label captured from `<Coupling Node: X>` is often the bare ⋈
      // operator itself, so don't double it up with a hardcoded ⋈ prefix.
      const label = c.label && c.label !== '⋈' ? `Coupling Node: ${c.label}` : 'Coupling Node ⋈'
      out.push(
        `<details class="aimd-coupling" data-coupling-idx="${idx}">` +
        `<summary class="aimd-coupling-h">${esc(label)}</summary></details>`
      )
      continue
    }

    // Main-trunk node: > [D_G=1, λ=0.95] task text
    const trunk = line.match(/^>\s*\[D_G=(\d+)(?:,\s*λ=([\d.]+))?\]\s*(.*)$/)
    if (trunk) {
      const [, depth, lambda, text] = trunk
      out.push(
        `<div class="aimd-trunk"><span class="aimd-tag">D_G=${esc(depth)}</span>` +
        (lambda ? `<span class="aimd-tag">λ=${esc(lambda)}</span>` : '') +
        `<span class="aimd-trunk-text">${esc(text)}</span></div>`
      )
      continue
    }

    // Status-projection node: [Logic_Node: ID] 狀態: X | 相干度: Y | 驗證器: Z
    // The ID slot can optionally carry `| expr="..."` (Phase 2) — a real expression
    // to send to /api/compute on click, instead of the line just being static text.
    const status = line.match(/^\[Logic_Node:\s*([^\]|]+?)(?:\s*\|\s*expr="([^"]*)")?\]\s*狀態:\s*([^|]+)\|\s*相干度:\s*([^|]+)\|\s*驗證器:\s*(.+)$/)
    if (status) {
      const [, id, expr, state, coherence, verifier] = status
      const btn = expr
        ? `<button type="button" class="aimd-compute-btn" data-node-id="${esc(id.trim())}" data-expr="${esc(expr)}" data-verifier="${esc(verifier.trim().toLowerCase())}" title="Compute (Phase 2, /api/compute)">▶</button>`
        : ''
      out.push(
        `<div class="aimd-status aimd-status-${aimdStatusClass(state)}"><span class="aimd-dot"></span>` +
        `<span class="aimd-node-id">${esc(id.trim())}</span>` +
        `<span class="aimd-node-state">${esc(state.trim())}</span>` +
        `<span class="aimd-node-coh">${esc(coherence.trim())}</span>` +
        `<span class="aimd-node-verifier">${esc(verifier.trim())}</span>${btn}</div>`
      )
      continue
    }

    // Anything else is ordinary prose mixed into the block — render as Markdown.
    out.push(marked ? marked.parse(raw) : raw)
  }

  return `<div class="aimd-block">${metaHtml}${out.join('\n')}</div>\n`
}

// Delegated event wiring for both interactive AIMD pieces, wired once - previewUpdate()
// re-renders #preview-body's innerHTML on every keystroke (debounced), which would
// otherwise orphan a directly-attached listener.
let aimdWired = false
function wireAimdInteractions(el) {
  if (aimdWired || !el) return
  aimdWired = true

  // Phase 2 (whitepaper v0.5 §4.6): a Logic_Node with `expr="..."` gets a ▶ button.
  // Nothing computes automatically on render/open; only an explicit click hits the
  // network, same "human confirms" gate as the rest of the app.
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('.aimd-compute-btn')
    if (!btn) return
    await runAimdCompute(btn)
  })

  // Phase 3 (whitepaper v0.5 §4.3/§4.6): mount a Coupling Node's body on open,
  // unmount it on close - "on-demand realization" + attention-loss release, purely
  // client-side (see the comment on the coupling-node branch in renderAimdBlock for
  // why this is DOM mount/unmount rather than a network fetch). The native `toggle`
  // event does NOT bubble, so delegation only works via the capture phase (`true`
  // below) - capture-phase listeners still see events from descendants regardless
  // of whether the event bubbles afterward.
  el.addEventListener('toggle', (e) => {
    const details = e.target
    if (!details.classList?.contains('aimd-coupling')) return
    if (details.open) {
      if (!details.querySelector('.aimd-coupling-body')) {
        const c = aimdCouplings[Number(details.dataset.couplingIdx)]
        const body = document.createElement('div')
        body.className = 'aimd-coupling-body'
        body.textContent = c ? c.content : ''   // textContent — no HTML interpretation, so no escaping needed
        details.appendChild(body)
      }
    } else {
      details.querySelector('.aimd-coupling-body')?.remove()
    }
  }, true)
}

async function runAimdCompute(btn) {
  const row = btn.closest('.aimd-status')
  const nodeId = btn.dataset.nodeId
  const expr = btn.dataset.expr
  const verifier = btn.dataset.verifier

  btn.disabled = true
  btn.textContent = '…'
  await monitor('aimd:compute:click', { node_id: nodeId, verifier })

  try {
    const r = await fetch('/api/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: S.workspaceRoot, node_id: nodeId, expr, verifier, permission: S.cfg.agentPermission || 'standard' })
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)

    if (row) {
      row.className = `aimd-status aimd-status-${aimdStatusClass(data.state)}`
      const stateEl = row.querySelector('.aimd-node-state')
      const cohEl   = row.querySelector('.aimd-node-coh')
      if (stateEl) stateEl.textContent = data.state
      if (cohEl)   cohEl.textContent   = data.coherence !== null && data.coherence !== undefined
        ? String(data.coherence) : (data.detail || '—')
      row.title = data.detail || ''
    }
    btn.textContent = '↻'
  } catch (e) {
    if (row) {
      row.className = 'aimd-status aimd-status-err'
      const stateEl = row.querySelector('.aimd-node-state')
      if (stateEl) stateEl.textContent = 'Error'
      row.title = String(e?.message || e)
    }
    btn.textContent = '⚠'
  } finally {
    btn.disabled = false
  }
}
