import { S } from './state.js'

const WORLD_TABS = Object.freeze(['runtime', 'world', 'studio'])

export function worldStudioEnabled() {
  return S.cfg.worldStudio?.enabled === true
}

// Keep the advanced CompilableWorld authoring surface opt-in. This only changes
// visibility/projection; it never edits the YAML buffer, saves a file, calls the
// Runtime, or removes the underlying modules. Re-enabling restores the same UI.
export function applyWorldStudioVisibility() {
  const enabled = worldStudioEnabled()

  for (const name of WORLD_TABS) {
    const tab = document.querySelector(`.ptab[data-t="${name}"]`)
    const panel = document.getElementById(`t-${name}`)
    if (tab) tab.hidden = !enabled
    if (panel) panel.hidden = !enabled
  }

  const active = document.querySelector('.ptab.active')
  if (!enabled && active && WORLD_TABS.includes(active.dataset.t)) {
    const preview = document.querySelector('.ptab[data-t="preview"]')
    if (typeof preview?.onclick === 'function') preview.onclick()
    else {
      document.querySelectorAll('.ptab').forEach(item => item.classList.remove('active'))
      document.querySelectorAll('.tcontent').forEach(item => item.classList.remove('active'))
      preview?.classList.add('active')
      document.getElementById('t-preview')?.classList.add('active')
    }
  }

  document.documentElement.classList.toggle('world-studio-enabled', enabled)
  return enabled
}
