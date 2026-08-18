// ─── CUSTOM CSS ───────────────────────────────────────────────────
// Optional user-authored CSS, loaded from a workspace-relative file and
// injected after the app's own stylesheet — same idea as Zettlr's Custom CSS
// setting, adapted to this app's bridge-gated, per-workspace model. The path
// is workspace-relative (not an arbitrary absolute path) so it reuses the
// exact same /api/workspace/file read every other file access already goes
// through, no new bridge endpoint or assertWorkspace exemption needed.
import { S } from './state.js'
import { bridgeFileUrl } from './files.js'
import { monitor } from './monitor.js'

const STYLE_ID = 'eveglyph-custom-css'

export async function loadCustomCss() {
  const path = (S.cfg.customCssPath || '').trim()
  const existing = document.getElementById(STYLE_ID)

  if (!path || S.workspaceMode !== 'bridge' || !S.workspaceRoot) {
    existing?.remove()
    return
  }

  try {
    const r = await fetch(bridgeFileUrl(S.workspaceRoot, path))
    if (!r.ok) {
      // Missing/unreadable is expected (most workspaces won't have this file)
      // — silently fall back to no custom CSS rather than surfacing an error
      // for what's an optional convenience feature.
      existing?.remove()
      return
    }
    const data = await r.json()
    let tag = existing
    if (!tag) {
      tag = document.createElement('style')
      tag.id = STYLE_ID
      document.head.appendChild(tag)
    }
    tag.textContent = data.content || ''
    await monitor('customcss:load', { path, bytes: (data.content || '').length })
  } catch (e) {
    existing?.remove()
    await monitor('customcss:error', { path, error: String(e?.message || e) })
  }
}
