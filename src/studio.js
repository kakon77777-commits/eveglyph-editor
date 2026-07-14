// ─── EVEGLYPH STUDIO PANEL ───────────────────────────────────────
// The panel is a review surface for bounded AI drafts. Applying a draft only
// changes the CodeMirror document; Save remains an explicit human action.

import { S } from './state.js'
import { editorGet, editorGetSel, editorSet } from './editor.js'
import { callAiProvider } from './ai.js'
import { monitor } from './monitor.js'
import {
  buildStudioPrompt,
  parseStudioDraft,
  summarizeStudioIssues,
} from './studiogenerator.js'

let wired = false
let lastDraft = null

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
    node.innerHTML = '<span class="studio-ok">✓ Draft passed structural checks</span>'
    return
  }
  node.innerHTML = issues.map(item =>
    '<div class="studio-issue studio-issue-' + esc(item.severity) + '">' +
      '<b>' + esc(item.code) + '</b> ' + esc(item.message) +
      (item.path ? '<small>' + esc(item.path) + '</small>' : '') +
    '</div>'
  ).join('')
}

function setDraftResult(result) {
  const output = document.getElementById('studio-draft-output')
  const apply = document.getElementById('studio-apply')
  const copy = document.getElementById('studio-copy')
  if (!output || !apply || !copy) return
  output.textContent = result.yaml || '(no serializable draft)'
  const summary = summarizeStudioIssues(result.issues)
  apply.disabled = !result.yaml || !summary.ok
  copy.disabled = !result.yaml
  setIssues(result.issues)
  setStatus(
    summary.ok
      ? (summary.warnings ? 'Draft valid with ' + summary.warnings + ' warning(s)' : 'Draft ready for review')
      : summary.errors + ' error(s) block Apply',
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
  const output = document.getElementById('studio-draft-output')
  if (!instruction || !generate || !apply || !copy || !output) return

  generate.addEventListener('click', async () => {
    if (S.cfg.provider === 'local-agent') {
      setStatus('Structured Studio generation currently needs Anthropic or OpenAI provider', 'error')
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
    output.textContent = 'Generating bounded draft…'
    setIssues([])
    setStatus('Calling configured AI provider…')
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
      setStatus('AI generation failed', 'error')
      await monitor('studio:generate:error', { error: String(error?.message || error) })
    } finally {
      generate.disabled = false
    }
  })

  apply.addEventListener('click', async () => {
    if (!lastDraft?.yaml || summarizeStudioIssues(lastDraft.issues).ok === false) return
    editorSet(lastDraft.yaml)
    setStatus('Draft applied to editor; Save remains manual', 'ok')
    await monitor('studio:draft:apply', { active: S.active || null, draftChars: lastDraft.yaml.length })
  })

  copy.addEventListener('click', async () => {
    if (!lastDraft?.yaml) return
    try {
      await navigator.clipboard.writeText(lastDraft.yaml)
      setStatus('Draft copied as YAML', 'ok')
      await monitor('studio:draft:copy', { draftChars: lastDraft.yaml.length })
    } catch (error) {
      setStatus('Clipboard unavailable: ' + (error?.message || String(error)), 'error')
    }
  })
}

