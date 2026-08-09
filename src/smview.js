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
// Aliased: this file uses `t` extensively as a transition-object variable name.
import { t as i18n } from './i18n/index.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

const SM_RUNTIME_LIMITS = Object.freeze({
  requirements: 32,
  eventMatchFields: 16,
  priority: 1000000,
  rewardCurrency: 1000000000,
})
const REQUIREMENT_RE = /^(reach:[a-z][a-z0-9_.-]*|deliver:[a-z][a-z0-9_.-]*:[a-z][a-z0-9_.-]*)$/
const EVENT_MATCH_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function isJsonScalar(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
}

function parseTransitionField(field) {
  const name = field.dataset.field
  let value = field.value
  if (name === 'guards' || name === 'requirements') {
    value = value.split('|').map(item => item.trim()).filter(Boolean)
    if (name === 'requirements' && (value.length > SM_RUNTIME_LIMITS.requirements || value.some(item => !REQUIREMENT_RE.test(item)))) {
      return { valid: false }
    }
  } else if (name === 'priority') {
    value = Number(value)
    if (!Number.isInteger(value) || value < 0 || value > SM_RUNTIME_LIMITS.priority) return { valid: false }
  } else if (name === 'event_match') {
    try { value = JSON.parse(value || '{}') } catch (_) { return { valid: false } }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > SM_RUNTIME_LIMITS.eventMatchFields) {
      return { valid: false }
    }
    if (Object.entries(value).some(([key, item]) => !EVENT_MATCH_KEY_RE.test(key) || !isJsonScalar(item))) return { valid: false }
  } else if (name === 'reward_currency') {
    if (value.trim() === '') value = null
    else {
      value = Number(value)
      if (!Number.isInteger(value) || value < 0 || value > SM_RUNTIME_LIMITS.rewardCurrency) return { valid: false }
    }
  }
  return { valid: true, value }
}

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
    { key: 'variables', label: i18n('smview.variables'), fields: ['id', 'type', 'default', 'random', 'description'] },
    { key: 'events', label: i18n('smview.events'), fields: ['id', 'description', 'payload'] },
    { key: 'instructions', label: i18n('smview.instructions'), fields: ['id', 'intent', 'examples', 'description'] },
    { key: 'responses', label: i18n('smview.responses'), fields: ['id', 'when', 'text', 'description'] },
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

// Semantic records stay JSON-shaped because their fields are extensible
// authoring metadata, not Runtime rules. The inspector edits one record at a
// time without silently dropping fields unknown to the current UI.
function renderSemanticRecordEditors(doc) {
  const sections = [
    { key: 'variables', label: i18n('smview.variables') },
    { key: 'events', label: i18n('smview.events') },
    { key: 'instructions', label: i18n('smview.instructions') },
    { key: 'responses', label: i18n('smview.responses') },
  ]
  return `
    <div class="sm-semantic-grid sm-semantic-editors">
      ${sections.map(section => {
        const records = Array.isArray(doc[section.key]) ? doc[section.key] : []
        return `
          <details class="sm-semantic-section" open>
            <summary>${esc(section.label)} <span>${records.length}</span></summary>
            <div class="sm-semantic-records">
              ${records.map((record, index) => `
                <article class="sm-semantic-record-editor">
                  <div class="sm-record-toolbar">
                    <strong>${esc(record?.id || record?.name || `${section.key}.${index + 1}`)}</strong>
                    <button class="btn-s sm-record-delete" data-record-key="${esc(section.key)}" data-record-index="${index}" type="button">${i18n('smview.deleteRecord')}</button>
                  </div>
                  <textarea class="sm-record-json" data-record-key="${esc(section.key)}" data-record-index="${index}" spellcheck="false">${esc(JSON.stringify(record ?? {}, null, 2))}</textarea>
                  <button class="btn-s sm-record-save" data-record-key="${esc(section.key)}" data-record-index="${index}" type="button">${i18n('smview.saveRecord')}</button>
                </article>
              `).join('') || `<span class="studio-dim">${i18n('smview.noRecords')}</span>`}
            </div>
            <button class="btn-s sm-record-add" data-record-key="${esc(section.key)}" type="button">+ ${i18n('smview.addRecord')}</button>
          </details>
        `
      }).join('')}
    </div>
  `
}

function optionList(states, selected) {
  return states.map(state => `<option value="${esc(state)}"${state === selected ? ' selected' : ''}>${esc(state)}</option>`).join('')
}

