// ─── STATE MACHINE VIEW ───────────────────────────────────────────
// Renders a TransitionIR/state-machine YAML document (whitepaper
// compilableworld_studio_mssp_rdr_visual_world_ide_v0.1.md §3.3/§6.7) as an
// SVG diagram: states as boxes, transitions as labeled arrows. The YAML in
// the editor pane is still the authoritative source -- there is no separate
// save format -- but this view is no longer read-only (Neo: "可以直接點下去
// 可以用的" -- click-to-use, not just look-at): you can add/delete states
// and transitions by clicking, and the YAML is reconstructed and written
// back the same way entityview.js's Form View does it.
//
// Recognized shape (a single state machine per file, v0.1):
//   kind: state_machine
//   id: relation.acquaintance_to_friend
//   initial: acquaintance
//   states: [acquaintance, friend, ...]      # optional -- inferred from transitions if absent
//   transitions:
//     - from: acquaintance
//       to: friend
//       on: repeated_positive_interaction
//       guards: ["trust >= 0.45", "positive_interactions >= 5"]

import jsYaml from 'js-yaml'
import { validateStateMachine, unreachableStatesOf } from './validate.js'
import { renderDiagnosticsBlock } from './diagnostics.js'
import { editorGet, editorSet } from './editor.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

// Sniff without a full parse first -- previewUpdate() calls this on every
// keystroke (debounced), and a malformed in-progress YAML edit shouldn't
// throw mid-typing, it should just fall back to plain-text rendering.
export function isStateMachineDoc(src) {
  return /^\s*kind:\s*state_machine\b/m.test(src)
}

function parseStateMachine(src) {
  const doc = jsYaml.load(src)
  if (!doc || typeof doc !== 'object') throw new Error('not a YAML mapping')
  const transitions = Array.isArray(doc.transitions) ? doc.transitions : []
  const declared = Array.isArray(doc.states) ? doc.states : []
  const seen = new Set(declared)
  for (const t of transitions) {
    if (t.from) seen.add(t.from)
    if (t.to)   seen.add(t.to)
  }
  if (doc.initial) seen.add(doc.initial)
  return { doc, id: doc.id || '(unnamed)', initial: doc.initial || null, states: [...seen], transitions }
}

function renderSemanticRecords(doc) {
  const sections = [
    { key: 'variables', label: 'Variables', fields: ['id', 'type', 'default', 'random', 'description'] },
    { key: 'events', label: 'Events', fields: ['id', 'description', 'payload'] },
    { key: 'instructions', label: 'Language instructions', fields: ['id', 'intent', 'examples', 'description'] },
    { key: 'responses', label: 'Responses', fields: ['id', 'when', 'text', 'description'] },
  ]
  const active = sections.filter(section => Array.isArray(doc[section.key]) && doc[section.key].length)
  if (!active.length) return ''
  return `
    <div class="sm-semantic-grid">
      ${active.map(section => `
        <details class="sm-semantic-section" open>
          <summary>${esc(section.label)} <span>${doc[section.key].length}</span></summary>
          <div class="sm-semantic-records">
            ${doc[section.key].map((record, index) => {
              const item = record && typeof record === 'object' ? record : { value: record }
              const title = item.id || item.name || ('record-' + (index + 1))
              const fields = section.fields.filter(field => item[field] !== undefined)
              return `<article class="sm-semantic-record">
                <strong>${esc(title)}</strong>
                ${fields.map(field => {
                  const value = Array.isArray(item[field]) || (item[field] && typeof item[field] === 'object')
                    ? JSON.stringify(item[field])
                    : item[field]
                  return `<div><small>${esc(field)}</small><span>${esc(value)}</span></div>`
                }).join('')}
              </article>`
            }).join('')}
          </div>
        </details>
      `).join('')}
    </div>
  `
}

