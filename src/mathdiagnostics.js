// ─── Math diagnostics (multi-backend rendering roadmap, Phase 1) ───────────
// With throwOnError:false, KaTeX almost never throws a ParseError up to the
// caller (verified empirically against this app's exact katex 0.16.47 setup,
// not assumed from docs) — katex.render()'s own internal renderError() catches
// it, renders the offending fragment inline wrapped in a `.katex-error` span
// (red text, full message in the `title` attribute for hover), and returns
// normally. That inline red text is the ONLY signal a failure ever produced
// before this module existed — nothing was logged, nothing was queryable,
// and it was easy to miss in a long document. This module scans for that
// `.katex-error` marker after each render and turns it into: (1) a Monitor
// ledger entry — the project's existing diagnostic-stream mechanism, not a
// new one — and (2) a diagnostics block at the top of the preview, reusing
// renderDiagnosticsBlock() (already used for World IR validation) so math
// failures read the same as every other kind of diagnostic in this app.
import { monitor } from './monitor.js'
import { renderDiagnosticsBlock } from './diagnostics.js'
import { t, tPlural } from './i18n/index.js'

const SOURCE_MAX_CHARS = 80

let currentIssues = []
let rewriteCount = 0

export function mathDiagnosticsReset() {
  currentIssues = []
  rewriteCount = 0
}

// Called by preview.js's renderMathInElement `preProcess` hook whenever
// capability.js's prepareFormula() actually changed a formula's source
// (multi-backend rendering roadmap, Phase 2 — Safe Rewrite / Renderer Badge).
// Kept as a plain counter rather than per-formula DOM badges: preProcess only
// gets the raw TeX string, not a handle to the DOM node katex builds from it,
// so a precise inline badge would need forking renderMathInElement's own DOM
// walk. A coarse "N formulas auto-normalized" note is the honest MVP version.
export function mathRewriteRecord(ruleIds) {
  if (!ruleIds.length) return
  rewriteCount += 1
  monitor('math:render:rewritten', { rules: ruleIds })
}

export function mathRewriteHtml() {
  if (!rewriteCount) return ''
  const label = tPlural('mathDiagnostics.autoNormalized', 'mathDiagnostics.autoNormalizedPlural', rewriteCount, { count: rewriteCount })
  return `<div class="math-rewrite-note">${label}</div>`
}

// Call after renderMathInElement() has finished mutating `el`. Empirically,
// against this app's exact katex 0.16.47 setup, throwOnError:false produces
// TWO different silent-degradation shapes, not one:
export function mathDiagnosticsScan(el) {
  // (1) The whole formula fails to parse — katex's renderError() replaces it
  // with a standalone `.katex-error` span (title attribute has the full
  // message). It's never nested inside a normal `.katex` element, so this
  // loop and the one below never double-count the same node.
  for (const node of el.querySelectorAll('.katex-error')) {
    let source = node.textContent || ''
    if (source.length > SOURCE_MAX_CHARS) source = source.slice(0, SOURCE_MAX_CHARS) + '…'
    const detail = node.getAttribute('title') || ''
    currentIssues.push({ severity: 'error', message: t('mathDiagnostics.formulaFailed', { source, detail }) })
    monitor('math:render:error', { source, detail, kind: 'parse-error' })
  }

  // (2) A single unsupported command inside an otherwise-valid formula —
  // katex's formatUnsupportedCmd() renders just that token in errorColor
  // (default #cc0000 / rgb(204, 0, 0)) and keeps rendering the rest of the
  // formula normally. No class, no title, no error thrown anywhere — this is
  // the more insidious case, easy to miss at a glance in a themed preview.
  // Scoped to .katex-html to skip the parallel .katex-mathml copy of the same
  // node (katex renders both for accessibility). Matching on katex's own
  // default error color is the only signal available without forking katex;
  // a document that legitimately colors text that exact red would false-
  // positive here — an accepted MVP limitation, not attempted to fully rule out.
  for (const formula of el.querySelectorAll('.katex')) {
    const bad = formula.querySelector('.katex-html [style*="204, 0, 0"]')
    if (!bad) continue
    const token = (bad.textContent || '').trim()
    let source = formula.querySelector('annotation')?.textContent || ''
    if (source.length > SOURCE_MAX_CHARS) source = source.slice(0, SOURCE_MAX_CHARS) + '…'
    currentIssues.push({ severity: 'warning', message: t('mathDiagnostics.unsupportedCommand', { token, source }) })
    monitor('math:render:degraded', { source, token, kind: 'unsupported-command' })
  }
}

export function mathDiagnosticsHtml() {
  if (!currentIssues.length) return ''
  return `<div class="math-diag-wrap"><div class="math-diag-label">${t('mathDiagnostics.panelLabel')}</div>${renderDiagnosticsBlock(currentIssues)}</div>`
}

export function mathDiagnosticsCount() {
  return currentIssues.length
}