function renderTransitionEditors(sm) {
  return `
    <div class="sm-transition-editors">
      <div class="sm-editor-section-title">${i18n('smview.transitionEditor')}</div>
      ${sm.transitions.map((transition, index) => `
        <article class="sm-transition-editor">
          <div class="sm-transition-editor-head">
            <strong>${esc(transition.transition_id || `transition.${index + 1}`)}</strong>
            <button class="btn-s sm-tx-delete" data-index="${index}" title="${i18n('smview.deleteTransition')}" type="button">✕</button>
          </div>
          <div class="sm-transition-grid">
            <label>from<select class="sm-tx-field" data-index="${index}" data-field="from">${optionList(sm.states, transition.from)}</select></label>
            <label>to<select class="sm-tx-field" data-index="${index}" data-field="to">${optionList(sm.states, transition.to)}</select></label>
            <label>on<input class="sm-tx-field" data-index="${index}" data-field="on" value="${esc(transition.on ?? '')}"></label>
            <label>priority<input class="sm-tx-field" data-index="${index}" data-field="priority" type="number" min="0" step="1" value="${esc(transition.priority ?? 0)}"></label>
            <label class="sm-wide-field">guards<textarea class="sm-tx-field" data-index="${index}" data-field="guards" spellcheck="false">${esc(Array.isArray(transition.guards) ? transition.guards.join(' | ') : '')}</textarea></label>
            <label class="sm-wide-field">requirements<input class="sm-tx-field" data-index="${index}" data-field="requirements" value="${esc(Array.isArray(transition.requirements) ? transition.requirements.join(' | ') : '')}" placeholder="reach:room.id | deliver:item.id:target.id"></label>
            <label class="sm-wide-field">event_match (JSON)<textarea class="sm-tx-field sm-json-field" data-index="${index}" data-field="event_match" spellcheck="false">${esc(JSON.stringify(transition.event_match ?? {}, null, 2))}</textarea></label>
            <label>reward.currency<input class="sm-tx-field" data-index="${index}" data-field="reward_currency" type="number" min="0" step="1" value="${esc(transition.reward?.currency ?? '')}"></label>
          </div>
        </article>
      `).join('') || `<span class="studio-dim">${i18n('smview.noTransitions')}</span>`}
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
    return `<div class="sm-error">${i18n('smview.invalidDoc', { message: esc(e.message) })}</div>`
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
        <text class="sm-node-delete" data-state="${esc(s)}" x="${p.x + boxW - 8}" y="${p.y + 15}" text-anchor="middle" title="${i18n('smview.deleteState')}">✕</text>
      </g>
    `
  }).join('\n')

  const height = Math.max(boxH + 60, maxArc + 20)
  const stateOptions = sm.states.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')

  return `
    <div class="sm-view">
      <div class="sm-header">
        <span class="sm-id">${esc(sm.id)}</span>
        <label class="sm-initial-control">${i18n('smview.initial')} <select class="sm-initial-select">${optionList(sm.states, sm.initial)}</select></label>
        <span class="sm-count">${i18n('smview.stateCount', { states: sm.states.length, transitions: sm.transitions.length })}</span>
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
      ${renderSemanticRecordEditors(sm.doc)}

      <div class="sm-editor-controls">
        <div class="sm-add-row">
          <input type="text" class="sm-new-state-input" placeholder="${i18n('smview.newStatePlaceholder')}">
          <button class="btn-s sm-add-state-btn">${i18n('smview.addState')}</button>
        </div>
        <div class="sm-add-row sm-add-transition">
          <select class="sm-tx-from">${stateOptions}</select>
          <span class="sm-arrow-glyph">→</span>
          <select class="sm-tx-to">${stateOptions}</select>
          <input type="text" class="sm-tx-on" placeholder="${i18n('smview.onEventPlaceholder')}">
          <input type="text" class="sm-tx-guards" placeholder="${i18n('smview.guardsPlaceholder')}">
          <input type="text" class="sm-tx-requirements" placeholder="${i18n('smview.requirementsPlaceholder')}">
          <input type="number" class="sm-tx-priority" min="0" step="1" value="0" title="priority">
          <button class="btn-s sm-add-tx-btn">${i18n('smview.addTransition')}</button>
        </div>
      </div>

      ${renderTransitionEditors(sm)}

      <details class="sm-raw">
        <summary>${i18n('smview.rawTransitions')}</summary>
        <table class="sm-table">
          <thead><tr><th>${i18n('smview.thFrom')}</th><th>${i18n('smview.thTo')}</th><th>${i18n('smview.thOn')}</th><th>${i18n('smview.thGuards')}</th><th></th></tr></thead>
          <tbody>
            ${sm.transitions.map((t, i) => `<tr>
              <td>${esc(t.from ?? '')}</td>
              <td>${esc(t.to ?? '')}</td>
              <td>${esc(t.on ?? '')}</td>
              <td>${Array.isArray(t.guards) ? t.guards.map(g => `<code>${esc(g)}</code>`).join('<br>') : ''}</td>
              <td><button class="sm-tx-delete" data-index="${i}" title="${i18n('smview.deleteTransition')}">✕</button></td>
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
    return false   // editor content isn't valid YAML right now -- nothing safe to write back
  }
  if (!doc || typeof doc !== 'object') return false
  mutate(doc)
  editorSet(jsYaml.dump(doc))
  return true
}

