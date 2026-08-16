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
import { isDynamicLogicType, parseDynamicLogicBlock } from './dynamiclogic/parser.js'
import { evaluateDynamicDocument } from './dynamiclogic/runtime.js'
import { annotateDynamicMotion } from './dynamiclogic/motion.js'
import { renderDynamicLogicBlock, wireDynamicLogicInteractions } from './dynamiclogic/render.js'
import { renderChartBlock } from './visual/chart.js'
import { renderPlotBlock } from './visual/plot.js'
import { worldStudioEnabled } from './worldfeatures.js'

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
    // With World Studio disabled, World IR remains ordinary, directly editable
    // YAML instead of exposing the advanced visual authoring projection.
    el.innerHTML = worldStudioEnabled()
      ? worldIrHtml
      : `<pre class="world-source-preview"><code>${esc(src)}</code></pre>`
    return
  }

  // Sanitize before injecting: marked passes raw HTML through, and the editor
  // may hold untrusted/agent-written Markdown on a page that can call the local
  // bridge — so strip script/iframe/event-handlers/javascript: URLs (XSS guard).
  pendingAimdcBlocks = []        // fresh store for this render — see declaration below
  pendingDynamicLogicBlocks = [] // Dynamic Logic uses a separate semantic layer above AIMD-C
  const processed = cfpPreprocess(src)
  const rawHtml   = marked ? marked.parse(processed) : processed
  el.innerHTML    = DOMPurify.sanitize(rawHtml)

  // Dynamic Logic v0.1 is evaluated BEFORE AIMD-C so its validated judgment
  // projections can be exposed as read-only external refs to the existing
  // AIMD expression graph (`@weather-judge.support`). This is the key layering
  // rule: Dynamic Logic does not grow a second arithmetic evaluator; AIMD-C
  // remains the formula engine, while Dynamic Logic owns evidence/history.
  //
  // Both block families were collected during cfpPreprocess and replaced with
  // placeholders, so we can evaluate their whole-document semantics first,
  // render both, substitute shared {{ id.field }} refs, then run KaTeX.
  if (pendingAimdcBlocks.length || pendingDynamicLogicBlocks.length) {
    // Replay state is UI-only, but must still be namespaced by the active file;
    // two documents are allowed to use the same local claim id independently.
    const dynamicDoc = evaluateDynamicDocument(pendingDynamicLogicBlocks, S.active || '__buffer__')

    // Compute one browser-frame diff BEFORE either renderer runs. Dynamic Logic
    // remains the owner of transition semantics; AIMD-C receives only a read-only
    // map saying which external ref changed, so formula views can visibly react
    // without learning anything about claims/evidence/replay themselves.
    annotateDynamicMotion(dynamicDoc)
    const aimdcDoc = evaluateDocument(pendingAimdcBlocks, dynamicDoc.refs)
    aimdcDoc.externalTransitions = dynamicDoc.refTransitions

    let html = el.innerHTML
    html = html.replace(/AIMDC_BLOCK_PLACEHOLDER_(\d+)/g, (_, i) => renderAimdcBlockHtml(pendingAimdcBlocks[Number(i)], aimdcDoc))
    html = html.replace(/DYNAMIC_LOGIC_BLOCK_PLACEHOLDER_(\d+)/g, (_, i) => renderDynamicLogicBlock(pendingDynamicLogicBlocks[Number(i)], dynamicDoc))
    // AIMD-C's resolver accepts dynamicDoc.refs as a read-only external
    // namespace, so the SAME inline syntax works for computed and judgment
    // values rather than introducing a second reference language.
    html = substituteInlineRefs(html, aimdcDoc)
    el.innerHTML = DOMPurify.sanitize(html)
    wireDynamicLogicInteractions(el, previewUpdate)
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
    if (isDynamicLogicType(type)) {
      // Dynamic Logic MVP: claims/evidence/judgments/history are collected
      // separately from AIMD-C formulas, then evaluated first so judgment
      // projections can feed the existing formula graph as external refs.
      const block = parseDynamicLogicBlock(type, rest, inner)
      const idx = pendingDynamicLogicBlocks.push(block) - 1
      return `DYNAMIC_LOGIC_BLOCK_PLACEHOLDER_${idx}`
    }
    // Visual IR (roadmap Phase 5): chart/plot blocks are self-contained —
    // own inline data or a bare function expression, no cross-block
    // dependency graph to wait for (unlike AIMD-C blocks above) — so they
    // render straight to SVG here, synchronously, same tick as everything
    // else cfpPreprocess already renders inline.
    if (type.toLowerCase() === 'chart') return renderChartBlock(rest, inner)
    if (type.toLowerCase() === 'plot') return renderPlotBlock(rest, inner)
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

// Dynamic Logic is intentionally a layer ABOVE AIMD-C rather than new math
// syntax. Its blocks produce evidence/judgment runtime refs that AIMD-C may
// consume; replay is UI-local and never mutates canonical Markdown source.
let pendingDynamicLogicBlocks = []
