// ─── ENTITY VIEW ──────────────────────────────────────────────────
// Renders EntityIR documents (whitepaper compilableworld_studio_mssp_rdr_
// visual_world_ide_v0.1.md §3.1/§3.2, §6.2) as projections of the YAML text.
// The Form View (single entity) is editable -- see "Bidirectional editing"
// below. The Table View (entity_list) stays read-only for now (editing a
// multi-row table safely is a bigger, separate piece of work).
//
// Two recognized shapes (v0.1):
//
//   kind: entity              # single entity -> Form View
//   id: npc.innkeeper
//   type: character
//   name: 馬洛
//   location: room.inn.main
//   traits: [cautious, pragmatic]
//
//   kind: entity_list         # many entities -> Table View
//   entities:
//     - id: npc.innkeeper
//       type: character
//       name: 馬洛
//       location: room.inn.main
//     - id: item.old_map
//       type: item
//       name: 破舊地圖
//       location: room.inn.cellar
//
// ── Bidirectional editing (Form View only) ──────────────────────────
// Scalar and simple string-array fields render as real <input> elements;
// nested objects stay a read-only <pre> (editing those is out of scope for
// v0.1 -- edit the raw YAML for that). `id` and `kind` are deliberately
// NOT editable here, matching the whitepaper's own ch.13.1 principle
// ("display names can change, IDs should not be casually changed") --
// nothing references these IDs cross-file yet, but the habit is worth
// keeping from the start.
//
// On a field's `change` event (fires on blur/Enter, not per-keystroke --
// deliberately not "live as you type", to avoid re-rendering the form out
// from under an in-progress edit), the whole doc is reconstructed from the
// current form values and re-serialized with `jsYaml.dump()`, then written
// into the CodeMirror pane via `editorSet()`. That save-and-reload round
// trip is honest about its real cost: `jsYaml.dump()` does NOT preserve
// comments or the original YAML formatting/key order across a structural
// edit. For a hand-authored file with comments you care about, edit the
// raw YAML directly instead of the form.

import jsYaml from 'js-yaml'
import { validateEntity, validateEntityList } from './validate.js'
import { renderDiagnosticsBlock } from './diagnostics.js'
import { editorGet, editorSet } from './editor.js'
import { t } from './i18n/index.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

export function isEntityDoc(src) {
  return /^\s*kind:\s*entity\b/m.test(src)
}

export function isEntityListDoc(src) {
  return /^\s*kind:\s*entity_list\b/m.test(src)
}

// Fields that get their own header treatment in the form; everything else
// in the document is rendered generically below them, in document order,
// so a world author's custom fields (whatever they are) still show up
// instead of being silently dropped.
const FORM_HEADER_FIELDS = ['kind', 'id', 'type']

function formatValue(v) {
  if (Array.isArray(v)) return v.map(x => `<span class="ev-chip">${esc(x)}</span>`).join(' ')
  if (v && typeof v === 'object') return `<pre class="ev-nested">${esc(jsYaml.dump(v).trimEnd())}</pre>`
  return esc(String(v))
}

// An editable field is one whose value is a string/number/boolean, or an
// array of such (rendered as a comma-separated input) -- a nested
// object/array-of-objects has no simple single-input representation, so it
// stays the read-only <pre> from formatValue().
function isEditableValue(v) {
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.every(x => x === null || typeof x !== 'object')
  return typeof v !== 'object'
}

function fieldToInputValue(v) {
  if (Array.isArray(v)) return v.join(', ')
  return v === null || v === undefined ? '' : String(v)
}

export function renderEntityForm(src) {
  let doc
  try {
    doc = jsYaml.load(src)
  } catch (e) {
    return `<div class="sm-error">${t('entityview.invalidEntity', { message: esc(e.message) })}</div>`
  }
  if (!doc || typeof doc !== 'object') return `<div class="sm-error">${t('entityview.emptyOrNotMapping')}</div>`

  const rest = Object.keys(doc).filter(k => !FORM_HEADER_FIELDS.includes(k))
  const issues = validateEntity(doc)

  return `
    <div class="ev-form">
      <div class="ev-form-header">
        <span class="ev-type-tag">${esc(doc.type || 'entity')}</span>
        <span class="ev-id">${esc(doc.id || t('entityview.noId'))}</span>
      </div>
      <table class="ev-field-table">
        <tbody>
          ${rest.map(k => {
            const v = doc[k]
            if (!isEditableValue(v)) return `<tr><th>${esc(k)}</th><td>${formatValue(v)}</td></tr>`
            const isArray = Array.isArray(v)
            return `<tr><th>${esc(k)}</th><td>
              <input type="text" class="ev-input" data-field="${esc(k)}" data-array="${isArray}"
                     value="${esc(fieldToInputValue(v))}"${isArray ? ` placeholder="${t('entityview.valuesPlaceholder')}"` : ''}>
            </td></tr>`
          }).join('\n')}
        </tbody>
      </table>
      ${renderDiagnosticsBlock(issues)}
    </div>
  `
}

// Delegated on the stable #preview-body element so it survives
// previewUpdate() replacing #preview-body's innerHTML on every render --
// same pattern preview.js already uses for wireAimdInteractions. Wire once
// per app lifetime, guarded by evFormWired, not once per render.
let evFormWired = false
export function wireEntityFormInteractions(el) {
  if (evFormWired || !el) return
  evFormWired = true

  el.addEventListener('change', (e) => {
    const input = e.target.closest('.ev-input')
    if (!input) return

    let doc
    try {
      doc = jsYaml.load(editorGet())
    } catch {
      return   // editor content isn't valid YAML right now -- nothing safe to write back
    }
    if (!doc || typeof doc !== 'object') return

    const field = input.dataset.field
    const isArray = input.dataset.array === 'true'
    const raw = input.value
    doc[field] = isArray
      ? raw.split(',').map(s => s.trim()).filter(Boolean)
      : raw

    editorSet(jsYaml.dump(doc))
  })
}

export function renderEntityTable(src) {
  let doc
  try {
    doc = jsYaml.load(src)
  } catch (e) {
    return `<div class="sm-error">${t('entityview.invalidEntityList', { message: esc(e.message) })}</div>`
  }
  const entities = Array.isArray(doc?.entities) ? doc.entities : []
  if (!entities.length) return `<div class="sm-error">${t('entityview.noEntities')}</div>`

  // Column set = union of keys across all entities, id/type/name first if
  // present (the common case), everything else after in first-seen order --
  // a world author's per-entity extra fields still get a column instead of
  // being dropped, same "don't silently drop custom fields" rule as the form.
  const priority = ['id', 'type', 'name']
  const seen = new Set()
  const cols = []
  for (const key of priority) if (entities.some(e => key in (e || {}))) { cols.push(key); seen.add(key) }
  for (const e of entities) for (const k of Object.keys(e || {})) if (!seen.has(k)) { cols.push(k); seen.add(k) }

  const issues = validateEntityList(doc)

  return `
    <div class="ev-table-view">
      <div class="ev-form-header">
        <span class="ev-type-tag">${t('entityview.entityListLabel')}</span>
        <span class="ev-count">${t('entityview.entityCount', { count: entities.length })}</span>
      </div>
      <table class="ev-field-table ev-list-table">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${entities.map(e => `<tr>${cols.map(c => `<td>${c in (e || {}) ? formatValue(e[c]) : ''}</td>`).join('')}</tr>`).join('\n')}
        </tbody>
      </table>
      ${renderDiagnosticsBlock(issues)}
    </div>
  `
}
