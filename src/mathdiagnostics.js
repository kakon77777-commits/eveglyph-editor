// ─── Math diagnostics + MathJax fallback (multi-backend rendering roadmap,
// Phases 1 and 2b) ───────────────────────────────────────────────────────
// Phase 1: with throwOnError:false, KaTeX almost never throws a ParseError
// up to the caller (verified empirically against this app's exact katex
// 0.16.47 setup) — katex.render()'s own internal error recovery catches it
// in one of two DOM shapes, silently, and returns normally. This module
// scans for both shapes after each render and turns a failure into: (1) a
// Monitor ledger entry, (2) a diagnostics block at the top of the preview
// (reusing renderDiagnosticsBlock(), already used for World IR validation).
//
// Phase 2b: whatever still fails after KaTeX gets one more try through
// MathJax (math/mathjaxbackend.js, lazy-loaded, only fetched when there's
// an actual failure to retry). This runs asynchronously AFTER the synchronous
// KaTeX pass and diagnostics panel are already visible — a rescued formula
// swaps in and its diagnostic disappears; a formula MathJax also can't
// render just stays exactly as Phase 1 already showed it. Correlating a
// specific failed DOM node back to its original TeX source (MathJax needs
// the source, not the broken output) relies on positional matching against
// `formulaAttempts`, an ordered list preview.js builds from every
// `preProcess` call — see mathDiagnosticsScan's argument.
import DOMPurify from 'dompurify'
import { monitor } from './monitor.js'
import { renderDiagnosticsBlock } from './diagnostics.js'
import { t, tPlural } from './i18n/index.js'
import { renderWithMathJax } from './math/mathjaxbackend.js'

const SOURCE_MAX_CHARS = 80

let currentIssues = []     // [{ severity, message }] — renderDiagnosticsBlock's shape
let currentFailures = []   // [{ node, tex, display, issueIndex }] — fallback candidates
let rewriteCount = 0
let fallbackRescueCount = 0
let generation = 0

// Called at the start of every previewUpdate(). Returns the new generation
// number so an in-flight async fallback from a PREVIOUS render can tell it's
// been superseded and skip patching DOM nodes that may already be gone.
export function mathDiagnosticsReset() {
  currentIssues = []
  currentFailures = []
  rewriteCount = 0
  fallbackRescueCount = 0
  generation += 1
  return generation
}

// Called by preview.js's renderMathInElement `preProcess` hook whenever
// capability.js's prepareFormula() actually changed a formula's source
// (Safe Rewrite / Renderer Badge, Phase 2).
export function mathRewriteRecord(ruleIds) {
  if (!ruleIds.length) return
  rewriteCount += 1
  monitor('math:render:rewritten', { rules: ruleIds })
}

// Call after renderMathInElement() has finished mutating `el`. `formulaAttempts`
// is preview.js's ordered `[{ tex, display }]` list, one entry per formula
// preProcess saw — a single combined `.katex-error, .katex` query returns
// every math output node in the same document order auto-render created them
// in, so a plain index-for-index zip is a reliable, empirically-verified
// correlation (no forking of auto-render's own DOM walk required).
export function mathDiagnosticsScan(el, formulaAttempts = []) {
  const outputs = el.querySelectorAll('.katex-error, .katex')
  outputs.forEach((node, i) => {
    const attempt = formulaAttempts[i]

    // (1) The whole formula fails to parse — katex's renderError() replaces
    // it with a standalone `.katex-error` span (title attribute has the
    // full message). Never nested inside a normal `.katex` element.
    if (node.classList.contains('katex-error')) {
      let source = node.textContent || ''
      if (source.length > SOURCE_MAX_CHARS) source = source.slice(0, SOURCE_MAX_CHARS) + '…'
      const detail = node.getAttribute('title') || ''
      const issueIndex = currentIssues.push({ severity: 'error', message: t('mathDiagnostics.formulaFailed', { source, detail }) }) - 1
      monitor('math:render:error', { source, detail, kind: 'parse-error' })
      if (attempt?.tex) currentFailures.push({ node, tex: attempt.tex, display: attempt.display, issueIndex })
      return
    }

    // (2) A single unsupported command inside an otherwise-valid formula —
    // katex's formatUnsupportedCmd() renders just that token in errorColor
    // (default #cc0000 / rgb(204, 0, 0)) and keeps rendering the rest of the
    // formula normally. No class, no title — the more insidious case.
    const bad = node.querySelector('.katex-html [style*="204, 0, 0"]')
    if (!bad) return
    const token = (bad.textContent || '').trim()
    let source = node.querySelector('annotation')?.textContent || ''
    if (source.length > SOURCE_MAX_CHARS) source = source.slice(0, SOURCE_MAX_CHARS) + '…'
    const issueIndex = currentIssues.push({ severity: 'warning', message: t('mathDiagnostics.unsupportedCommand', { token, source }) }) - 1
    monitor('math:render:degraded', { source, token, kind: 'unsupported-command' })
    if (attempt?.tex) currentFailures.push({ node, tex: attempt.tex, display: attempt.display, issueIndex })
  })
}

