// ─── FRONTMATTER MENU ─────────────────────────────────────────────
// Click the status-bar EveGlyph-MD chip → set the active document's class. Type and
// status are pick-lists (the schema enums); tags are a free comma-separated field.
// Each change rewrites only the frontmatter block in the editor (an undoable edit),
// marks the file modified, and refreshes the chip — the human still owns the Save.
import { S } from './state.js'
import { CONFIG } from './config.js'
import { getClass, upsertFrontmatter, EVEGLYPH_TYPES, EVEGLYPH_STATUSES } from './frontmatter.js'
import { editorGet, editorSet } from './editor.js'
import { statusUpdate } from './status.js'
import { monitor } from './monitor.js'
import { t } from './i18n/index.js'

const escAttr = (s) => String(s).replace(/"/g, '&quot;')
const parseTags = (raw) => raw.split(',').map(tag => tag.trim()).filter(Boolean)

export function openFrontmatterMenu(anchor) {
  if (!S.active || !S.editor) return
  if ((S.cfg.eveglyphMd || CONFIG.eveglyphMd).enabled === false) return
  if (!/\.md$/i.test(S.active)) return

  document.querySelector('.fm-menu')?.remove()
  const cls = getClass(editorGet())

  const menu = document.createElement('div')
  menu.className = 'enc-menu fm-menu'
  menu.innerHTML =
    `<div class="enc-head">${t('frontmatterMenu.type')}</div>` +
    EVEGLYPH_TYPES.map(ty => `<div class="enc-item" data-type="${ty}">${ty}${cls.type === ty ? ' ✓' : ''}</div>`).join('') +
    `<div class="enc-sep"></div>` +
    `<div class="enc-head">${t('frontmatterMenu.status')}</div>` +
    EVEGLYPH_STATUSES.map(s => `<div class="enc-item" data-status="${s}">${s}${cls.status === s ? ' ✓' : ''}</div>`).join('') +
    `<div class="enc-sep"></div>` +
    `<div class="enc-head">${t('frontmatterMenu.tags')}</div>` +
    `<div class="fm-tags-row"><input type="text" class="fm-tags-input" placeholder="${t('frontmatterMenu.tagsPlaceholder')}" value="${escAttr(cls.tags.join(', '))}"></div>`
  document.body.appendChild(menu)

  const rect = anchor.getBoundingClientRect()
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`
  menu.style.bottom = `${window.innerHeight - rect.top + 6}px`

  const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true) }
  const onDoc = (e) => { if (!menu.contains(e.target)) close() }
  setTimeout(() => document.addEventListener('click', onDoc, true), 0)

  const apply = (patch) => {
    const cur = editorGet()
    const next = upsertFrontmatter(cur, patch)
    if (next === cur) return                            // no-op (e.g. blur re-commit) → don't dirty the file
    editorSet(next)                                     // one undoable transaction; flags modified
    statusUpdate()
    monitor('eveglyph:setclass', patch)
  }

  // Type/status update in place and keep the menu open (you usually set both).
  menu.querySelectorAll('[data-type]').forEach(it => it.onclick = () => {
    apply({ type: it.dataset.type })
    menu.querySelectorAll('[data-type]').forEach(x => x.textContent = x.dataset.type + (x === it ? ' ✓' : ''))
  })
  menu.querySelectorAll('[data-status]').forEach(it => it.onclick = () => {
    apply({ status: it.dataset.status })
    menu.querySelectorAll('[data-status]').forEach(x => x.textContent = x.dataset.status + (x === it ? ' ✓' : ''))
  })

  const tagsInput = menu.querySelector('.fm-tags-input')
  const commit = () => apply({ tags: parseTags(tagsInput.value) })
  tagsInput.onkeydown = (e) => { if (e.key === 'Enter') { commit(); close() } }
  tagsInput.onblur = commit   // also commit when focus leaves (before outside-click close)
}
