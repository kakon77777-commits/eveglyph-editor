import { S } from './state.js'
import { CONFIG } from './config.js'
import { getClass, validateClass } from './frontmatter.js'

// Status-bar EveGlyph-MD chip: shows the active .md file's `type · status` (warns on
// out-of-enum values), or a muted "+ frontmatter" affordance when none is present.
// Reads the live editor text (not the on-disk copy) so it tracks edits immediately.
function eveglyphChipUpdate() {
  const el = document.getElementById('s-eveglyph')
  if (!el) return
  const nm = S.cfg.eveglyphMd || CONFIG.eveglyphMd
  const isMd = S.active && /\.md$/i.test(S.active)
  const text = S.editor?.state.doc.toString() ?? ''
  const cls = isMd ? getClass(text) : { type: '', status: '', tags: [] }

  if (nm.enabled === false || !S.active || !isMd) {
    el.textContent = ''; el.className = 's-eveglyph'; el.title = ''
    return
  }
  if (!cls.type && !cls.status) {
    el.textContent = '+ frontmatter'
    el.className = 's-eveglyph s-eveglyph-empty'
    el.title = 'No EveGlyph-MD frontmatter — click to add type / status / tags'
    return
  }
  const issues = validateClass(cls)
  el.textContent = `${cls.type || '—'} · ${cls.status || '—'}`
  el.className = 's-eveglyph' + (issues.length ? ' s-eveglyph-warn' : '')
  el.title = issues.length ? issues.map(i => i.msg).join('; ') : 'EveGlyph-MD document class — click to change'
}

export function statusUpdate() {
  const fi = S.active ? S.files.get(S.active) : null
  document.getElementById('s-mod').textContent = fi?.modified ? 'Modified' : ''
  document.getElementById('s-file').textContent = S.active ?? ''
  eveglyphChipUpdate()
  const encEl = document.getElementById('s-encoding')
  if (encEl) encEl.textContent = (S.active && fi?.encoding) ? fi.encoding : ''

  const provider = S.cfg.provider === 'anthropic'
    ? 'Claude'
    : S.cfg.provider === 'local-agent'
      ? `Agent:${S.cfg.agent} ${S.agentConnected ? 'connected' : 'idle'}`
      : 'OpenAI-compat'

  const workspace = S.cfg.provider === 'local-agent' && S.cfg.workspace
    ? ` - ${S.cfg.workspace}`
    : ''

  document.getElementById('status-provider').textContent = `Provider: ${provider}${workspace}`
}
