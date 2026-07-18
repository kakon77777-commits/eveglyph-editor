// ─── PREVIEW ──────────────────────────────────────────────────────
import { marked }             from 'marked'
import DOMPurify              from 'dompurify'
import renderMathInElement    from 'katex/contrib/auto-render'
import { editorGet }          from './editor.js'
import { parseFrontmatter, validateClass } from './frontmatter.js'
import { S }                  from './state.js'
import { monitor }            from './monitor.js'
import { renderWorldIrProjection } from './viewregistry.js'
import { wireEntityFormInteractions } from './entityview.js'
import { wireStateMachineInteractions } from './smview.js'
import { mathDiagnosticsReset, mathDiagnosticsScan, mathDiagnosticsRenderPanels, mathDiagnosticsAttemptFallback, mathRewriteRecord } from './mathdiagnostics.js'
import { prepareFormula } from './math/capability.js'
import { isAimdcType, parseAimdcBlock } from './aimdc/parser.js'
import { evaluateDocument } from './aimdc/graph.js'
import { renderBlock as renderAimdcBlockHtml, substituteInlineRefs } from './aimdc/render.js'

export function previewUpdate() {
  const el  = document.getElementById('preview-body')
  const src = editorGet()
  wireEntityFormInteractions(el)
  wireStateMachineInteractions(el)
  if (!src) { el.innerHTML = ''; return }

  // World IR documents (kind: state_machine / entity / entity_list / ...,
  // see viewregistry.js) get a specialized projection instead of the
  // Markdown pipeline -- the file itself is still plain YAML text in the
  // editor pane. Most are read-only comprehension aids; the Entity Form
  // View and State Machine View are editable (see entityview.js/smview.js).
  const worldIrHtml = renderWorldIrProjection(src)
  if (worldIrHtml !== null) {
    el.innerHTML = worldIrHtml
    return
  }

  // Sanitize before injecting: marked passes raw HTML through, and the editor
  // may hold untrusted/agent-written Markdown on a page that can call the local
  // bridge — so strip script/iframe/event-handlers/javascript: URLs (XSS guard).
  pendingAimdcBlocks = []   // fresh store for this render — see the comment above its declaration
  const processed = cfpPreprocess(src)
  const rawHtml   = marked ? marked.parse(processed) : processed
  el.innerHTML    = DOMPurify.sanitize(rawHtml)

  // AIMD-C (roadmap Phase 3): every block was collected (not yet rendered)
  // during cfpPreprocess and replaced with a placeholder token, because
  // rendering any one of them correctly needs the WHOLE document's
  // dependency graph evaluated first (a compute block's result can be
  // referenced by a view or {{ inline }} ref anywhere else in the document,
  // regardless of source order — whitepaper §15.1). Evaluate now, substitute
  // both the block placeholders and any {{ id.field }} references in the
  // surrounding prose, then re-sanitize (defense in depth — this HTML is
  // freshly generated from evaluated values, not the original DOMPurify
  // pass, so it gets its own pass too) before the math renderer below sees
  // it — an aimd-view{renderer="formula"} block emits real `$$...$$`
  // KaTeX/MathJax source, so it needs to still be in the DOM when that runs.
  if (pendingAimdcBlocks.length) {
    const aimdcDoc = evaluateDocument(pendingAimdcBlocks)
    let html = el.innerHTML
    html = html.replace(/AIMDC_BLOCK_PLACEHOLDER_(\d+)/g, (_, i) => renderAimdcBlockHtml(pendingAimdcBlocks[Number(i)], aimdcDoc))
    html = substituteInlineRefs(html, aimdcDoc)
    el.innerHTML = DOMPurify.sanitize(html)
  }

  if (renderMathInElement) {
    const myGeneration = mathDiagnosticsReset()
    const formulaAttempts = []
    try {
      renderMathInElement(el, {
        delimiters: [
          { left:'$$', right:'$$', display:true },
          { left:'$',  right:'$',  display:false }
        ],
        throwOnError: false,
        // Multi-backend rendering roadmap Phase 2 (Safe Rewrite): applied per
        // formula, before katex ever sees it, so a formula like `\begin{split}`
        // (KaTeX has never supported it — Typst's converter already rewrites
        // it to `aligned` before compiling, see typstconvert.js) renders
        // correctly here too instead of just being diagnosed by Phase 1.
        // Regular function, not arrow — auto-render invokes this as
        // `options.preProcess(tex)`, a method call, so `this` is bound to
        // its own shared options object, which carries `displayMode` for
        // the formula currently being processed (verified empirically:
        // logged `this.displayMode` across mixed inline/display formulas
        // and confirmed it flips correctly per-call, undocumented but
        // real). Needed to know which mode to retry in if MathJax fallback
        // kicks in below.
        preProcess: function (tex) {
          const { tex: rewritten, appliedRewrites } = prepareFormula(tex)
          mathRewriteRecord(appliedRewrites)
          formulaAttempts.push({ tex: rewritten, display: !!this?.displayMode })
          return rewritten
        }
      })
    } catch(_) {}
    mathDiagnosticsScan(el, formulaAttempts)
    mathDiagnosticsRenderPanels(el)
    // Phase 2b: whatever still failed gets one more try through MathJax
    // (lazy-loaded — only fetched when there's an actual failure to retry).
    // Fire-and-forget: patches the specific DOM nodes and re-renders the
    // panels in place once results land, guarded against a superseded
    // render via myGeneration.
    mathDiagnosticsAttemptFallback(el, myGeneration)
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

  // ::: block_type {title="..."} ... ::: — type must allow hyphens
  // (aimd-value, aimd-function, ...), not just \w, or e.g. "aimd-value"
  // gets mis-split into type="aimd" + a garbled rest string.
  out = out.replace(/^:::\s+([\w-]+)([^\n]*)\n([\s\S]*?)^:::/gm, (_, type, rest, inner) => {
    if (isAimdcType(type)) {
      // AIMD-C (roadmap Phase 3): parsed now, rendered later — see the
      // comment in previewUpdate() on why rendering has to wait for the
      // whole document's dependency graph.
      const block = parseAimdcBlock(type, rest, inner)
      const idx = pendingAimdcBlocks.push(block) - 1
      return `AIMDC_BLOCK_PLACEHOLDER_${idx}`
    }
    const tm = rest.match(/title="([^"]*)"/)
    const title = tm ? tm[1] : ''
    const label = `${type.toUpperCase()}${title ? ': ' + title : ''}`
    const parsed = marked ? marked.parse(inner.trim()) : inner
    return `<div class="cfp-block cfp-${type.toLowerCase()}"><div class="cfp-label">${label}</div>${parsed.trimEnd()}</div>\n`
  })

  return out
}

// AIMD-C (roadmap Phase 3, AIMD-C v0.1). Replaces the whitepaper v0.5 §4.4
// Logic_Node/Coupling Node syntax entirely (Decision 1, roadmap v0.6) — the
// new block kinds (aimd-value/function/compute/assert/table/view) carry
// types, a dependency graph, and a computation ledger the old syntax never
// had. Parsed during cfpPreprocess, evaluated + rendered in previewUpdate()
// once the whole document's blocks are collected — see the comments there.
// Reset once per previewUpdate() call, not per block, so multiple AIMD-C
// blocks in one document share the same evaluation pass.
let pendingAimdcBlocks = []
