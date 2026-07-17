// ─── AMEP method-pack integration (whitepaper §3, resolved 2026-07-14) ─────
// §3 was a three-way open decision: keep the 8 presets as-is / fold 1-2 AMEP
// method packs into the preset system / build a full local run-pack layer. This
// is the middle option — but instead of reimplementing RigorLoop's logic here,
// it calls Neo's already-shipped AMEP project (evemisstechnology.com/amep)
// directly. Its browser SDK is explicitly built for cross-origin use (its own
// header comment gives the exact import pattern for an external site), and CORS
// was confirmed open on every asset it needs, live, before writing this.
//
// Honesty notes baked into this file, not just the docs:
//   - AMEP has NO hosted API (deliberately deferred in its own v0.1 design docs).
//     Real execution runs via Pyodide IN THE USER'S OWN BROWSER TAB. The first
//     real run in a session downloads ~14MB (Pyodide + stdlib + all 5 packs'
//     source, bundled together) — cached after that, but not free the first time.
//   - RigorLoop is a heuristic marker/keyword scanner (regex-ish claim/citation/
//     equivalence pattern matching), not a theorem prover or LLM call. The result
//     rendering doesn't oversell it.
const AMEP_SDK_URL = 'https://evemisstechnology.com/amep/runtime/browser.js'
const AMEP_VERSION = '0.1'

let sdkPromise = null
function loadSdk() {
  // A literal cross-origin URL passed to a RUNTIME dynamic import(), not a static
  // top-level `import` statement — Vite has a known quirk mishandling some
  // cross-origin/public-asset module specifiers at build time (AMEP's own site hit
  // an adjacent version of this bug in its Astro playground); a dynamic import that
  // only fires on an actual user click sidesteps it. /* @vite-ignore */ stops Vite
  // from trying to statically analyze/rewrite a URL it can't resolve at build time.
  if (!sdkPromise) sdkPromise = import(/* @vite-ignore */ AMEP_SDK_URL)
  return sdkPromise
}

import { t } from './i18n/index.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export async function runAmepPreset(packId, text) {
  const wrap = document.getElementById('ai-resp-wrap')
  const resp = document.getElementById('ai-resp')
  wrap.style.display = 'flex'
  resp.className = 'loading'
  resp.innerHTML = `<span class="spinner"></span> ${t('amepDynamic.loading')}`

  const { monitor } = await import('./monitor.js')
  await monitor('amep:run:start', { pack: packId, textBytes: text.length })

  try {
    const sdk = await loadSdk()
    resp.innerHTML = `<span class="spinner"></span> ${t('amepDynamic.running', { pack: esc(packId) })}`
    const result = await sdk.runAMEP({
      amep_version: AMEP_VERSION,
      pack: { id: packId, version: '0.1.0' },
      task: { type: 'audit', content: text },
      runtime: { mode: 'browser', trace: false }
    })
    resp.className = ''
    resp.innerHTML = renderAmepResult(packId, result)
    await monitor('amep:run:success', { pack: packId, status: result?.status })
  } catch (e) {
    resp.className = 'err'
    resp.textContent = t('amepDynamic.failed', { pack: packId, message: e.message })
    await monitor('amep:run:error', { pack: packId, error: String(e?.message || e) })
  }
}

function findingRow(f) {
  const sev = String(f.severity || 'info').toLowerCase().replace(/[^a-z]/g, '') || 'info'
  return `<div class="amep-finding amep-sev-${sev}">
    <span class="amep-sev-tag">${esc(f.severity || '')}</span>
    <span class="amep-msg">${esc(f.message || f.claim || '')}</span>
    ${f.recommendation ? `<div class="amep-rec">${esc(f.recommendation)}</div>` : ''}
  </div>`
}

function renderAmepResult(packId, result) {
  const data = result?.data || {}
  const refl = data.reflection || {}
  const status = result?.status || 'unknown'
  const statusClass = status === 'completed' ? 'ok' : status === 'partial' ? 'warn' : 'err'

  const groups = [
    [t('amepDynamic.witnessFindings'), data.witness_findings],
    [t('amepDynamic.equivalenceFindings'), data.equivalence_findings],
    [t('amepDynamic.citationFindings'), data.citation_findings],
    [t('amepDynamic.fractures'), data.fractures],
  ]

  const totalFindings = (refl.witness_findings || 0) + (refl.equivalence_findings || 0) + (refl.citation_findings || 0)

  let html = `<div class="amep-result">
    <div class="amep-head">
      <span class="amep-badge amep-badge-${statusClass}">${esc(status)}</span>
      <span class="amep-pack-name">${esc(packId)} · AMEP v${esc(result?.amep_version || '')}</span>
    </div>
    <div class="amep-summary">${t('amepDynamic.summary', { claims: refl.claims_checked ?? 0, findings: totalFindings, fractures: refl.fractures ?? 0 })}</div>`

  for (const [label, items] of groups) {
    if (!items || !items.length) continue
    html += `<div class="amep-group"><div class="amep-group-h">${esc(label)} (${items.length})</div>`
    html += items.map(findingRow).join('')
    html += `</div>`
  }

  if (Array.isArray(refl.next_actions) && refl.next_actions.length) {
    html += `<div class="amep-group"><div class="amep-group-h">${t('amepDynamic.nextActions')}</div><ul class="amep-actions">`
    html += refl.next_actions.map(a => `<li>${esc(a)}</li>`).join('')
    html += `</ul></div>`
  }

  if (!totalFindings && !(refl.next_actions || []).length) {
    html += `<div class="amep-empty">${t('amepDynamic.noFindings')}</div>`
  }

  html += `<div class="amep-footnote">${t('amepDynamic.footnote')}</div>`
  html += `</div>`
  return html
}
