// ─── FOLDER BROWSER ───────────────────────────────────────────────
// A mouse-driven folder picker for local-agent mode. The browser's native
// directory picker can't expose an absolute path (which the agent needs), so we
// navigate the filesystem through the bridge's /api/browse endpoint instead.
//
// pickFolder(startPath) opens a modal and resolves to the chosen absolute path,
// or null if the user cancels.

import { t } from './i18n/index.js'

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function pickFolder(startPath) {
  return new Promise((resolve) => {
    let current = startPath || ''
    let settled = false

    const ov = document.createElement('div')
    ov.className = 'fb-overlay'
    ov.innerHTML = `
      <div class="fb-panel" role="dialog" aria-label="${t('folderBrowser.title')}">
        <div class="fb-head">
          <span class="fb-title">${t('folderBrowser.title')}</span>
          <button class="fb-x" title="${t('folderBrowser.cancelTitle')}">×</button>
        </div>
        <div class="fb-drives"></div>
        <div class="fb-path" title="current folder"></div>
        <div class="fb-list"></div>
        <div class="fb-foot">
          <button class="btn-s fb-up">${t('folderBrowser.up')}</button>
          <span class="fb-spacer"></span>
          <button class="btn-s fb-cancel">${t('folderBrowser.cancel')}</button>
          <button class="btn-p fb-open">${t('folderBrowser.openFolder')}</button>
        </div>
      </div>`
    document.body.appendChild(ov)

    const q = (s) => ov.querySelector(s)
    const close = (val) => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey)
      ov.remove()
      resolve(val)
    }
    const onKey = (e) => { if (e.key === 'Escape') close(null) }
    document.addEventListener('keydown', onKey)

    q('.fb-x').onclick = () => close(null)
    q('.fb-cancel').onclick = () => close(null)
    q('.fb-open').onclick = () => close(current || null)
    ov.addEventListener('click', (e) => { if (e.target === ov) close(null) })

    async function load(p) {
      const list = q('.fb-list')
      list.innerHTML = '<div class="fb-empty">…</div>'
      let info
      try {
        const r = await fetch(`/api/browse?${new URLSearchParams(p ? { path: p } : {})}`)
        info = await r.json()
      } catch (e) {
        list.innerHTML = `<div class="fb-err">${esc(e.message || e)}</div>`
        return
      }
      if (info.error) { list.innerHTML = `<div class="fb-err">${esc(info.error)}</div>`; return }

      current = info.path
      q('.fb-path').textContent = info.path
      const up = q('.fb-up')
      up.disabled = !info.parent
      up.onclick = () => { if (info.parent) load(info.parent) }

      q('.fb-drives').innerHTML = (info.drives || [])
        .map(d => `<button class="fb-drive" data-d="${esc(d)}">${esc(d)}</button>`).join('')
      q('.fb-drives').querySelectorAll('.fb-drive').forEach(b =>
        b.onclick = () => load(b.dataset.d))

      if (!info.dirs.length) {
        list.innerHTML = `<div class="fb-empty">${t('folderBrowser.noSubfolders')}</div>`
        return
      }
      list.innerHTML = info.dirs
        .map(n => `<div class="fb-item" data-n="${esc(n)}">📁 ${esc(n)}</div>`).join('')
      list.querySelectorAll('.fb-item').forEach(it =>
        it.onclick = () => load(`${info.path}/${it.dataset.n}`))   // server path.resolve normalizes the separator
    }

    load(current)
  })
}
