// ─── ENCODING MENU ────────────────────────────────────────────────
// Click the status-bar encoding indicator → choose how to read/write the file.
//  • "Reopen with <enc>"  re-reads the file decoded as the chosen encoding
//    (use it when auto-detection guessed wrong → fixes mojibake).
//  • "Save as UTF-8"      converts: next save writes UTF-8 (save preserves
//    the file's encoding otherwise — chosen by the user).
import { S } from './state.js'
import { openFile, saveFile } from './files.js'
import { statusUpdate } from './status.js'

// Shared with the Settings "default encoding" dropdown (settings.js) so the two
// lists can never drift apart.
export const ENCODINGS = ['UTF-8', 'UTF-16LE', 'Big5', 'GBK', 'GB18030', 'Shift_JIS', 'EUC-JP', 'EUC-KR', 'windows-1252']

export function openEncodingMenu(anchor) {
  // Encoding only applies to bridge-loaded files (the browser picker is UTF-8).
  if (!S.active) return
  const fi = S.files.get(S.active)
  if (!fi || fi.source !== 'bridge') return

  document.querySelector('.enc-menu')?.remove()
  const cur = (fi.encoding || '').toLowerCase()

  const menu = document.createElement('div')
  menu.className = 'enc-menu'
  menu.innerHTML =
    `<div class="enc-head">Reopen with encoding</div>` +
    ENCODINGS.map(e =>
      `<div class="enc-item" data-e="${e}">${e}${cur === e.toLowerCase() ? ' ✓' : ''}</div>`).join('') +
    `<div class="enc-sep"></div>` +
    `<div class="enc-item enc-save" data-save="1">Save as UTF-8 (convert)</div>`
  document.body.appendChild(menu)

  const rect = anchor.getBoundingClientRect()
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`
  menu.style.bottom = `${window.innerHeight - rect.top + 6}px`

  const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true) }
  const onDoc = (e) => { if (!menu.contains(e.target)) close() }
  setTimeout(() => document.addEventListener('click', onDoc, true), 0)

  menu.querySelectorAll('.enc-item').forEach(it => it.onclick = async () => {
    if (it.dataset.save) {
      const f = S.files.get(S.active)
      if (f) { f.encoding = 'UTF-8'; await saveFile(); statusUpdate() }
    } else {
      await openFile(S.active, it.dataset.e)   // re-read decoded as the chosen encoding
    }
    close()
  })
}
