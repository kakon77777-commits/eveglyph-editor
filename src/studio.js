// ─── EVEGLYPH STUDIO PANEL ───────────────────────────────────────
// The panel is a review surface for bounded AI drafts. Applying a draft only
// changes the CodeMirror document; Save remains an explicit human action.

import { S } from './state.js'
import { editorGet, editorGetSel, editorSet } from './editor.js'
import { callAiProvider } from './ai.js'
import { monitor } from './monitor.js'
import { importStudioDraft, validateStudioMapping } from './runtimepreview.js'
import {
  buildStudioPrompt,
  parseStudioDraft,
  summarizeStudioIssues,
} from './studiogenerator.js'
import { t } from './i18n/index.js'

let wired = false
let lastDraft = null
let lastRuntimeWorldIr = null
let lastMapping = null

const esc = (value) => String(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function setStatus(text, kind = '') {
  const node = document.getElementById('studio-status')
  if (!node) return
  node.textContent = text
  node.className = 'studio-status ' + kind
}

function setIssues(issues) {
  const node = document.getElementById('studio-issues')
  if (!node) return
  if (!issues.length) {
    node.innerHTML = `<span class="studio-ok">${t('studioDynamic.passedChecks')}</span>`
    return
  }
  node.innerHTML = issues.map(item =>
    '<div class="studio-issue studio-issue-' + esc(item.severity) + '">' +
      '<b>' + esc(item.code) + '</b> ' + esc(item.message) +
      (item.path ? '<small>' + esc(item.path) + '</small>' : '') +
    '</div>'
  ).join('')
}

function runtimeIssues(worldIr) {
  return Array.isArray(worldIr?.diagnostics?.issues)
    ? worldIr.diagnostics.issues.map(item => ({ ...item, code: 'runtime_' + item.code }))
    : []
}

function mappingIssues(report) {
  return Array.isArray(report?.diagnostics?.issues)
    ? report.diagnostics.issues.map(item => ({ ...item, code: 'mapping_' + item.code }))
    : []
}

const RUNTIME_EVENTS = ['inventory.item_given', 'movement.actor_moved', 'dialogue.responded']
const GUARD_POLICIES = ['none', 'state_conditions', 'runtime_module', 'external_review', 'drop_with_approval']
const MAPPING_LIMITS = Object.freeze({
  requirements: 32,
  eventMatchFields: 16,
  priority: 1000000,
  rewardCurrency: 1000000000,
})
const REQUIREMENT_RE = /^(reach:[a-z][a-z0-9_.-]*|deliver:[a-z][a-z0-9_.-]*:[a-z][a-z0-9_.-]*)$/
const EVENT_MATCH_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function mappingOption(value, selected, label = value) {
  return `<option value="${esc(value ?? '')}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`
}

function mappingOptions(values, selected, { nullable = false, unknownLabel = 'unsupported' } = {}) {
  const effectiveSelected = selected === undefined && nullable ? null : selected
  const options = []
  if (nullable) options.push(mappingOption(null, effectiveSelected, 'unmapped'))
  if (effectiveSelected != null && !values.includes(effectiveSelected)) {
    options.push(mappingOption(effectiveSelected, effectiveSelected, `${effectiveSelected} (${unknownLabel})`))
  }
  values.forEach(value => options.push(mappingOption(value, effectiveSelected)))
  return options.join('')
}

function validMappingEventMatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > MAPPING_LIMITS.eventMatchFields) return false
  return Object.entries(value).every(([key, item]) => EVENT_MATCH_KEY_RE.test(key) && (
    item === null || typeof item === 'string' || typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item))
  ))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function renderMappingVisual(mapping) {
  const node = document.getElementById('studio-mapping-visual')
  if (!node) return
  if (!mapping || typeof mapping !== 'object') {
    node.innerHTML = `<span class="studio-dim">${t('studioDynamic.mappingVisualEmpty')}</span>`
    return
  }
  const entities = mapping.entities && typeof mapping.entities === 'object' ? mapping.entities : {}
  const machines = mapping.state_machines && typeof mapping.state_machines === 'object' ? mapping.state_machines : {}
  const eventOptions = (selected) => mappingOptions(RUNTIME_EVENTS, selected, { nullable: true })
  const policyOptions = (selected) => mappingOptions(GUARD_POLICIES, selected)
  node.innerHTML = `
    <div class="studio-map-toolbar"><strong>${t('studioDynamic.mappingVisualTitle')}</strong><span>${t('studioDynamic.mappingVisualHint')}</span></div>
    <details class="studio-map-section" open>
      <summary>${t('studioDynamic.mappingEntities')} <span>${Object.keys(entities).length}</span></summary>
      ${Object.entries(entities).map(([key, binding]) => `
        <div class="studio-map-row">
          <code>${esc(key)}</code>
          <input data-map-scope="entity" data-map-key="${esc(key)}" data-map-field="room" value="${esc(binding?.room ?? '')}" placeholder="room.id">
          <select data-map-scope="entity" data-map-key="${esc(key)}" data-map-field="target_table">
            ${mappingOptions(['entities', 'items'], binding?.target_table, { nullable: true })}
          </select>
        </div>
      `).join('') || `<span class="studio-dim">${t('studioDynamic.mappingVisualNoEntities')}</span>`}
    </details>
    <details class="studio-map-section" open>
      <summary>${t('studioDynamic.mappingMachines')} <span>${Object.keys(machines).length}</span></summary>
      ${Object.entries(machines).map(([machineId, machine]) => {
        const mappings = machine?.event_mappings && typeof machine.event_mappings === 'object' ? machine.event_mappings : {}
        return `
          <div class="studio-map-machine">
            <div class="studio-map-machine-head"><code>${esc(machineId)}</code>
              <select data-map-scope="machine" data-map-key="${esc(machineId)}" data-map-field="target">
                ${mappingOptions(['quest'], machine?.target, { nullable: true })}
              </select>
              <select data-map-scope="machine" data-map-key="${esc(machineId)}" data-map-field="guard_policy">${policyOptions(machine?.guard_policy || 'none')}</select>
            </div>
            ${Object.entries(mappings).map(([transitionId, transition]) => `
              <div class="studio-map-transition">
                <strong>${esc(transitionId)}</strong>
                <select data-map-scope="transition" data-map-machine="${esc(machineId)}" data-map-key="${esc(transitionId)}" data-map-field="event_type">${eventOptions(transition?.event_type)}</select>
                <input data-map-scope="transition" data-map-machine="${esc(machineId)}" data-map-key="${esc(transitionId)}" data-map-field="requirements" value="${esc(Array.isArray(transition?.requirements) ? transition.requirements.join(' | ') : '')}" placeholder="requirements">
                <input data-map-scope="transition" data-map-machine="${esc(machineId)}" data-map-key="${esc(transitionId)}" data-map-field="priority" type="number" min="0" step="1" value="${esc(transition?.priority ?? 0)}" title="priority">
                <textarea data-map-scope="transition" data-map-machine="${esc(machineId)}" data-map-key="${esc(transitionId)}" data-map-field="event_match" spellcheck="false">${esc(JSON.stringify(transition?.event_match || {}, null, 2))}</textarea>
                <input data-map-scope="transition" data-map-machine="${esc(machineId)}" data-map-key="${esc(transitionId)}" data-map-field="reward_currency" type="number" min="0" step="1" value="${esc(transition?.reward?.currency ?? '')}" placeholder="reward.currency">
              </div>
            `).join('') || `<span class="studio-dim">${t('studioDynamic.mappingVisualNoTransitions')}</span>`}
          </div>
        `
      }).join('') || `<span class="studio-dim">${t('studioDynamic.mappingVisualNoMachines')}</span>`}
    </details>
  `
}