// Simple layered layout: states in one row (v0.1 -- no attempt at a general
// graph layout algorithm), transitions drawn as arrows between them. Good
// enough for the small guard-gated relationship/quest machines this is
// aimed at (whitepaper's own examples are 3-5 states); a real layout engine
// is explicitly out of scope until there's a real need for one.
export function renderStateMachine(src) {
  let sm
  try {
    sm = parseStateMachine(src)
  } catch (e) {
    return `<div class="sm-error">⚠ Not a valid state_machine document: ${esc(e.message)}</div>`
  }

  const issues = validateStateMachine(sm.doc)
  const unreachable = unreachableStatesOf(issues)

  const boxW = 150, boxH = 56, gapX = 90, gapY = 100
  const cols = Math.max(1, sm.states.length)
  const width = cols * boxW + (cols - 1) * gapX + 40
  const pos = new Map()
  sm.states.forEach((s, i) => pos.set(s, { x: 20 + i * (boxW + gapX), y: 30 }))

  // Self/back edges (to a state earlier in the row) get routed as an arc
  // below the row instead of overlapping forward edges.
  let maxArc = 0
  const edgesSvg = sm.transitions.map((t, i) => {
    const a = pos.get(t.from), b = pos.get(t.to)
    if (!a || !b) return ''
    const guardLabel = Array.isArray(t.guards) && t.guards.length ? t.guards.join(' ∧ ') : ''
    const onLabel = t.on ? `on ${t.on}` : ''
    const label = [onLabel, guardLabel].filter(Boolean).join('  ·  ')
    const forward = b.x >= a.x
    const y = boxH + 30
    if (forward) {
      const x1 = a.x + boxW, x2 = b.x
      const midX = (x1 + x2) / 2
      return `
        <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--sm-edge)" stroke-width="1.6" marker-end="url(#sm-arrow)"/>
        <text x="${midX}" y="${y - 8}" text-anchor="middle" class="sm-edge-label">${esc(label)}</text>
      `
    }
    // back-edge: arc below the row
    const arcY = boxH + 70 + (i % 3) * 34
    maxArc = Math.max(maxArc, arcY + 20)
    const x1 = a.x + boxW / 2, x2 = b.x + boxW / 2
    return `
      <path d="M ${x1} ${boxH} C ${x1} ${arcY}, ${x2} ${arcY}, ${x2} ${boxH}" fill="none" stroke="var(--sm-edge)" stroke-width="1.6" marker-end="url(#sm-arrow)"/>
      <text x="${(x1+x2)/2}" y="${arcY + 14}" text-anchor="middle" class="sm-edge-label">${esc(label)}</text>
    `
  }).join('\n')

  const nodesSvg = sm.states.map(s => {
    const p = pos.get(s)
    const isInitial = s === sm.initial
    const isUnreachable = unreachable.has(s)
    const cls = ['sm-node', isInitial && 'sm-node-initial', isUnreachable && 'sm-node-unreachable'].filter(Boolean).join(' ')
    return `
      <g class="${cls}">
        <rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="8"/>
        <text x="${p.x + boxW/2}" y="${p.y + boxH/2 + 5}" text-anchor="middle">${esc(s)}${isUnreachable ? ' ⚠' : ''}</text>
        <text class="sm-node-delete" data-state="${esc(s)}" x="${p.x + boxW - 8}" y="${p.y + 15}" text-anchor="middle" title="Delete state">✕</text>
      </g>
    `
  }).join('\n')

  const height = Math.max(boxH + 60, maxArc + 20)
  const stateOptions = sm.states.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')

  return `
    <div class="sm-view">
      <div class="sm-header">
        <span class="sm-id">${esc(sm.id)}</span>
        ${sm.initial ? `<span class="sm-initial-tag">initial: ${esc(sm.initial)}</span>` : ''}
        <span class="sm-count">${sm.states.length} states · ${sm.transitions.length} transitions</span>
      </div>
      <svg viewBox="0 0 ${width} ${height + 30}" width="100%" style="max-width:${width}px">
        <defs>
          <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--sm-edge)"/>
          </marker>
        </defs>
        <g transform="translate(0,${boxH})">${edgesSvg}</g>
        ${nodesSvg}
      </svg>
      ${renderDiagnosticsBlock(issues)}
      ${renderSemanticRecords(sm.doc)}

      <div class="sm-editor-controls">
        <div class="sm-add-row">
          <input type="text" class="sm-new-state-input" placeholder="new state name">
          <button class="btn-s sm-add-state-btn">+ Add State</button>
        </div>
        <div class="sm-add-row sm-add-transition">
          <select class="sm-tx-from">${stateOptions}</select>
          <span class="sm-arrow-glyph">→</span>
          <select class="sm-tx-to">${stateOptions}</select>
          <input type="text" class="sm-tx-on" placeholder="on: event_name">
          <input type="text" class="sm-tx-guards" placeholder="guards (separate with |)">
          <button class="btn-s sm-add-tx-btn">+ Add Transition</button>
        </div>
      </div>

      <details class="sm-raw">
        <summary>Raw transitions</summary>
        <table class="sm-table">
          <thead><tr><th>from</th><th>to</th><th>on</th><th>guards</th><th></th></tr></thead>
          <tbody>
            ${sm.transitions.map((t, i) => `<tr>
              <td>${esc(t.from ?? '')}</td>
              <td>${esc(t.to ?? '')}</td>
              <td>${esc(t.on ?? '')}</td>
              <td>${Array.isArray(t.guards) ? t.guards.map(g => `<code>${esc(g)}</code>`).join('<br>') : ''}</td>
              <td><button class="sm-tx-delete" data-index="${i}" title="Delete transition">✕</button></td>
            </tr>`).join('\n')}
          </tbody>
        </table>
      </details>
    </div>
  `
}

