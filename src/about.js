// ─── ABOUT / PRODUCT INFO ─────────────────────────────────────────
// Renders the product identity (version, EML code, author, company, license) from
// the single source of truth in config.js (CONFIG.product) into the Settings "About"
// block and the topbar version badge. Display-only; values are set via textContent.
import { CONFIG } from './config.js'
import { t } from './i18n/index.js'

export function renderAbout() {
  const p = CONFIG.product

  const badge = document.getElementById('brand-version')
  if (badge) badge.textContent = `v${p.version}`

  const el = document.getElementById('about-body')
  if (!el) return
  const rows = [
    [t('aboutDynamic.product'), `${p.name} — ${p.format}`],
    [t('aboutDynamic.version'), `${p.version}  ·  ${p.egCode}`],
    [t('aboutDynamic.author'),  p.author],
    [t('aboutDynamic.company'), `${p.company}　${p.companyZh}`],
    [t('aboutDynamic.contact'), p.email],
    [t('aboutDynamic.location'), p.location],
    [t('aboutDynamic.license'), `${p.license} © ${p.year} ${p.company}`],
  ]
  el.replaceChildren()
  for (const [k, v] of rows) {
    const row = document.createElement('div'); row.className = 'about-row'
    const key = document.createElement('span'); key.className = 'about-k'; key.textContent = k
    const val = document.createElement('span'); val.className = 'about-v'; val.textContent = v
    row.append(key, val)
    el.appendChild(row)
  }
}
