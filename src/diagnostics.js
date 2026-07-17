// Shared HTML rendering for validate.js's issue lists. Kept separate from
// validate.js itself so that module stays pure data/logic (no DOM), and
// this one small file is the only place that turns issues into markup.
import { t } from './i18n/index.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

export function renderDiagnosticsBlock(issues) {
  if (!issues.length) return `<div class="diag-block diag-ok">${t('diagnosticsDynamic.noIssues')}</div>`
  const errors = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  const errorWord = t(errors > 1 ? 'diagnosticsDynamic.errors' : 'diagnosticsDynamic.error')
  const warningWord = t(warnings > 1 ? 'diagnosticsDynamic.warnings' : 'diagnosticsDynamic.warning')
  return `
    <div class="diag-block">
      <div class="diag-summary">${errors ? `<span class="diag-count diag-error">${errors} ${errorWord}</span>` : ''}${warnings ? `<span class="diag-count diag-warning">${warnings} ${warningWord}</span>` : ''}</div>
      <ul class="diag-list">
        ${issues.map(i => `<li class="diag-${i.severity}"><span class="diag-icon">${i.severity === 'error' ? '✗' : '⚠'}</span>${esc(i.message)}</li>`).join('\n')}
      </ul>
    </div>
  `
}