function readMappingVisual() {
  if (!lastMapping) throw new Error(t('studioDynamic.mappingVisualEmpty'))
  const mapping = cloneJson(lastMapping)
  if (!mapping.entities || typeof mapping.entities !== 'object') mapping.entities = {}
  if (!mapping.state_machines || typeof mapping.state_machines !== 'object') mapping.state_machines = {}
  document.querySelectorAll('#studio-mapping-visual [data-map-scope]').forEach(input => {
    const scope = input.dataset.mapScope
    const field = input.dataset.mapField
    const key = input.dataset.mapKey
    if (scope === 'entity') {
      mapping.entities[key] = mapping.entities[key] || {}
      if (field === 'target_table' && !input.value) delete mapping.entities[key][field]
      else mapping.entities[key][field] = input.value
    } else if (scope === 'machine') {
      mapping.state_machines[key] = mapping.state_machines[key] || {}
      mapping.state_machines[key][field] = input.value || null
    } else if (scope === 'transition') {
      const machine = input.dataset.mapMachine
      mapping.state_machines[machine] = mapping.state_machines[machine] || {}
      mapping.state_machines[machine].event_mappings = mapping.state_machines[machine].event_mappings || {}
      const transition = mapping.state_machines[machine].event_mappings[key] || {}
      if (field === 'requirements') {
        const values = input.value.split('|').map(value => value.trim()).filter(Boolean)
        if (values.length > MAPPING_LIMITS.requirements || values.some(value => !REQUIREMENT_RE.test(value))) {
          throw new Error(t('studioDynamic.mappingVisualInvalid'))
        }
        if (values.length) transition.requirements = values
        else delete transition.requirements
      } else if (field === 'priority') {
        const value = Number(input.value)
        if (!Number.isInteger(value) || value < 0 || value > MAPPING_LIMITS.priority) throw new Error(t('studioDynamic.mappingVisualInvalid'))
        transition.priority = value
      } else if (field === 'event_match') {
        try { transition.event_match = JSON.parse(input.value || '{}') } catch (_) { throw new Error(t('studioDynamic.mappingVisualInvalid')) }
        if (!validMappingEventMatch(transition.event_match)) throw new Error(t('studioDynamic.mappingVisualInvalid'))
      } else if (field === 'reward_currency') {
        if (input.value.trim() === '') delete transition.reward
        else {
          const value = Number(input.value)
          if (!Number.isInteger(value) || value < 0 || value > MAPPING_LIMITS.rewardCurrency) throw new Error(t('studioDynamic.mappingVisualInvalid'))
          transition.reward = { ...(transition.reward || {}), currency: value }
        }
      } else {
        transition[field] = input.value || null
      }
      mapping.state_machines[machine].event_mappings[key] = transition
    }
  })
  return mapping
}

