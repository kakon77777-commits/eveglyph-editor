// ─── DYNAMIC LOGIC PREVIEW RENDERING ──────────────────────────────────────
// Rendering only: no judgment mutation here. Replay controls change an
// in-memory projection cursor and ask previewUpdate() to render that historical
// prefix again; canonical source and disk state stay untouched.
import { clearReplayCursor, getReplayCursor, setReplayCursor } from './replay.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const pct = (n) => n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`

function stateLabel(state) {
  return ({
    open: 'Ω Open',
    generating: 'Ω Generating',
    conflicted: 'Ω Conflicted',
    provisionally_true: '⊤ Provisional support',
    provisionally_false: '⊥ Provisional oppose',
  })[state] || state
}

function issueFor(id, doc) {
  return doc.issues.find(i => i.id === id)?.message || null
}

export function renderDynamicLogicBlock(block, doc) {
  if (block.kind === 'dl-error') {
    return `<div class="cfp-block cfp-warning"><div class="cfp-label">DYNAMIC LOGIC ERROR</div><div>${esc(block.message)}</div></div>`
  }

  if (block.kind === 'dl-claim') {
    return `<div class="cfp-block cfp-definition"><div class="cfp-label">CLAIM · ${esc(block.id)}</div><div>${esc(block.statement)}</div></div>`
  }

  if (block.kind === 'dl-evidence') {
    const arrow = block.direction === 'support' ? '↑' : block.direction === 'oppose' ? '↓' : '·'
    return `<div class="cfp-block cfp-note"><div class="cfp-label">EVIDENCE ${arrow} · ${esc(block.id)}</div>` +
      `<div><b>${esc(block.direction)}</b> · ${esc(block.sourceType)} · weight ${esc(block.weight)} · ${block.verified ? 'verified' : 'unverified'}</div>` +
      `<div style="color:var(--t2);font-size:11px;margin-top:4px">${esc(block.label)}</div></div>`
  }

  if (block.kind === 'dl-judgment') {
    const result = doc.results.get(block.id)
    const issue = issueFor(block.id, doc)
    if (!result) {
      return `<div class="cfp-block cfp-warning"><div class="cfp-label">JUDGMENT · ${esc(block.id)}</div><div>${esc(issue || 'No result')}</div></div>`
    }
    const s = result.state
    const replay = result.replayCursor !== result.evidenceCount
    return `<div class="cfp-block cfp-theorem">` +
      `<div class="cfp-label">JUDGMENT · ${esc(block.id)}${replay ? ' · REPLAY' : ''}</div>` +
      `<div style="font-size:15px;font-weight:600;margin-bottom:7px">${esc(stateLabel(s.state))}</div>` +
      `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:11px">` +
      `<div><span style="color:var(--t2)">Support</span><br><b>${pct(s.support_score)}</b></div>` +
      `<div><span style="color:var(--t2)">Counterpressure</span><br><b>${pct(s.counterpressure)}</b></div>` +
      `<div><span style="color:var(--t2)">Completeness</span><br><b>${pct(s.evidence_completeness)}</b></div>` +
      `</div>` +
      `<div style="color:var(--t3);font-size:10px;margin-top:7px">Evidence step ${result.replayCursor}/${result.evidenceCount} · runtime ${esc('0.1.0')}</div>` +
      `</div>`
  }

  if (block.kind === 'dl-history') {
    const history = doc.historyByClaim.get(block.claim) || []
    const evidenceCount = doc.blocks.filter(b => b.kind === 'dl-evidence' && b.claim === block.claim).length
    const cursor = getReplayCursor(block.claim, evidenceCount)
    const items = history.map(h => `<li style="margin:3px 0"><code>${esc(h.sequence)}</code> ${esc(h.type)} → <b>${esc(stateLabel(h.state))}</b>${h.label ? ` · ${esc(h.label)}` : ''}</li>`).join('')
    return `<div class="cfp-block cfp-note dynamic-history" data-dl-claim="${esc(block.claim)}" data-dl-max="${evidenceCount}">` +
      `<div class="cfp-label">JUDGMENT HISTORY · ${esc(block.claim)}</div>` +
      `<div style="display:flex;align-items:center;gap:6px;margin:6px 0 8px">` +
      `<button type="button" class="btn-s dl-replay-prev">←</button>` +
      `<button type="button" class="btn-s dl-replay-next">→</button>` +
      `<button type="button" class="btn-s dl-replay-live">Live</button>` +
      `<span style="color:var(--t2);font-size:11px">Evidence step ${cursor}/${evidenceCount}</span>` +
      `</div>` +
      `<ol style="padding-left:20px;font-size:11px;line-height:1.45">${items || '<li>No events at this replay position.</li>'}</ol>` +
      `</div>`
  }

  return ''
}

export function wireDynamicLogicInteractions(root, refresh) {
  root.querySelectorAll('.dynamic-history').forEach(el => {
    const claim = el.dataset.dlClaim
    const max = Number(el.dataset.dlMax || 0)
    el.querySelector('.dl-replay-prev')?.addEventListener('click', () => {
      setReplayCursor(claim, getReplayCursor(claim, max) - 1, max)
      refresh()
    })
    el.querySelector('.dl-replay-next')?.addEventListener('click', () => {
      setReplayCursor(claim, getReplayCursor(claim, max) + 1, max)
      refresh()
    })
    el.querySelector('.dl-replay-live')?.addEventListener('click', () => {
      clearReplayCursor(claim)
      refresh()
    })
  })
}
