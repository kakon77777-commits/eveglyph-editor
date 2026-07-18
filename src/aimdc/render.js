// ─── AIMD-C rendering (roadmap Phase 3, AIMD-C v0.1) ────────────────────────
// Turns a parsed block + the whole document's evaluation results into HTML.
// State labels are a deliberately trimmed slice of the whitepaper's own
// Appendix C state machine (draft/valid/invalid/stale/running/completed/
// failed/blocked/permission-required/unverified/verified) — this phase is
// synchronous, L1-only, no external effects, so "running"/"stale"/"blocked
// on capability"/"permission-required" don't apply yet; only the states a
// same-tick evaluation can actually produce are used.
import { t } from '../i18n/index.js'
import { resolveRef } from './graph.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function fmtValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(', ')}]`
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// "0.00"-style Excel-ish format string — decimal places = digits after the dot.
function formatNumber(value, fmt) {
  const m = /^0\.(0+)$/.exec(String(fmt || ''))
  if (m && typeof value === 'number') return value.toFixed(m[1].length)
  return fmtValue(value)
}

export function renderBlock(block, doc) {
  switch (block.kind) {
    case 'value':    return renderValue(block)
    case 'function': return renderFunction(block)
    case 'compute':  return renderCompute(block, doc)
    case 'assert':   return renderAssert(block, doc)
    case 'table':    return renderTableBlock(block)
    case 'view':     return renderView(block, doc)
    case 'error':    return renderError(block)
    default:         return ''
  }
}

function renderValue(block) {
  return `<div class="aimdc-block aimdc-value">` +
    `<span class="aimdc-badge aimdc-badge-value">${t('aimdc.value')}</span>` +
    `<span class="aimdc-id">${esc(block.id)}</span>` +
    (block.type ? `<span class="aimdc-type">${esc(block.type)}</span>` : '') +
    `<span class="aimdc-val">${esc(fmtValue(block.value))}</span>` +
    `</div>`
}

function renderFunction(block) {
  const inSig  = Object.entries(block.input).map(([k, v]) => `${k}: ${v}`).join(', ')
  const outSig = Object.entries(block.output).map(([k, v]) => `${k}: ${v}`).join(', ')
  return `<div class="aimdc-block aimdc-function">` +
    `<span class="aimdc-badge aimdc-badge-function">${t('aimdc.function')}</span>` +
    `<span class="aimdc-id">${esc(block.id)}</span>` +
    `<code class="aimdc-sig">(${esc(inSig)}) → (${esc(outSig)})</code>` +
    (block.pure ? `<span class="aimdc-pure">${t('aimdc.pure')}</span>` : '') +
    `</div>`
}

// A block with no result (e.g. skipped as part of a circular reference)
// still needs its "why" to reach the reader — otherwise it just shows
// "Blocked" with no explanation, exactly the kind of silent gap Phase 1/2
// of this roadmap exist to close everywhere else. doc.issues carries it.
function issueFor(id, doc) {
  return doc.issues.find(i => i.id === id)?.message
}

function renderCompute(block, doc) {
  const result = doc.results.get(block.id)
  const blockedMessage = !result ? issueFor(block.id, doc) : null
  const state = !result ? 'blocked' : result.error ? 'failed' : 'completed'
  const valueHtml = result?.outputs
    ? Object.entries(result.outputs).map(([k, v]) => `<span class="aimdc-output"><b>${esc(k)}</b> = ${esc(fmtValue(v))}</span>`).join(' ')
    : result?.error ? `<span class="aimdc-error-msg">${esc(result.error)}</span>`
    : blockedMessage ? `<span class="aimdc-error-msg">${esc(blockedMessage)}</span>` : ''
  return `<div class="aimdc-block aimdc-compute aimdc-state-${state}">` +
    `<span class="aimdc-badge aimdc-badge-compute">${t('aimdc.compute')}</span>` +
    `<span class="aimdc-id">${esc(block.id)}</span>` +
    `<span class="aimdc-state">${t(`aimdc.state.${state}`)}</span>` +
    valueHtml +
    `</div>`
}

function renderAssert(block, doc) {
  const result = doc.results.get(block.id)
  const blockedMessage = !result ? issueFor(block.id, doc) : null
  const state = !result ? 'blocked' : result.error ? 'failed' : result.passed ? 'verified' : 'failed'
  return `<div class="aimdc-block aimdc-assert aimdc-state-${state}">` +
    `<span class="aimdc-badge aimdc-badge-assert">${t('aimdc.assert')}</span>` +
    `<code class="aimdc-expr">${esc(block.raw)}</code>` +
    `<span class="aimdc-state">${t(`aimdc.state.${state}`)}</span>` +
    (result?.error ? `<span class="aimdc-error-msg">${esc(result.error)}</span>`
      : blockedMessage ? `<span class="aimdc-error-msg">${esc(blockedMessage)}</span>` : '') +
    `</div>`
}

function renderTableBlock(block) {
  return renderRowsAsTable(block.rows)
}

function renderRowsAsTable(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
    return `<div class="aimdc-block aimdc-table">${t('aimdc.emptyTable')}</div>`
  }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r || {})))]
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('')
  const body = rows.map(r => `<tr>${cols.map(c => `<td>${esc(fmtValue(r[c]))}</td>`).join('')}</tr>`).join('')
  return `<div class="aimdc-block aimdc-table"><table class="aimdc-table-el"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderView(block, doc) {
  let value
  try {
    value = resolveRef(block.source, doc.byId, doc.results)
  } catch (e) {
    return `<div class="aimdc-block aimdc-view aimdc-state-failed"><span class="aimdc-error-msg">${esc(e.message)}</span></div>`
  }
  if (block.renderer === 'table' && Array.isArray(value)) return renderRowsAsTable(value)
  if (block.renderer === 'number') {
    const text = block.config.format ? formatNumber(value, block.config.format) : fmtValue(value)
    return `<div class="aimdc-block aimdc-view aimdc-view-number">${esc(text)}</div>`
  }
  // 'formula' (default) — typeset as "label = value" via the existing KaTeX
  // pass, which runs after this substitution in preview.js's own pipeline.
  const label = block.label || block.source.split('.').pop()
  return `<div class="aimdc-block aimdc-view aimdc-view-formula">$$${esc(label)} = ${esc(fmtValue(value))}$$</div>`
}

function renderError(block) {
  return `<div class="aimdc-block aimdc-error">` +
    `<span class="aimdc-badge aimdc-badge-error">${t('aimdc.state.invalid')}</span>` +
    (block.id ? `<span class="aimdc-id">${esc(block.id)}</span>` : '') +
    `<span class="aimdc-error-msg">${esc(block.message)}</span>` +
    `</div>`
}

// `{{ id.field }}` inline references — resolved after the whole document's
// blocks are evaluated, since a reference can point at any block regardless
// of document order (whitepaper §15.1: dependency-driven, not position-driven).
export function substituteInlineRefs(html, doc) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    try {
      return esc(fmtValue(resolveRef(path, doc.byId, doc.results)))
    } catch (e) {
      return `<span class="aimdc-error-msg">{{ ${esc(path)}: ${esc(e.message)} }}</span>`
    }
  })
}