function commitTransitionField(field) {
  if (field.dataset.lastCommittedValue === field.value) return true
  const parsed = parseTransitionField(field)
  if (!parsed.valid) {
    field.classList.add('sm-invalid-field')
    return false
  }
  const index = Number(field.dataset.index)
  const name = field.dataset.field
  const committed = withCurrentDoc(doc => {
    const transition = Array.isArray(doc.transitions) ? doc.transitions[index] : null
    if (!transition) return
    if (name === 'reward_currency') {
      if (parsed.value === null) delete transition.reward
      else transition.reward = { ...(transition.reward && typeof transition.reward === 'object' ? transition.reward : {}), currency: parsed.value }
    } else if (parsed.value === '' || (Array.isArray(parsed.value) && parsed.value.length === 0 && ['guards', 'requirements'].includes(name))) {
      delete transition[name]
    } else {
      transition[name] = parsed.value
    }
  })
  if (!committed) return false
  field.classList.remove('sm-invalid-field')
  field.dataset.lastCommittedValue = field.value
  return true
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
        if (doc.initial === state) doc.initial = doc.states?.[0] || undefined
      })
      return
    }

    const addTxBtn = e.target.closest('.sm-add-tx-btn')
    if (addTxBtn) {
      const from = el.querySelector('.sm-tx-from')?.value
      const to = el.querySelector('.sm-tx-to')?.value
      const on = el.querySelector('.sm-tx-on')?.value.trim()
      const guardsRaw = el.querySelector('.sm-tx-guards')?.value.trim()
      const requirementsRaw = el.querySelector('.sm-tx-requirements')?.value.trim()
      const priorityRaw = el.querySelector('.sm-tx-priority')?.value
      if (!from || !to || !on) return
      const guards = guardsRaw ? guardsRaw.split('|').map(g => g.trim()).filter(Boolean) : undefined
      const requirements = requirementsRaw ? requirementsRaw.split('|').map(r => r.trim()).filter(Boolean) : undefined
      const priority = Number(priorityRaw || 0)
      if (!Number.isInteger(priority) || priority < 0 || priority > SM_RUNTIME_LIMITS.priority) return
      if (requirements && (requirements.length > SM_RUNTIME_LIMITS.requirements || requirements.some(item => !REQUIREMENT_RE.test(item)))) return
      withCurrentDoc(doc => {
        if (!Array.isArray(doc.transitions)) doc.transitions = []
        const transition = { from, to, on, priority }
        if (guards?.length) transition.guards = guards
        if (requirements?.length) transition.requirements = requirements
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

    const recordAdd = e.target.closest('.sm-record-add')
    if (recordAdd) {
      const key = recordAdd.dataset.recordKey
      withCurrentDoc(doc => {
        if (!Array.isArray(doc[key])) doc[key] = []
        doc[key].push({ id: `${key}.${doc[key].length + 1}` })
      })
      return
    }

    const recordDelete = e.target.closest('.sm-record-delete')
    if (recordDelete) {
      const key = recordDelete.dataset.recordKey
      const index = Number(recordDelete.dataset.recordIndex)
      withCurrentDoc(doc => {
        if (Array.isArray(doc[key])) doc[key].splice(index, 1)
      })
      return
    }

    const recordSave = e.target.closest('.sm-record-save')
    if (recordSave) {
      const key = recordSave.dataset.recordKey
      const index = Number(recordSave.dataset.recordIndex)
      const input = [...el.querySelectorAll('.sm-record-json')].find(item =>
        item.dataset.recordKey === key && Number(item.dataset.recordIndex) === index
      )
      if (!input) return
      let value
      try { value = JSON.parse(input.value) } catch (_) { input.classList.add('sm-invalid-field'); return }
      if (!value || typeof value !== 'object' || Array.isArray(value)) { input.classList.add('sm-invalid-field'); return }
      input.classList.remove('sm-invalid-field')
      withCurrentDoc(doc => {
        if (!Array.isArray(doc[key])) doc[key] = []
        doc[key][index] = value
      })
    }
  })

  el.addEventListener('change', (e) => {
    const initialSelect = e.target.closest('.sm-initial-select')
    if (initialSelect) {
      withCurrentDoc(doc => { doc.initial = initialSelect.value || undefined })
      return
    }

    const field = e.target.closest('.sm-tx-field')
    if (field) commitTransitionField(field)
  })

  // Textarea/input automation and some browsers expose the final edit as a
  // blur without dispatching a useful `change`. Capture blur so leaving a
  // field is always a direct buffer write-back; the committed-value guard
  // prevents a second write when both events fire.
  el.addEventListener('blur', (e) => {
    const field = e.target.closest?.('.sm-tx-field')
    if (field) commitTransitionField(field)
  }, true)
}
