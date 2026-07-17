import { S, CFG_KEY, EVEGLYPH_DIR, EVEGLYPH_FILES } from './state.js'
import { CONFIG } from './config.js'
import { stampDefaults } from './frontmatter.js'
import { editorSet, editorGet, editorSetSilent } from './editor.js'
import { previewUpdate } from './preview.js'
import { statusUpdate } from './status.js'
import { tabAdd, tabUpdate, tabPrune } from './tabs.js'
import { monitor } from './monitor.js'
import { pickFolder } from './folderbrowser.js'
import { t } from './i18n/index.js'

function bridgeFileUrl(root, file, encoding, fallback) {
  const params = { cwd: root, path: file }
  if (encoding) params.encoding = encoding             // hard override (menu pick) — wins over detection
  if (fallback && fallback !== 'UTF-8') params.fallback = fallback   // soft default — only when detection is uncertain
  return `/api/workspace/file?${new URLSearchParams(params).toString()}`
}

export async function openFolder() {
  await monitor('openFolder:start', {
    configuredWorkspace: S.cfg.workspace || '',
    bridgeCwd: S.agentBridge?.cwd || ''
  })

  // Option A — in local-agent mode the workspace is the single source of truth:
  // open it through the bridge so the editor and the agent always share ONE
  // folder. No browser picker here — the picker can't surface the absolute path
  // the agent needs, so the two views would otherwise drift apart.
  if (S.cfg.provider === 'local-agent') {
    // Agent mode has no usable OS picker (it can't expose the absolute path the
    // agent needs), so "Open Folder" opens a mouse-driven folder browser backed
    // by /api/browse. The successful load runs resetWorkspaceView() (clears old
    // tabs/editor), so switching folders never leaves stale right-pane state.
    const start = (S.cfg.workspace || '').trim() || S.agentBridge?.cwd || ''
    const chosen = await pickFolder(start)
    if (!chosen) { await monitor('openFolder:cancel', { mode: 'folder-browser', prior: start }); return }

    S.cfg.workspace = chosen
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
    const ok = await loadWorkspacePath(chosen)

    if (!ok) {
      const fn = document.getElementById('folder-name')
      if (fn) fn.textContent = `${t('files.cannotOpenStatus')} ${chosen}`
      alert(t('files.cannotOpenAlert', { path: chosen }))
    }
    await monitor(ok ? 'openFolder:success' : 'openFolder:error', { cwd: chosen, mode: 'folder-browser' })
    return
  }

  try {
    if (window.showDirectoryPicker) {
      S.dirHandle = await window.showDirectoryPicker()
      resetWorkspaceView()   // clear previous folder's tabs/editor before loading the new one
      S.workspaceMode = 'picker'
      S.workspaceRoot = ''
      S.files.clear()
      await scanDir(S.dirHandle, '')
      document.getElementById('folder-name').textContent = S.dirHandle.name
      document.getElementById('btn-new').disabled = false
      renderTree()
      statusUpdate()
      await monitor('openFolder:success', { mode: 'picker', name: S.dirHandle.name, count: S.files.size })
      return
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      await monitor('openFolder:cancel', {})
      return
    }
    await monitor('openFolder:error', { mode: 'picker', error: String(e?.message || e) })
    console.warn('Folder picker failed; falling back to configured workspace.', e)
  }

  let bridgeWorkspace = S.cfg.workspace || S.agentBridge?.cwd
  if (!bridgeWorkspace) {
    try {
      const r = await fetch('/api/agents')
      const info = await r.json()
      if (r.ok && info.cwd) {
        S.agentBridge = info
        bridgeWorkspace = info.cwd
      }
    } catch (_) {}
  }

  if (!window.showDirectoryPicker) {
    const typed = prompt(t('files.workspacePathPrompt'), bridgeWorkspace || '')
    if (!typed) {
      await monitor('openFolder:cancel', { mode: 'path-prompt' })
      return
    }
    bridgeWorkspace = typed.trim()
    S.cfg.workspace = bridgeWorkspace
    try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
  }

  if (bridgeWorkspace) {
    const ok = await loadWorkspacePath(bridgeWorkspace)
    await monitor(ok ? 'openFolder:success' : 'openFolder:error', { cwd: bridgeWorkspace, mode: 'bridge' })
    return
  }

  console.warn('Folder picker is unavailable. Set a workspace path in Settings.')
  await monitor('openFolder:error', { mode: 'bridge', error: 'no folder picker and no configured workspace' })
}

// Drop the previous folder's open tabs + editor content so the right pane never
// keeps a file from a folder we no longer have open. Without this, S.active still
// points at an old-folder path and a Save would write it into the NEW workspace
// (cross-folder pollution). Ghost State Analysis — credit: Astraea (code review).
function resetWorkspaceView() {
  S.tabs = []
  S.active = null
  const bar = document.getElementById('tab-bar')
  if (bar) bar.innerHTML = ''
  if (S.editor) editorSetSilent('')        // only if an editor exists (don't spawn one on first load)
  const save = document.getElementById('btn-save')
  if (save) save.disabled = true
}

