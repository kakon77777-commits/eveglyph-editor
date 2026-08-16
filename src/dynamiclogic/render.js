// ─── DYNAMIC LOGIC BROWSER RENDERING ───────────────────────────────────────
// Rendering only: no judgment mutation here. Motion is driven by actual replay
// cursor/state changes; idle views stay still. Canonical Markdown and disk state
// are never rewritten by replay or playback.
import './styles.css'
import { getReplayCursor, setReplayCursor } from './replay.js'
import { annotateDynamicMotion } from './motion.js'
import { isReplayPlaying, stopReplayPlayback, toggleReplayPlayback, returnToLive } from './playback.js'

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

function ensureMotion(doc) {
  return annotateDynamicMotion(doc)
}

function judgmentEntryForClaim(doc, claimId) {
  for (const [id, result] of doc.results) {
    const block = doc.byId.get(id)
    if (block?.kind === 'dl-judgment' && block.claim === claimId) return { id, result }
  }
  return null
}

function evidenceStep(block, doc) {
  const ordered = doc.blocks
    .map((b, sourceIndex) => ({ block: b, sourceIndex }))
    .filter(x => x.block.kind === 'dl-evidence' && x.block.claim === block.claim)
    .sort((a, b) => {
      const as = a.block.sequence ?? a.sourceIndex
      const bs = b.block.sequence ?? b.sourceIndex
      return as - bs || a.sourceIndex - b.sourceIndex
    })
  const i = ordered.findIndex(x => x.block.id === block.id)
  return i < 0 ? null : i + 1
}

function deltaHtml(delta) {
  if (!Number.isFinite(delta) || delta === 0) return ''
  const sign = delta > 0 ? '+' : ''
  const cls = delta > 0 ? 'dl-delta-up' : 'dl-delta-down'
  return `<span class="dl-metric-delta ${cls}">${sign}${Math.round(delta * 100)}%</span>`
}

function metricHtml(label, value, delta) {
  const changed = Number.isFinite(delta) && delta !== 0
  return `<div class="dl-metric${changed ? ' changed' : ''}">` +
    `<span class="dl-metric-label">${esc(label)}</span><br>` +
    `<span class="dl-metric-value">${pct(value)}</span>${deltaHtml(delta)}` +
    `</div>`
}

function transitionSummary(motion) {
  if (!motion?.changed || !motion.previous) return ''
  const parts = []
  if (motion.stateChanged) {
    parts.push(`${stateLabel(motion.previous.state)} → ${stateLabel(motion.current.state)}`)
  } else if (motion.cursorDelta !== 0) {
    parts.push(`Evidence step ${motion.previous.evidenceCursor} → ${motion.current.evidenceCursor}`)
  }
  if (Number.isFinite(motion.supportDelta) && motion.supportDelta !== 0) {
    const sign = motion.supportDelta > 0 ? '+' : ''
    parts.push(`support Δ ${sign}${Math.round(motion.supportDelta * 100)}%`)
  }
  return parts.length ? `<div class="dl-transition-summary">${esc(parts.join(' · '))}</div>` : ''
}

