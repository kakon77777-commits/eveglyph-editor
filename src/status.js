import { S } from './state.js'
import { CONFIG } from './config.js'
import { getClass, validateClass } from './frontmatter.js'
import { t } from './i18n/index.js'

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
    el.textContent = t('statusbar.frontmatterAdd')
    el.className = 's-eveglyph s-eveglyph-empty'
    el.title = t('statusbar.frontmatterAddTitle')
    return
  }
  const issues = validateClass(cls)
  el.textContent = `${cls.type || '—'} · ${cls.status || '—'}`
  el.className = 's-eveglyph' + (issues.length ? ' s-eveglyph-warn' : '')
  el.title = issues.length ? issues.map(i => i.msg).join('; ') : t('statusbar.eveglyphClassChangeTitle')
}

export function statusUpdate() {
  const fi = S.active ? S.files.get(S.active) : null
  document.getElementById('s-mod').textContent = fi?.modified ? t('statusbar.modified') : ''
  document.getElementById('s-file').textContent = S.active ?? ''
  eveglyphChipUpdate()
  const encEl = document.getElementById('s-encoding')
  if (encEl) encEl.textContent = (S.active && fi?.encoding) ? fi.encoding : ''

  const provider = S.cfg.provider === 'anthropic'
    ? t('statusbar.providerClaude')
    : S.cfg.provider === 'local-agent'
      ? `Agent:${S.cfg.agent} ${S.agentConnected ? t('statusbar.agentConnected') : t('statusbar.agentIdle')}`
      : t('statusbar.providerOpenaiCompat')

  const workspace = S.cfg.provider === 'local-agent' && S.cfg.workspace
    ? ` - ${S.cfg.workspace}`
    : ''

  document.getElementById('status-provider').textContent = `${t('statusbar.providerPrefix')} ${provider}${workspace}`
}