export async function loadWorkspacePath(cwd) {
  if (!cwd) return false

  try {
    await monitor('workspace:load:start', { cwd })
    const r = await fetch(`/api/workspace?${new URLSearchParams({ cwd })}`)
    const info = await r.json()
    if (!r.ok) throw new Error(info.error || `workspace HTTP ${r.status}`)

    resetWorkspaceView()   // clear previous folder's tabs/editor before loading the new one
    S.dirHandle = null
    S.workspaceMode = 'bridge'
    S.workspaceRoot = info.cwd
    S.files.clear()
    for (const path of info.files) {
      S.files.set(path, { source: 'bridge', modified: false, content: null })
    }
    await addEveGlyphFiles()   // surface existing .eveglyph/ config in the tree (the bridge hides dotfiles)

    document.getElementById('folder-name').textContent = info.name || info.cwd
    document.getElementById('btn-new').disabled = false
    renderTree()
    statusUpdate()
    await monitor('workspace:load:success', { cwd: info.cwd, count: info.files.length })
    return true
  } catch (e) {
    console.error(e)
    await monitor('workspace:load:error', { cwd, error: String(e?.message || e) })
    return false
  }
}

// The bridge hides dot-prefixed entries from the file tree (correct for .git), but
// the workspace's .eveglyph/ agent-config SHOULD be editable in-app. Probe the known
// config files and register the ones that exist so they render in the tree and reuse
// the normal open/edit/save/encoding flow. Idempotent; safe to call on every load.
export async function addEveGlyphFiles() {
  if (S.workspaceMode !== 'bridge' || !S.workspaceRoot) return
  for (const name of EVEGLYPH_FILES) {
    const path = `${EVEGLYPH_DIR}/${name}`
    if (S.files.has(path)) continue
    try {
      const r = await fetch(bridgeFileUrl(S.workspaceRoot, path))
      if (r.ok) S.files.set(path, { source: 'bridge', modified: false, content: null })
    } catch (_) { /* absent / offline → just don't surface it */ }
  }
}

async function scanDir(dh, prefix) {
  for await (const [name, handle] of dh.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file' && /\.(md|txt|html|json)$/i.test(name)) {
      S.files.set(path, { source: 'picker', handle, modified: false, content: null })
    } else if (handle.kind === 'directory' && !name.startsWith('.') && name !== 'node_modules') {
      await scanDir(handle, path)
    }
  }
}

export function renderTree() {
  const tree = document.getElementById('file-tree')
  tree.innerHTML = ''
  const paths = [...S.files.keys()].sort()
  let lastDir = null

  paths.forEach(path => {
    const parts = path.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    if (dir && dir !== lastDir) {
      lastDir = dir
      const de = document.createElement('div')
      de.className = 'dir-item'
      de.textContent = dir
      tree.appendChild(de)
    }

    const fe = document.createElement('div')
    fe.className = 'file-item' + (path === S.active ? ' active' : '')
    if (S.files.get(path)?.modified) fe.classList.add('modified')
    fe.style.paddingLeft = `${12 + (parts.length - 1) * 14}px`
    fe.textContent = parts.at(-1)
    fe.dataset.p = path
    fe.addEventListener('click', () => openFile(path))
    tree.appendChild(fe)
  })
}

export async function openFile(path, forceEncoding) {
  await monitor('file:open:start', { path, active: S.active || null })
  if (S.active && S.files.get(S.active)?.modified) await saveFile()
  const fi = S.files.get(path)
  if (!fi) {
    await monitor('file:open:error', { path, error: 'file not in tree' })
    return
  }

  try {
    if (fi.source === 'bridge') {
      const r = await fetch(bridgeFileUrl(S.workspaceRoot, path, forceEncoding, S.cfg.defaultEncoding))
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `file HTTP ${r.status}`)
      fi.content = data.content
      fi.encoding = data.encoding || 'UTF-8'   // detected (or forced) source encoding
    } else {
      const file = await fi.handle.getFile()
      fi.content = await file.text()
      fi.encoding = 'UTF-8'                     // browser picker reads as UTF-8
    }

    fi.modified = false
    S.active = path
    editorSet(fi.content)
    document.getElementById('btn-save').disabled = false
    renderTree()
    previewUpdate()
    statusUpdate()
    tabAdd(path)
    S.editor?.focus()
    await monitor('file:open:success', { path, source: fi.source, bytes: fi.content?.length || 0 })
  } catch (e) {
    console.error(e)
    await monitor('file:open:error', { path, source: fi.source, error: String(e?.message || e) })
  }
}

export async function saveFile() {
  if (!S.active) {
    await monitor('file:save:skip', { reason: 'no active file' })
    return
  }
  const fi = S.files.get(S.active)
  if (!fi) {
    await monitor('file:save:error', { path: S.active, error: 'active file not in tree' })
    return
  }

  try {
    const content = editorGet()
    await monitor('file:save:start', { path: S.active, source: fi.source, bytes: content.length })
    if (fi.source === 'bridge') {
      const r = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: S.workspaceRoot, path: S.active, content, encoding: fi.encoding })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `save HTTP ${r.status}`)
    } else {
      const writable = await fi.handle.createWritable()
      await writable.write(content)
      await writable.close()
    }

    fi.content = content
    fi.modified = false
    renderTree()
    tabUpdate()
    statusUpdate()
    await monitor('file:save:success', { path: S.active, source: fi.source, bytes: content.length })
  } catch (e) {
    console.error(e)
    await monitor('file:save:error', { path: S.active, source: fi.source, error: String(e?.message || e) })
  }
}

