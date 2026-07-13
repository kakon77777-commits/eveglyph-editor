// ─── WORKSPACE OVERVIEW ───────────────────────────────────────────
// Whitepaper compilableworld_studio_mssp_rdr_visual_world_ide_v0.1.md §7.1
// ("世界總覽" -- world overview: name/version, module counts, warnings).
// Scoped to what current IR types actually support: there's no ModuleIR
// with declared dependencies yet, so this can't be a real dependency graph
// (whitepaper §3.4/§7.7) -- it's a categorized inventory of every World IR
// document in the open workspace, each with its validator result, which is
// the honest version of "world overview" given what exists right now.
//
// `scanWorkspace()` is deliberately plain data in, plain data out (no DOM) --
// same reasoning as validate.js: it's exactly as usable from a console/agent
// context as it is from the render function below it.

import jsYaml from 'js-yaml'
import { S } from './state.js'
import { openFile } from './files.js'
import { isStateMachineDoc } from './smview.js'
import { isEntityDoc, isEntityListDoc } from './entityview.js'
import { validateStateMachine, validateEntity, validateEntityList } from './validate.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

// Reads a workspace file's content without marking it as the active/open
// file (unlike files.js's openFile) -- a read-only peek for scanning. Reuses
// already-loaded content (e.g. the file that's currently open in the editor)
// instead of re-fetching it.
async function peekFileContent(path) {
  const fi = S.files.get(path)
  if (!fi) return null
  if (fi.content !== null && fi.content !== undefined) return fi.content
  try {
    if (fi.source === 'bridge') {
      const r = await fetch('/api/workspace/file?' + new URLSearchParams({ cwd: S.workspaceRoot, path }))
      if (!r.ok) return null
      const data = await r.json()
      return data.content
    } else if (fi.handle) {
      const file = await fi.handle.getFile()
      return await file.text()
    }
  } catch {
    return null
  }
  return null
}

export async function scanWorkspace() {
  const result = { state_machines: [], entities: [], entity_lists: [], otherYamlCount: 0, scannedAt: null }
  const yamlPaths = [...S.files.keys()].filter(p => /\.ya?ml$/i.test(p)).sort()

  for (const path of yamlPaths) {
    const content = await peekFileContent(path)
    if (content == null) { result.otherYamlCount++; continue }

    if (isStateMachineDoc(content)) {
      let doc = null
      try { doc = jsYaml.load(content) } catch { /* fall through with doc=null */ }
      const issues = doc ? validateStateMachine(doc) : [{ severity: 'error', code: 'parse_error', message: 'YAML 解析失敗' }]
      result.state_machines.push({ path, id: doc?.id || '(unnamed)', stateCount: doc ? new Set([...(doc.states||[]), ...(doc.transitions||[]).flatMap(t=>[t.from,t.to])]).size : 0, issues })
    } else if (isEntityListDoc(content)) {
      let doc = null
      try { doc = jsYaml.load(content) } catch { /* fall through */ }
      const issues = doc ? validateEntityList(doc) : [{ severity: 'error', code: 'parse_error', message: 'YAML 解析失敗' }]
      result.entity_lists.push({ path, count: Array.isArray(doc?.entities) ? doc.entities.length : 0, issues })
    } else if (isEntityDoc(content)) {
      let doc = null
      try { doc = jsYaml.load(content) } catch { /* fall through */ }
      const issues = doc ? validateEntity(doc) : [{ severity: 'error', code: 'parse_error', message: 'YAML 解析失敗' }]
      result.entities.push({ path, id: doc?.id || '(unnamed)', type: doc?.type || '', issues })
    } else {
      result.otherYamlCount++
    }
  }

  result.scannedAt = new Date().toISOString()
  return result
}

function issueBadge(issues) {
  const errors = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  if (!errors && !warnings) return `<span class="ov-badge ov-ok">✓</span>`
  return `${errors ? `<span class="ov-badge ov-error">${errors}✗</span>` : ''}${warnings ? `<span class="ov-badge ov-warning">${warnings}⚠</span>` : ''}`
}

function row(path, label) {
  return `<div class="ov-row" data-path="${esc(path)}"><span class="ov-row-label">${label}</span><span class="ov-row-path">${esc(path)}</span></div>`
}

export function renderOverview(scan) {
  const totalIssues = [...scan.state_machines, ...scan.entities, ...scan.entity_lists]
    .reduce((n, item) => n + item.issues.filter(i => i.severity === 'error').length, 0)

  return `
    <div class="ov-summary">
      <span class="ov-summary-item">${scan.state_machines.length} state machines</span>
      <span class="ov-summary-item">${scan.entities.length} entities</span>
      <span class="ov-summary-item">${scan.entity_lists.length} entity lists</span>
      ${scan.otherYamlCount ? `<span class="ov-summary-item ov-dim">${scan.otherYamlCount} other .yaml (no recognized kind)</span>` : ''}
      ${totalIssues ? `<span class="ov-summary-item ov-error">${totalIssues} total errors</span>` : ''}
    </div>

    ${scan.state_machines.length ? `
      <div class="ov-group">
        <h4>State Machines</h4>
        ${scan.state_machines.map(sm => row(sm.path, `${issueBadge(sm.issues)} <span class="ov-id">${esc(sm.id)}</span> <span class="ov-meta">${sm.stateCount} states</span>`)).join('\n')}
      </div>` : ''}

    ${scan.entities.length ? `
      <div class="ov-group">
        <h4>Entities</h4>
        ${scan.entities.map(e => row(e.path, `${issueBadge(e.issues)} <span class="ov-id">${esc(e.id)}</span> <span class="ov-meta">${esc(e.type)}</span>`)).join('\n')}
      </div>` : ''}

    ${scan.entity_lists.length ? `
      <div class="ov-group">
        <h4>Entity Lists</h4>
        ${scan.entity_lists.map(el => row(el.path, `${issueBadge(el.issues)} <span class="ov-meta">${el.count} entities</span>`)).join('\n')}
      </div>` : ''}

    ${!scan.state_machines.length && !scan.entities.length && !scan.entity_lists.length
      ? `<div class="ov-empty">No recognized World IR documents found in this workspace.</div>` : ''}
  `
}

let overviewWired = false
export function initOverview() {
  const panel = document.getElementById('t-world')
  if (!panel || overviewWired) return
  overviewWired = true

  const btn = document.getElementById('btn-scan-workspace')
  const body = document.getElementById('overview-body')

  panel.addEventListener('click', (e) => {
    const r = e.target.closest('.ov-row')
    if (r) openFile(r.dataset.path)
  })

  btn?.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Scanning…'
    try {
      if (!S.workspaceRoot && !S.dirHandle) {
        body.innerHTML = `<div class="ov-empty">Open a folder first.</div>`
        return
      }
      const scan = await scanWorkspace()
      body.innerHTML = renderOverview(scan)
    } finally {
      btn.disabled = false
      btn.textContent = '↻ Scan workspace'
    }
  })
}