// Inserts/updates the two note panels at the top of `el` in place — callable
// more than once per render (Phase 1's synchronous pass, then again after
// Phase 2b's async fallback resolves and currentIssues/rewriteCount changed).
export function mathDiagnosticsRenderPanels(el) {
  let rewriteEl = el.querySelector(':scope > .math-rewrite-note')
  if (rewriteCount || fallbackRescueCount) {
    const parts = []
    if (rewriteCount) parts.push(tPlural('mathDiagnostics.autoNormalized', 'mathDiagnostics.autoNormalizedPlural', rewriteCount, { count: rewriteCount }))
    if (fallbackRescueCount) parts.push(tPlural('mathDiagnostics.renderedViaMathJax', 'mathDiagnostics.renderedViaMathJaxPlural', fallbackRescueCount, { count: fallbackRescueCount }))
    const label = parts.join(' ')
    if (rewriteEl) rewriteEl.textContent = label
    else el.insertAdjacentHTML('afterbegin', `<div class="math-rewrite-note">${label}</div>`)
  } else if (rewriteEl) {
    rewriteEl.remove()
  }

  let diagEl = el.querySelector(':scope > .math-diag-wrap')
  if (currentIssues.length) {
    const inner = `<div class="math-diag-label">${t('mathDiagnostics.panelLabel')}</div>${renderDiagnosticsBlock(currentIssues)}`
    if (diagEl) diagEl.innerHTML = inner
    else el.insertAdjacentHTML('afterbegin', `<div class="math-diag-wrap">${inner}</div>`)
  } else if (diagEl) {
    diagEl.remove()
  }
}

// Phase 2b: for every formula that still failed after KaTeX, try MathJax.
// Fire-and-forget from preview.js — patches DOM nodes and re-renders the
// panels in place as results come back, guarded against a superseded render
// by comparing `myGeneration` against the live counter before touching `el`.
export async function mathDiagnosticsAttemptFallback(el, myGeneration) {
  const attempts = currentFailures
  if (!attempts.length) return

  const results = await Promise.all(attempts.map(async (failure) => {
    const result = await renderWithMathJax(failure.tex, failure.display)
    return { failure, result }
  }))

  if (myGeneration !== generation) return   // a newer previewUpdate() has already run

  let rescued = 0
  for (const { failure, result } of results) {
    if (!result.ok) {
      monitor('math:render:fallback-failed', { tex: failure.tex, error: result.error })
      continue
    }
    if (!failure.node.isConnected) continue   // DOM already changed under us
    const wrapper = document.createElement(failure.display ? 'div' : 'span')
    wrapper.className = 'math-mathjax-fallback'
    wrapper.title = t('mathDiagnostics.renderedViaMathJaxTitle')
    wrapper.innerHTML = DOMPurify.sanitize(result.html, { USE_PROFILES: { svg: true, svgFilters: true } })
    failure.node.replaceWith(wrapper)
    currentIssues[failure.issueIndex] = null   // drop from the panel — filtered out below
    rescued += 1
    monitor('math:render:fallback-success', { tex: failure.tex })
  }

  if (rescued) {
    currentIssues = currentIssues.filter(Boolean)
    fallbackRescueCount += rescued
    mathDiagnosticsRenderPanels(el)
  }
}

export function mathDiagnosticsCount() {
  return currentIssues.length
}