// Re-reads the editor fresh each time (not the closure's `sm.doc` from
// whatever render call happened to wire this listener) so a rapid sequence
// of clicks always mutates the current on-disk-pending state, not a stale
// snapshot -- same defensive pattern as entityview.js's wireEntityFormInteractions.
function withCurrentDoc(mutate) {
  let doc
  try {
    doc = jsYaml.load(editorGet())
  } catch {
    return   // editor content isn't valid YAML right now -- nothing safe to write back
  }
  if (!doc || typeof doc !== 'object') return
  mutate(doc)
  editorSet(jsYaml.dump(doc))
}

let smWired = false
export function wireStateMachineInteractions(el) {
  if (smWired || !el) return
  smWired = true

  el.addEventListener('click', (e) => {
    const addStateBtn = e.target.closest('.sm-add-state-btn')
    if (addStateBtn) {
      const input = el.querySelector('.sm-new-state-input')
      const name = input?.value.trim()
      if (!name) return
      withCurrentDoc(doc => {
        if (!Array.isArray(doc.states)) doc.states = []
        if (!doc.states.includes(name)) doc.states.push(name)
      })
      return
    }

    const delStateBtn = e.target.closest('.sm-node-delete')
    if (delStateBtn) {
      const state = delStateBtn.dataset.state
      withCurrentDoc(doc => {
        if (Array.isArray(doc.states)) {
          doc.states = doc.states.filter(s => s !== state)
          if (!doc.states.length) delete doc.states   // don't leave a dangling `states: []` once the last explicit entry is gone -- states are inferred from transitions anyway
        }
        if (Array.isArray(doc.transitions)) doc.transitions = doc.transitions.filter(t => t.from !== state && t.to !== state)
      })
      return
    }

    const addTxBtn = e.target.closest('.sm-add-tx-btn')
    if (addTxBtn) {
      const from = el.querySelector('.sm-tx-from')?.value
      const to = el.querySelector('.sm-tx-to')?.value
      const on = el.querySelector('.sm-tx-on')?.value.trim()
      const guardsRaw = el.querySelector('.sm-tx-guards')?.value.trim()
      if (!from || !to || !on) return
      const guards = guardsRaw ? guardsRaw.split('|').map(g => g.trim()).filter(Boolean) : undefined
      withCurrentDoc(doc => {
        if (!Array.isArray(doc.transitions)) doc.transitions = []
        const transition = { from, to, on }
        if (guards?.length) transition.guards = guards
        doc.transitions.push(transition)
      })
      return
    }

    const delTxBtn = e.target.closest('.sm-tx-delete')
    if (delTxBtn) {
      const index = Number(delTxBtn.dataset.index)
      withCurrentDoc(doc => {
        if (Array.isArray(doc.transitions)) doc.transitions.splice(index, 1)
      })
    }
  })
}
