// ─── TABS ─────────────────────────────────────────────────────────
import { S }        from './state.js'
import { openFile } from './files.js'

export function tabAdd(path) {
  if (S.tabs.includes(path)) { tabActivate(path); return }
  S.tabs.push(path)
  const bar  = document.getElementById('tab-bar')
  const tab  = document.createElement('div')
  tab.className = 'etab active'
  tab.dataset.p = path
  const label = path.split('/').at(-1)
  tab.innerHTML = `<span class="etab-label">${label}</span><span class="etab-close">×</span>`
  tab.querySelector('.etab-label').onclick = () => openFile(path)
  tab.querySelector('.etab-close').onclick = (e) => { e.stopPropagation(); tabClose(path) }
  bar.querySelectorAll('.etab').forEach(t => t.classList.remove('active'))
  bar.appendChild(tab)
}

export function tabActivate(path) {
  document.querySelectorAll('.etab').forEach(t => t.classList.toggle('active', t.dataset.p === path))
}

export function tabUpdate() {
  document.querySelectorAll('.etab').forEach(t => {
    const fi = S.files.get(t.dataset.p)
    t.classList.toggle('modified', fi?.modified ?? false)
  })
}

// Drop tabs whose file no longer exists (e.g. deleted by the agent).
export function tabPrune() {
  S.tabs = S.tabs.filter(p => S.files.has(p))
  document.querySelectorAll('.etab').forEach(t => {
    if (!S.files.has(t.dataset.p)) t.remove()
  })
}

export function tabClose(path) {
  S.tabs = S.tabs.filter(p => p !== path)
  document.querySelector(`.etab[data-p="${path}"]`)?.remove()
  if (S.active === path) {
    if (S.tabs.length) openFile(S.tabs.at(-1))
    else {
      S.active = null
      if (S.editor) { S.editor.destroy(); S.editor = null }
      const ec = document.getElementById('editor-container')
      ec.innerHTML = `<div id="editor-placeholder"><div class="ph-icon">⬡</div><p>Select a file</p></div>`
    }
  }
}