function syncMappingOutput() {
  const output = document.getElementById('studio-mapping-output')
  if (!output) return null
  const mapping = readMappingVisual()
  lastMapping = mapping
  output.value = JSON.stringify(mapping, null, 2)
  return mapping
}

function renderRuntimeReport(worldIr) {
  const node = document.getElementById('studio-runtime-report')
  if (!node) return
  if (!worldIr) {
    node.textContent = t('studioDynamic.noRuntimeImport')
    return
  }
  const summary = worldIr.summary || {}
  const blockers = Array.isArray(worldIr.compile_blockers) ? worldIr.compile_blockers : []
  const decisions = Array.isArray(worldIr.migration_plan?.required_decisions)
    ? worldIr.migration_plan.required_decisions
    : []
  const lines = [
    t('studioDynamic.worldIrSummary', { docs: summary.documents || 0, entities: summary.entities || 0, sm: summary.state_machines || 0 }),
    worldIr.compile_ready === true ? t('studioDynamic.compileReadyYes') : t('studioDynamic.compileReadyNo'),
  ]
  if (blockers.length) lines.push('', t('studioDynamic.compileBlockers'), ...blockers.map(item => `- ${item}`))
  if (decisions.length) lines.push('', t('studioDynamic.requiredDecisions'), ...decisions.map(item => `- ${item.code}: ${item.message}`))
  node.textContent = lines.join('\n')
}

function setDraftResult(result, source = '') {
  const output = document.getElementById('studio-draft-output')
  const review = document.getElementById('studio-review')
  const apply = document.getElementById('studio-apply')
  const copy = document.getElementById('studio-copy')
  if (!output || !review || !apply || !copy) return
  output.value = result.yaml || source || ''
  const summary = summarizeStudioIssues(result.issues)
  review.disabled = !output.value.trim()
  apply.disabled = !result.yaml || !summary.ok
  copy.disabled = !output.value.trim()
  setIssues(result.issues)
  setStatus(
    summary.ok
      ? (summary.warnings ? t('studioDynamic.draftValidWithWarnings', { count: summary.warnings }) : t('studioDynamic.draftReady'))
      : t('studioDynamic.errorsBlockApply', { count: summary.errors }),
    summary.ok ? 'ok' : 'error'
  )
}