export function renderDynamicLogicBlock(block, rawDoc) {
  const doc = ensureMotion(rawDoc)

  if (block.kind === 'dl-error') {
    return `<div class="cfp-block cfp-warning"><div class="cfp-label">DYNAMIC LOGIC ERROR</div><div>${esc(block.message)}</div></div>`
  }

  if (block.kind === 'dl-claim') {
    return `<div class="cfp-block cfp-definition"><div class="cfp-label">CLAIM · ${esc(block.id)}</div><div>${esc(block.statement)}</div></div>`
  }

  if (block.kind === 'dl-evidence') {
    const arrow = block.direction === 'support' ? '↑' : block.direction === 'oppose' ? '↓' : '·'
    const entry = judgmentEntryForClaim(doc, block.claim)
    const step = evidenceStep(block, doc)
    const motion = entry ? doc.motionByJudgment.get(entry.id) : null
    const cursor = entry?.result?.replayCursor ?? null
    const reached = step === null || cursor === null || step <= cursor
    const arrived = reached && motion?.cursorDelta > 0 && motion.previous && step > motion.previous.evidenceCursor && step <= motion.current.evidenceCursor
    const rewound = !reached && motion?.cursorDelta < 0 && motion.previous && step > motion.current.evidenceCursor && step <= motion.previous.evidenceCursor
    const classes = [
      'cfp-block', 'cfp-note', 'dynamic-evidence',
      reached ? 'dl-evidence-reached' : 'dl-evidence-pending',
      arrived ? 'dl-evidence-arrived' : '',
      rewound ? 'dl-evidence-rewound' : '',
    ].filter(Boolean).join(' ')

    return `<div class="${classes}">` +
      `<div class="cfp-label">EVIDENCE ${arrow} · ${esc(block.id)}</div>` +
      `<div><b>${esc(block.direction)}</b> · ${esc(block.sourceType)} · weight ${esc(block.weight)} · ${block.verified ? 'verified' : 'unverified'}</div>` +
      `<div style="color:var(--t2);font-size:11px;margin-top:4px">${esc(block.label)}</div>` +
      `</div>`
  }

  if (block.kind === 'dl-judgment') {
    const result = doc.results.get(block.id)
    const issue = issueFor(block.id, doc)
    if (!result) {
      return `<div class="cfp-block cfp-warning"><div class="cfp-label">JUDGMENT · ${esc(block.id)}</div><div>${esc(issue || 'No result')}</div></div>`
    }
    const s = result.state
    const motion = doc.motionByJudgment.get(block.id)
    const replay = result.replayCursor !== result.evidenceCount
    const classes = [
      'cfp-block', 'cfp-theorem', 'dynamic-judgment', `dl-state-${s.state}`,
      motion?.changed ? 'dl-motion-change' : '',
      motion?.stateChanged ? 'dl-motion-state-change' : '',
    ].filter(Boolean).join(' ')

    return `<div class="${classes}" data-dl-judgment="${esc(block.id)}">` +
      `<div class="cfp-label">JUDGMENT · ${esc(block.id)}${replay ? ' · REPLAY' : ' · LIVE'}</div>` +
      `<div class="dl-state-title"><span class="dl-state-dot"></span><span>${esc(stateLabel(s.state))}</span></div>` +
      transitionSummary(motion) +
      `<div class="dl-metric-grid">` +
      metricHtml('Support', s.support_score, motion?.supportDelta) +
      metricHtml('Counterpressure', s.counterpressure, motion?.counterpressureDelta) +
      metricHtml('Completeness', s.evidence_completeness, motion?.completenessDelta) +
      `</div>` +
      `<div style="color:var(--t3);font-size:10px;margin-top:7px">Evidence step ${result.replayCursor}/${result.evidenceCount} · runtime 0.1.0</div>` +
      `</div>`
  }

  if (block.kind === 'dl-history') {
    const history = doc.historyByClaim.get(block.claim) || []
    const evidenceCount = doc.blocks.filter(b => b.kind === 'dl-evidence' && b.claim === block.claim).length
    const replayKey = doc.replayKeysByClaim.get(block.claim) || block.claim
    const cursor = getReplayCursor(replayKey, evidenceCount)
    const playing = isReplayPlaying(replayKey)
    const progress = evidenceCount ? Math.round((cursor / evidenceCount) * 100) : 0
    const items = history.map((h, i) => `<li class="${i === history.length - 1 ? 'dl-history-current' : ''}" style="margin:3px 0"><code>${esc(h.sequence)}</code> ${esc(h.type)} → <b>${esc(stateLabel(h.state))}</b>${h.label ? ` · ${esc(h.label)}` : ''}</li>`).join('')

    return `<div class="cfp-block cfp-note dynamic-history" data-dl-replay-key="${esc(replayKey)}" data-dl-max="${evidenceCount}">` +
      `<div class="cfp-label">JUDGMENT HISTORY · ${esc(block.claim)}</div>` +
      `<div class="dl-replay-controls">` +
      `<button type="button" class="btn-s dl-replay-prev" aria-label="Previous evidence step">←</button>` +
      `<button type="button" class="btn-s dl-replay-play${playing ? ' is-playing' : ''}" aria-label="${playing ? 'Pause replay' : 'Play replay'}">${playing ? '⏸ Pause' : '▶ Play'}</button>` +
      `<button type="button" class="btn-s dl-replay-next" aria-label="Next evidence step">→</button>` +
      `<button type="button" class="btn-s dl-replay-live">Live</button>` +
      `<span style="color:var(--t2);font-size:11px">Evidence step ${cursor}/${evidenceCount}</span>` +
      `</div>` +
      `<div class="dl-timeline-track" aria-hidden="true"><span class="dl-timeline-progress" style="width:${progress}%"></span></div>` +
      `<ol style="padding-left:20px;font-size:11px;line-height:1.45">${items || '<li>No events at this replay position.</li>'}</ol>` +
      `</div>`
  }

  return ''
}

export function wireDynamicLogicInteractions(root, refresh) {
  root.querySelectorAll('.dynamic-history').forEach(el => {
    const replayKey = el.dataset.dlReplayKey
    const max = Number(el.dataset.dlMax || 0)

    el.querySelector('.dl-replay-prev')?.addEventListener('click', () => {
      stopReplayPlayback(replayKey)
      setReplayCursor(replayKey, getReplayCursor(replayKey, max) - 1, max)
      refresh()
    })

    el.querySelector('.dl-replay-next')?.addEventListener('click', () => {
      stopReplayPlayback(replayKey)
      setReplayCursor(replayKey, getReplayCursor(replayKey, max) + 1, max)
      refresh()
    })

    el.querySelector('.dl-replay-play')?.addEventListener('click', () => {
      toggleReplayPlayback(replayKey, max, refresh)
    })

    el.querySelector('.dl-replay-live')?.addEventListener('click', () => {
      returnToLive(replayKey, refresh)
    })
  })
}
