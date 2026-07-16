// =====================================================================
// EveGlyph Editor · entry (main.js)
// EG-MD-2026 · v0.3.0 · local-first, agent-native Markdown workspace (EveGlyph-MD)
// EVEMISS TECHNOLOGY CO., LTD. (一言諾科技有限公司) · Neo.K (許筌崴) · 2026
// MIT License — see LICENSE
//
// Architect: Neo.K. Vite + npm build maintained by Claude Code (local agent).
//
// Roadmap (handed off from the original single-file build):
//   [x] 1. Convert to Vite + npm project
//   [x] 2. Add Typst WASM for in-browser PDF export
//   [ ] 3. Add transclusion {{ embed: "path.md" }} support
//   [ ] 4. Add custom phosphor syntax theme for CodeMirror
//   [ ] 5. Add directory watcher for auto-refresh
//   [ ] 6. Add tab persistence (sessionStorage)
//   [ ] 7. Add split editor (two files side by side)
// =================================================================

import './styles.css'
import 'katex/dist/katex.min.css'

import { S, EVEGLYPH_DIR, CFG_KEY }  from './state.js'
import { openFolder, saveFile, newFile, openFile, addEveGlyphFiles } from './files.js'
import { aiSend, aiPreset, renderPresets } from './ai.js'
import { stopAgent, acceptReview, rejectReview } from './agent.js'
import { editorReplace, editorAppend, editorInit, editorGet } from './editor.js'
import {
  cfgLoad,
  cfgSave,
  cfgTest,
  toggleProviderFields,
  populateAgents,
  populateModels,
  useBridgeCwd,
  connectAgent,
  disconnectAgent,
  setMsg
} from './settings.js'
import { statusUpdate }            from './status.js'
import { monitor }                 from './monitor.js'
import { openEncodingMenu }        from './encodingmenu.js'
import { openFrontmatterMenu }     from './frontmattermenu.js'
import { loadMonitor, setMonitorFilter, startMonitorAuto, stopMonitorAuto } from './monitorview.js'
import { renderAbout }             from './about.js'
import { initDocs, openDocsSection } from './docs.js'
import { CONFIG }                  from './config.js'
import { createEveGlyphScaffold }    from './context.js'
import { runSearch, replaceAll }   from './search.js'
import { runAiSearch }             from './aisearch.js'
import { importFiles }             from './import.js'
import { initOverview }            from './overview.js'
import { initRuntimeView }         from './runtimeview.js'
import { initStudioView }          from './studio.js'
import { exportActiveAsPdf }       from './typstui.js'

// Toggle the app-wide light theme (CSS variables in styles.css).
export function applyTheme(theme) {
  document.documentElement.classList.toggle('theme-light', theme === 'light')
}

// i18n Phase 1 (see config.js): sets the real <html lang> attribute (affects
// screen readers / spell-check / :lang() CSS) — UI strings themselves aren't
// translated yet, that's the follow-up "compatibility" discussion.
export function applyLanguage(lang) {
  document.documentElement.lang = lang || 'en'
}

// Open the right-panel "Find in files" navigator and focus it, prefilling a
// single-line editor selection. (CodeMirror's own Ctrl+F handles in-FILE search when
// the editor is focused; this is the workspace-scope navigator for every other state.)
function openSearchPanel() {
  document.querySelector('.ptab[data-t="search"]')?.click()
  const si = document.getElementById('search-input')
  if (!si) return
  const sel = S.editor ? S.editor.state.sliceDoc(S.editor.state.selection.main.from, S.editor.state.selection.main.to) : ''
  if (sel && !sel.includes('\n')) si.value = sel
  si.focus(); si.select()
  monitor('hotkey', { target: 'search-panel' })
  if (si.value.trim()) runSearch()
}

