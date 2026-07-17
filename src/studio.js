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

function setDraftResult(result) {
  const output = document.getElementById('studio-draft-output')
  const apply = document.getElementById('studio-apply')
  const copy = document.getElementById('studio-copy')
  if (!output || !apply || !copy) return
  output.textContent = result.yaml || t('studioDynamic.noSerializableDraft')
  const summary = summarizeStudioIssues(result.issues)
  apply.disabled = !result.yaml || !summary.ok
  copy.disabled = !result.yaml
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
  const apply = document.getElementById('studio-apply')
  const copy = document.getElementById('studio-copy')
  const runtimeCheck = document.getElementById('studio-runtime-check')
  const mappingOutput = document.getElementById('studio-mapping-output')
  const mappingCopy = document.getElementById('studio-mapping-copy')
  const mappingValidate = document.getElementById('studio-mapping-validate')
  const output = document.getElementById('studio-draft-output')
  if (!instruction || !generate || !apply || !copy || !runtimeCheck || !mappingOutput || !mappingCopy || !mappingValidate || !output) return

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
    apply.disabled = true
    copy.disabled = true
    runtimeCheck.disabled = true
    mappingCopy.disabled = true
    mappingValidate.disabled = true
    mappingOutput.value = ''
    lastRuntimeWorldIr = null
    renderRuntimeReport(null)
    output.textContent = t('studioDynamic.generating')
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
      output.textContent = ''
      setIssues([{ severity: 'error', code: 'ai_call_error', message: error?.message || String(error), path: '' }])
      setStatus(t('studioDynamic.aiGenerationFailed'), 'error')
      await monitor('studio:generate:error', { error: String(error?.message || error) })
    } finally {
      generate.disabled = false
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
    if (!lastDraft?.yaml) return
    try {
      await navigator.clipboard.writeText(lastDraft.yaml)
      setStatus(t('studioDynamic.draftCopied'), 'ok')
      await monitor('studio:draft:copy', { draftChars: lastDraft.yaml.length })
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