function currentSource() {
  const selection = editorGetSel()
  return selection || editorGet()
}

export function initStudioView() {
  const panel = document.getElementById('t-studio')
  if (!panel || wired) return
  wired = true

  const instruction = document.getElementById('studio-instruction')
  const generate = document.getElementById('studio-generate')
  const loadEditor = document.getElementById('studio-load-editor')
  const review = document.getElementById('studio-review')
  const apply = document.getElementById('studio-apply')
  const copy = document.getElementById('studio-copy')
  const runtimeCheck = document.getElementById('studio-runtime-check')
  const mappingOutput = document.getElementById('studio-mapping-output')
  const mappingVisual = document.getElementById('studio-mapping-visual')
  const mappingLoadVisual = document.getElementById('studio-mapping-load-visual')
  const mappingSync = document.getElementById('studio-mapping-sync')
  const mappingCopy = document.getElementById('studio-mapping-copy')
  const mappingValidate = document.getElementById('studio-mapping-validate')
  const output = document.getElementById('studio-draft-output')
  if (!instruction || !generate || !loadEditor || !review || !apply || !copy || !runtimeCheck || !mappingOutput || !mappingVisual || !mappingLoadVisual || !mappingSync || !mappingCopy || !mappingValidate || !output) return

  const clearRuntimeReview = () => {
    lastRuntimeWorldIr = null
    lastMapping = null
    mappingOutput.value = ''
    renderMappingVisual(null)
    mappingLoadVisual.disabled = true
    mappingSync.disabled = true
    mappingCopy.disabled = true
    mappingValidate.disabled = true
    renderRuntimeReport(null)
  }

  generate.addEventListener('click', async () => {
    if (S.cfg.provider === 'local-agent') {
      setStatus(t('studioDynamic.needsCloudProvider'), 'error')
      return
    }
    const source = currentSource()
    const prompt = buildStudioPrompt({
      instruction: instruction.value,
      source,
      activePath: S.active || '',
    })
    generate.disabled = true
    loadEditor.disabled = true
    review.disabled = true
    apply.disabled = true
    copy.disabled = true
    runtimeCheck.disabled = true
    mappingCopy.disabled = true
    mappingValidate.disabled = true
    clearRuntimeReview()
    output.value = t('studioDynamic.generating')
    setIssues([])
    setStatus(t('studioDynamic.callingProvider'))
    await monitor('studio:generate:start', {
      provider: S.cfg.provider,
      active: S.active || null,
      sourceChars: source.length,
      promptChars: prompt.length,
    })
    try {
      const raw = await callAiProvider(prompt)
      lastDraft = parseStudioDraft(raw)
      setDraftResult(lastDraft)
      await monitor('studio:generate:result', {
        ok: summarizeStudioIssues(lastDraft.issues).ok,
        issueCount: lastDraft.issues.length,
        draftChars: lastDraft.yaml.length,
      })
    } catch (error) {
      lastDraft = null
      output.value = ''
      setIssues([{ severity: 'error', code: 'ai_call_error', message: error?.message || String(error), path: '' }])
      setStatus(t('studioDynamic.aiGenerationFailed'), 'error')
      await monitor('studio:generate:error', { error: String(error?.message || error) })
    } finally {
      generate.disabled = false
      loadEditor.disabled = false
      runtimeCheck.disabled = !lastDraft?.yaml
    }
  })

  loadEditor.addEventListener('click', async () => {
    const source = editorGet().trim()
    if (!source) {
      setStatus(t('studioDynamic.editorEmpty'), 'error')
      return
    }
    lastDraft = parseStudioDraft(source)
    clearRuntimeReview()
    // Keep the source visible even when it is malformed or is not a
    // state_machine document, so the user can correct it in this review box.
    setDraftResult(lastDraft, source)
    runtimeCheck.disabled = !lastDraft.yaml
    await monitor('studio:editor-load', {
      active: S.active || null,
      ok: summarizeStudioIssues(lastDraft.issues).ok,
      issueCount: lastDraft.issues.length,
      sourceChars: source.length,
    })
  })

  output.addEventListener('input', () => {
    // Editing the review artifact invalidates the previous parse and Runtime
    // report. A second explicit review is required before Apply or Runtime.
    lastDraft = null
    clearRuntimeReview()
    review.disabled = !output.value.trim()
    apply.disabled = true
    runtimeCheck.disabled = true
    copy.disabled = !output.value.trim()
    setIssues(output.value.trim()
      ? [{ severity: 'warning', code: 'draft_changed_needs_review', message: t('studioDynamic.draftChangedNeedsReview'), path: '' }]
      : [])
    setStatus(output.value.trim() ? t('studioDynamic.draftChangedNeedsReview') : t('studio.reviewOnlyStatus'))
  })

  review.addEventListener('click', async () => {
    const source = output.value.trim()
    if (!source) return
    review.disabled = true
    setStatus(t('studioDynamic.reviewingDraft'))
    try {
      lastDraft = parseStudioDraft(source)
      // Preserve malformed text for correction; valid text is normalized to
      // the canonical YAML emitted by the parser.
      setDraftResult(lastDraft, source)
      clearRuntimeReview()
      await monitor('studio:draft:review', {
        ok: summarizeStudioIssues(lastDraft.issues).ok,
        issueCount: lastDraft.issues.length,
        draftChars: source.length,
      })
    } finally {
      review.disabled = !output.value.trim()
      runtimeCheck.disabled = !lastDraft?.yaml
    }
  })

  apply.addEventListener('click', async () => {
    if (!lastDraft?.yaml || summarizeStudioIssues(lastDraft.issues).ok === false) return
    editorSet(lastDraft.yaml)
    setStatus(t('studioDynamic.draftApplied'), 'ok')
    await monitor('studio:draft:apply', { active: S.active || null, draftChars: lastDraft.yaml.length })
  })

  copy.addEventListener('click', async () => {
    const draftText = output.value.trim()
    if (!draftText) return
    try {
      await navigator.clipboard.writeText(draftText)
      setStatus(t('studioDynamic.draftCopied'), 'ok')
      await monitor('studio:draft:copy', { draftChars: draftText.length })
    } catch (error) {
      setStatus(t('studioDynamic.clipboardUnavailable', { message: error?.message || String(error) }), 'error')
    }
  })

  runtimeCheck.addEventListener('click', async () => {
    if (!lastDraft?.yaml) return
    const runtimeUrl = S.cfg.compilableWorldRuntimeUrl || 'http://127.0.0.1:8765'
    runtimeCheck.disabled = true
    setStatus(t('studioDynamic.sendingToRuntime'))
    try {
      const result = await importStudioDraft(runtimeUrl, lastDraft.yaml, S.active || 'eveglyph-studio-draft.yaml')
      const issues = runtimeIssues(result.world_ir)
      const localIssues = lastDraft.issues
      setIssues([...localIssues, ...issues])
      lastRuntimeWorldIr = result.world_ir
      mappingOutput.value = JSON.stringify(result.mapping_suggestion || {}, null, 2)
      lastMapping = result.mapping_suggestion ? cloneJson(result.mapping_suggestion) : null
      renderMappingVisual(lastMapping)
      mappingLoadVisual.disabled = !lastMapping
      mappingSync.disabled = !lastMapping
      mappingCopy.disabled = !result.mapping_suggestion
      mappingValidate.disabled = !result.mapping_suggestion
      renderRuntimeReport(result.world_ir)
      const diagnostic = result.world_ir?.diagnostics || {}
      setStatus(
        diagnostic.errors
          ? t('studioDynamic.runtimeImportErrors', { count: diagnostic.errors })
          : t('studioDynamic.runtimeImportChecked', { count: diagnostic.warnings || 0 }),
        diagnostic.errors ? 'error' : 'ok'
      )
      await monitor('studio:runtime-import:result', {
        runtimeUrl,
        errors: diagnostic.errors || 0,
        warnings: diagnostic.warnings || 0,
        compileReady: result.world_ir?.compile_ready === true,
      })
    } catch (error) {
      setStatus(t('studioDynamic.runtimeImporterUnavailable', { message: error?.message || String(error) }), 'error')
      await monitor('studio:runtime-import:error', { runtimeUrl, error: String(error?.message || error) })
    } finally {
      runtimeCheck.disabled = false
    }
  })

  mappingOutput.addEventListener('input', () => {
    mappingSync.disabled = true
    mappingLoadVisual.disabled = !mappingOutput.value.trim()
  })

  mappingLoadVisual.addEventListener('click', () => {
    try {
      const mapping = JSON.parse(mappingOutput.value)
      if (!mapping || typeof mapping !== 'object') throw new Error('mapping must be an object')
      lastMapping = cloneJson(mapping)
      renderMappingVisual(lastMapping)
      mappingSync.disabled = false
      setStatus(t('studioDynamic.mappingVisualLoaded'), 'ok')
    } catch (error) {
      setStatus(t('studioDynamic.mappingInvalid', { message: error?.message || String(error) }), 'error')
    }
  })

  mappingSync.addEventListener('click', () => {
    try {
      syncMappingOutput()
      mappingCopy.disabled = false
      mappingValidate.disabled = false
      setStatus(t('studioDynamic.mappingVisualSynced'), 'ok')
    } catch (error) {
      setStatus(t('studioDynamic.mappingInvalid', { message: error?.message || String(error) }), 'error')
    }
  })

  mappingCopy.addEventListener('click', async () => {
    if (!mappingOutput.value.trim()) return
    try {
      await navigator.clipboard.writeText(mappingOutput.value)
      setStatus(t('studioDynamic.mappingCopied'), 'ok')
      await monitor('studio:mapping:copy', { mappingChars: mappingOutput.value.length })
    } catch (error) {
      setStatus(t('studioDynamic.clipboardUnavailable', { message: error?.message || String(error) }), 'error')
    }
  })

  mappingValidate.addEventListener('click', async () => {
    if (!lastRuntimeWorldIr || !mappingOutput.value.trim()) return
    try { if (lastMapping) syncMappingOutput() } catch (error) {
      setStatus(t('studioDynamic.mappingInvalid', { message: error?.message || String(error) }), 'error')
      return
    }
    let mapping
    try {
      mapping = JSON.parse(mappingOutput.value)
    } catch (error) {
      setStatus(t('studioDynamic.mappingInvalid', { message: error?.message || String(error) }), 'error')
      return
    }
    const runtimeUrl = S.cfg.compilableWorldRuntimeUrl || 'http://127.0.0.1:8765'
    mappingValidate.disabled = true
    setStatus(t('studioDynamic.validatingMapping'))
    try {
      const result = await validateStudioMapping(runtimeUrl, lastRuntimeWorldIr, mapping)
      const report = result.report || {}
      const localIssues = lastDraft?.issues?.filter(item => item.severity === 'warning') || []
      setIssues([...localIssues, ...mappingIssues(report)])
      const diagnostic = report.diagnostics || {}
      setStatus(
        report.runtime_ready
          ? t('studioDynamic.mappingRuntimeReady')
          : report.mapping_complete
            ? t('studioDynamic.mappingCompleteReviewNeeded')
            : t('studioDynamic.mappingErrorsBlock', { count: diagnostic.errors || 0 }),
        report.runtime_ready ? 'ok' : 'error'
      )
      await monitor('studio:mapping:validate', {
        runtimeUrl,
        mappingComplete: report.mapping_complete === true,
        runtimeReady: report.runtime_ready === true,
        errors: diagnostic.errors || 0,
        warnings: diagnostic.warnings || 0,
      })
    } catch (error) {
      setStatus(t('studioDynamic.mappingValidatorUnavailable', { message: error?.message || String(error) }), 'error')
      await monitor('studio:mapping:error', { runtimeUrl, error: String(error?.message || error) })
    } finally {
      mappingValidate.disabled = false
    }
  })
}
