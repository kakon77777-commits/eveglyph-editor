// ─── Resizable panes (2026-07-17) ───────────────────────────────────
// Neo's explicit scope call: drag-to-resize only — no dockable/floating
// panels, no drag-to-reorder tabs. The sidebar and right-panel widths are
// dragged via the two .resize-handle elements in index.html (#rh-sidebar,
// #rh-rightpanel), persisted the same way theme/language/editorFontSize
// already are (immediate localStorage write on drop, not gated behind the
// Settings ⚙ Save button — a width you just dragged should stick).
import { S, CFG_KEY } from './state.js'
import { CONFIG } from './config.js'

export function applyLayout() {
  document.documentElement.style.setProperty('--sw', `${S.cfg.sidebarWidth ?? CONFIG.layout.sidebarWidth}px`)
  document.documentElement.style.setProperty('--rw', `${S.cfg.rightPanelWidth ?? CONFIG.layout.rightPanelWidth}px`)
}

function persist() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
}

// sign: +1 if dragging right grows the pane (sidebar, on the left edge of
// the resize handle), -1 if dragging left grows it (right panel, on the
// right edge of the handle).
function bindHandle(handle, { cfgKey, min, max, sign }) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = S.cfg[cfgKey] ?? CONFIG.layout[cfgKey]
    handle.classList.add('active')
    document.body.classList.add('resizing')
    const onMove = (ev) => {
      const next = Math.min(max, Math.max(min, Math.round(startWidth + (ev.clientX - startX) * sign)))
      S.cfg[cfgKey] = next
      applyLayout()
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      handle.classList.remove('active')
      document.body.classList.remove('resizing')
      persist()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

export function initResizers() {
  const sidebarHandle = document.getElementById('rh-sidebar')
  const rightHandle = document.getElementById('rh-rightpanel')
  if (sidebarHandle) bindHandle(sidebarHandle, { cfgKey: 'sidebarWidth', min: CONFIG.layout.sidebarMin, max: CONFIG.layout.sidebarMax, sign: 1 })
  if (rightHandle) bindHandle(rightHandle, { cfgKey: 'rightPanelWidth', min: CONFIG.layout.rightPanelMin, max: CONFIG.layout.rightPanelMax, sign: -1 })
}