export async function newFile() {
  const name = prompt(t('files.newFilePrompt'))
  if (!name) {
    await monitor('file:new:cancel', {})
    return
  }
  const fname = name.endsWith('.md') ? name : `${name}.md`

  // Stamp EveGlyph-MD frontmatter (type/status/tags) so the schema habit starts at file
  // birth — backfilling a corpus later is the cost this avoids (supplement memo §4.3).
  const nm = S.cfg.eveglyphMd || CONFIG.eveglyphMd
  const initial = (nm.enabled !== false && nm.stampNewFiles !== false && /\.md$/i.test(fname))
    ? stampDefaults('', nm.defaultType || CONFIG.eveglyphMd.defaultType, nm.defaultStatus || CONFIG.eveglyphMd.defaultStatus)
    : ''

  try {
    await monitor('file:new:start', { path: fname, mode: S.workspaceMode, stamped: Boolean(initial) })
    if (S.workspaceMode === 'bridge') {
      const enc = S.cfg.defaultEncoding || 'UTF-8'   // new files get the workspace default → predictable bytes
      const r = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: S.workspaceRoot, path: fname, content: initial, encoding: enc })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `new file HTTP ${r.status}`)
      S.files.set(fname, { source: 'bridge', modified: false, content: initial, encoding: enc })
    } else if (S.dirHandle) {
      const handle = await S.dirHandle.getFileHandle(fname, { create: true })
      if (initial) {
        const w = await handle.createWritable(); await w.write(initial); await w.close()
      }
      S.files.set(fname, { source: 'picker', handle, modified: false, content: initial })
    } else {
      return
    }

    renderTree()
    await openFile(fname)
    await monitor('file:new:success', { path: fname, mode: S.workspaceMode })
  } catch (e) {
    console.error(e)
    await monitor('file:new:error', { path: fname, mode: S.workspaceMode, error: String(e?.message || e) })
  }
}

// Create a workspace file with given content and open it — used by DOCX import.
export async function importFile(fname, content) {
  try {
    if (S.workspaceMode === 'bridge') {
      const r = await fetch('/api/workspace/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: S.workspaceRoot, path: fname, content, encoding: S.cfg.defaultEncoding || 'UTF-8' })
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `import HTTP ${r.status}`)
      S.files.set(fname, { source: 'bridge', modified: false, content })
    } else if (S.dirHandle) {
      const handle = await S.dirHandle.getFileHandle(fname, { create: true })
      const w = await handle.createWritable(); await w.write(content); await w.close()
      S.files.set(fname, { source: 'picker', handle, modified: false, content })
    } else {
      throw new Error('No workspace open')
    }
    renderTree()
    await openFile(fname)
    return true
  } catch (e) {
    console.error(e)
    await monitor('file:import:error', { path: fname, error: String(e?.message || e) })
    alert(t('files.importSaveFailedAlert', { error: e?.message || e }))
    return false
  }
}

export async function refreshFromDisk() {
  await monitor('workspace:refresh:start', { mode: S.workspaceMode, active: S.active || null })
  if (S.workspaceMode === 'bridge') {
    const active = S.active
    await loadWorkspacePath(S.workspaceRoot)
    if (active && S.files.has(active)) {
      const r = await fetch(bridgeFileUrl(S.workspaceRoot, active, undefined, S.cfg.defaultEncoding))
      const data = await r.json()
      if (r.ok) {
        const fi = S.files.get(active)
        fi.content = data.content
        fi.encoding = data.encoding || 'UTF-8'
        fi.modified = false
        editorSetSilent(data.content)
        S.active = active
      }
    } else if (active) {
      S.active = null
    }
    tabPrune()
    renderTree()
    previewUpdate()
    statusUpdate()
    await monitor('workspace:refresh:success', { mode: 'bridge', active: S.active || null, count: S.files.size })
    return
  }

  if (!S.dirHandle) {
    await monitor('workspace:refresh:skip', { reason: 'no directory handle' })
    return
  }
  const active = S.active
  S.files.clear()
  await scanDir(S.dirHandle, '')

  if (active && S.files.has(active)) {
    const fi = S.files.get(active)
    try {
      const file = await fi.handle.getFile()
      fi.content = await file.text()
      fi.modified = false
      editorSetSilent(fi.content)
    } catch (e) { console.error(e) }
    S.active = active
  } else if (active) {
    S.active = null
  }

  tabPrune()
  renderTree()
  previewUpdate()
  statusUpdate()
  await monitor('workspace:refresh:success', { mode: 'picker', active: S.active || null, count: S.files.size })
}