// ─── BIND ─────────────────────────────────────────────────────────
function bindAll() {
  // Status bar
  document.getElementById('s-encoding').onclick = (e) => { monitor('click', { target: 'encoding' }); openEncodingMenu(e.currentTarget) }
  document.getElementById('s-eveglyph').onclick = (e) => { monitor('click', { target: 'eveglyph-class' }); openFrontmatterMenu(e.currentTarget) }

  // Topbar
  document.getElementById('btn-open').onclick   = () => { monitor('click', { target: 'open-folder' }); openFolder() }
  document.getElementById('btn-save').onclick   = () => { monitor('click', { target: 'save-file', active: S.active || null }); saveFile() }
  document.getElementById('btn-new').onclick    = () => { monitor('click', { target: 'new-file' }); newFile() }
  document.getElementById('btn-import').onclick  = () => { monitor('click', { target: 'import-docx' }); document.getElementById('docx-input').click() }
  document.getElementById('docx-input').onchange = (e) => { importFiles(e.target.files); e.target.value = '' }
  document.getElementById('btn-print').onclick   = () => { monitor('click', { target: 'print' }); window.print() }
  document.getElementById('btn-export-pdf').onclick = () => { monitor('click', { target: 'export-pdf', active: S.active || null }); exportActiveAsPdf() }
  document.getElementById('btn-whats-new').onclick = () => { monitor('click', { target: 'whats-new' }); openDocsSection('docs-changelog') }
  document.getElementById('btn-docs-guide').onclick     = () => openDocsSection('docs-guide')
  document.getElementById('btn-docs-changelog').onclick = () => openDocsSection('docs-changelog')

  // Drag a .docx onto the editor pane to import it.
  const pane = document.getElementById('editor-pane')
  if (pane) {
    pane.addEventListener('dragover', e => { e.preventDefault(); pane.classList.add('drop-active') })
    pane.addEventListener('dragleave', e => { if (e.target === pane) pane.classList.remove('drop-active') })
    pane.addEventListener('drop', e => {
      e.preventDefault(); pane.classList.remove('drop-active')
      monitor('drop', { files: e.dataTransfer?.files?.length || 0 })
      importFiles(e.dataTransfer?.files)
    })
  }

  // Panel tabs
  document.querySelectorAll('.ptab').forEach(b => b.onclick = () => {
    monitor('tab', { target: b.dataset.t })
    document.querySelectorAll('.ptab').forEach(x => x.classList.remove('active'))
    document.querySelectorAll('.tcontent').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    document.getElementById(`t-${b.dataset.t}`).classList.add('active')
    // The monitor stream is only fetched while its tab is open (and auto-polled there).
    if (b.dataset.t === 'log') { loadMonitor(); if (document.getElementById('monitor-auto')?.checked) startMonitorAuto() }
    else stopMonitorAuto()
  })

  // Monitor viewer controls. The whole tab is hidden when the schema flag is off.
  if (CONFIG.monitorView.enabled === false) {
    document.querySelector('.ptab[data-t="log"]')?.remove()
    document.getElementById('t-log')?.remove()
  } else {
    document.getElementById('btn-monitor-refresh').onclick = () => { monitor('click', { target: 'monitor-refresh' }); loadMonitor() }
    document.getElementById('monitor-auto').onchange = (e) => { e.target.checked ? startMonitorAuto() : stopMonitorAuto() }
    document.getElementById('monitor-filter').oninput = (e) => setMonitorFilter(e.target.value)
  }

  // AI
  document.getElementById('btn-ai-send').onclick = () => { monitor('click', { target: 'ai-send' }); aiSend() }
  document.getElementById('ai-mode').onchange = (e) => {
    S.cfg.agentMode = e.target.value
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:agentmode', { mode: e.target.value })
  }
  document.getElementById('ai-input').onkeydown  = e => { if (e.ctrlKey && e.key==='Enter') { monitor('hotkey', { target: 'ai-send' }); aiSend() } }
  renderPresets()   // build the Quick-actions list from PRESETS (Appendix B) + wire clicks
  document.getElementById('btn-replace').onclick = () => { monitor('click', { target: 'replace-response' }); if (S.lastResp) editorReplace(S.lastResp) }
  document.getElementById('btn-append').onclick  = () => { monitor('click', { target: 'append-response' }); if (S.lastResp) editorAppend(S.lastResp) }
  document.getElementById('btn-copy-r').onclick  = () => { monitor('click', { target: 'copy-response' }); if (S.lastResp) navigator.clipboard.writeText(S.lastResp) }
  document.getElementById('btn-agent-stop').onclick = () => { monitor('click', { target: 'agent-stop' }); stopAgent() }
  document.getElementById('btn-diff-accept').onclick = () => { monitor('click', { target: 'diff-accept' }); acceptReview() }
  document.getElementById('btn-diff-reject').onclick = () => { monitor('click', { target: 'diff-reject' }); rejectReview() }

  // Search (exact, human-owned navigator)
  document.getElementById('search-input').onkeydown = e => { if (e.key === 'Enter') { monitor('hotkey', { target: 'search' }); runSearch() } }
  ;['search-case', 'search-word', 'search-regex'].forEach(id => { document.getElementById(id).onchange = runSearch })
  document.querySelectorAll('input[name="search-scope"]').forEach(el => { el.onchange = runSearch })
  document.getElementById('btn-replace-all').onclick = () => { monitor('click', { target: 'replace-all' }); replaceAll() }
  document.getElementById('search-replace').onkeydown = e => { if (e.key === 'Enter') { monitor('hotkey', { target: 'replace-all' }); replaceAll() } }

  // Search mode toggle: Exact (default) vs AI semantic — two clearly separate
  // panels, not blended into one UI.
  document.querySelectorAll('.smtab').forEach(b => b.onclick = () => {
    monitor('click', { target: 'search-mode', mode: b.dataset.sm })
    document.querySelectorAll('.smtab').forEach(x => x.classList.remove('active'))
    document.querySelectorAll('.search-mode-panel').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    document.getElementById(`search-${b.dataset.sm}`).classList.add('active')
  })

  // AI semantic search (§12.2)
  document.getElementById('btn-aisearch').onclick = () => { monitor('click', { target: 'ai-search' }); runAiSearch() }
  document.getElementById('aisearch-input').onkeydown = e => { if (e.key === 'Enter') { monitor('hotkey', { target: 'ai-search' }); runAiSearch() } }

  // Settings
  document.getElementById('s-provider').onchange = e => {
    monitor('settings:provider', { provider: e.target.value })
    S.cfg.provider = e.target.value
    toggleProviderFields(e.target.value)
    if (e.target.value === 'local-agent') populateAgents()
    else populateModels(true)   // refresh the model picker for the new cloud provider
    statusUpdate()
  }
  // Auto-fetch the model list when the connection details change (the user's "連線更新自動獲取").
  document.getElementById('btn-fetch-models').onclick = () => { monitor('click', { target: 'fetch-models' }); populateModels(true) }
  document.getElementById('s-key').onchange = () => populateModels(true)
  document.getElementById('s-url').onchange = () => populateModels(true)
  document.getElementById('btn-save-settings').onclick = () => { monitor('click', { target: 'save-settings' }); cfgSave() }
  document.getElementById('btn-test').onclick           = () => { monitor('click', { target: 'test-settings' }); cfgTest() }
  document.getElementById('btn-agent-detect').onclick   = () => { monitor('click', { target: 'agent-detect' }); populateAgents() }
  document.getElementById('btn-use-bridge-cwd').onclick = () => { monitor('click', { target: 'use-bridge-cwd' }); useBridgeCwd() }
  document.getElementById('btn-agent-connect').onclick  = () => { monitor('click', { target: 'agent-connect' }); connectAgent() }
  document.getElementById('btn-agent-disconnect').onclick = () => { monitor('click', { target: 'agent-disconnect' }); disconnectAgent() }
  document.getElementById('s-agent').onchange = () => { monitor('settings:agent', { agent: document.getElementById('s-agent').value }); connectAgent() }
  document.getElementById('s-workspace').onchange = () => { monitor('settings:workspace', { workspace: document.getElementById('s-workspace').value }); connectAgent() }
  document.getElementById('s-agentcmd').onchange = () => { monitor('settings:agentcmd', { hasOverride: Boolean(document.getElementById('s-agentcmd').value.trim()) }); connectAgent() }
  document.getElementById('s-theme').onchange = (e) => {
    S.cfg.theme = e.target.value
    applyTheme(S.cfg.theme)
    if (S.editor) editorInit(editorGet())   // re-create so CodeMirror picks up the new theme
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:theme', { theme: S.cfg.theme })
  }
  document.getElementById('s-language').onchange = (e) => {
    S.cfg.language = e.target.value
    applyLanguage(S.cfg.language)
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:language', { language: S.cfg.language })
  }
  document.getElementById('s-font-size').onchange = (e) => {
    const v = parseFloat(e.target.value)
    if (!Number.isFinite(v) || v < 8 || v > 40) { e.target.value = S.cfg.editorFontSize; return }
    S.cfg.editorFontSize = v
    if (S.editor) editorInit(editorGet())   // re-create so CodeMirror picks up the new size
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:font-size', { size: v })
  }
  document.getElementById('s-font-family').onchange = (e) => {
    S.cfg.editorFontFamily = e.target.value.trim() || undefined
    if (S.editor) editorInit(editorGet())
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:font-family', {})
  }
  document.getElementById('s-agent-permission').onchange = (e) => {
    S.cfg.agentPermission = e.target.value
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:agent-permission', { perm: e.target.value })
  }
  document.getElementById('s-agent-timeout').onchange = (e) => {
    const sec = parseInt(e.target.value, 10)
    if (!Number.isFinite(sec) || sec < 10 || sec > 1800) { e.target.value = Math.round((S.cfg.agentTimeoutMs ?? 180000) / 1000); return }
    S.cfg.agentTimeoutMs = sec * 1000
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:agent-timeout', { sec })
  }
  document.getElementById('s-agent-quiet').onchange = (e) => {
    S.cfg.agentQuiet = !e.target.checked   // the checkbox is "Show raw output" → quiet is the inverse
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:agent-quiet', { quiet: S.cfg.agentQuiet })
  }
  document.getElementById('s-memory-enabled').onchange = (e) => {
    if (!S.cfg.memory) S.cfg.memory = {}
    S.cfg.memory.enabled = e.target.checked
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:memory', { enabled: e.target.checked })
  }
  ;['rules', 'glossary', 'pitfalls', 'recent'].forEach(k => {
    const el = document.getElementById('s-mem-' + k)
    if (el) el.onchange = (e) => {
      if (!S.cfg.memory) S.cfg.memory = {}
      S.cfg.memory[k] = e.target.checked
      try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
      monitor('settings:memory-layer', { layer: k, on: e.target.checked })
    }
  })
  // EveGlyph-MD frontmatter schema controls (persist immediately, like the memory toggles)
  const eveglyphPersist = (k, v) => {
    if (!S.cfg.eveglyphMd) S.cfg.eveglyphMd = {}
    S.cfg.eveglyphMd[k] = v
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    monitor('settings:eveglyph', { [k]: v })
    statusUpdate()   // chip visibility / contents may change
  }
  document.getElementById('s-eveglyph-enabled').onchange = (e) => eveglyphPersist('enabled', e.target.checked)
  document.getElementById('s-eveglyph-stamp').onchange   = (e) => eveglyphPersist('stampNewFiles', e.target.checked)
  document.getElementById('s-eveglyph-inject').onchange  = (e) => eveglyphPersist('injectIntoContext', e.target.checked)
  document.getElementById('s-eveglyph-type').onchange    = (e) => eveglyphPersist('defaultType', e.target.value)
  document.getElementById('s-eveglyph-status').onchange  = (e) => eveglyphPersist('defaultStatus', e.target.value)

  document.getElementById('btn-eveglyph-init').onclick = async () => {
    monitor('click', { target: 'eveglyph-init' })
    setMsg('Creating .eveglyph/ …')
    const r = await createEveGlyphScaffold()
    if (r.ok) {
      await addEveGlyphFiles()
      await openFile(`${EVEGLYPH_DIR}/rules.md`)
      setMsg(r.created.length
        ? `Created ${r.created.length} .eveglyph file(s) — opened rules.md to edit (all are in the file tree).`
        : '.eveglyph/ is already set up — opened rules.md to edit.', 'ok')
    } else {
      setMsg(r.error, 'err')
    }
  }

  // Global keys
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key==='s') { e.preventDefault(); monitor('hotkey', { target: 'save-file', active: S.active || null }); saveFile() }
    // Ctrl+F: inside the editor → CodeMirror's own in-file search/replace (basicSetup
    // searchKeymap). Anywhere else (empty state, preview, panels) → the app's
    // workspace "Find in files" panel, so the key always does something.
    if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
      if (document.activeElement?.closest?.('#editor-container')) return   // let CodeMirror handle it
      e.preventDefault()
      openSearchPanel()
    }
  })
}

// ─── BOOT ─────────────────────────────────────────────────────────
cfgLoad()
applyTheme(S.cfg.theme)
applyLanguage(S.cfg.language)
bindAll()
renderAbout()
initDocs()
initOverview()
initRuntimeView()
initStudioView()
statusUpdate()
monitor('boot', { href: location.href })
