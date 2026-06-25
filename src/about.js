// ─── ABOUT / PRODUCT INFO ─────────────────────────────────────────
// Renders the product identity (version, EML code, author, company, license) from
// the single source of truth in config.js (CONFIG.product) into the Settings "About"
// block and the topbar version badge. Display-only; values are set via textContent.
import { CONFIG } from './config.js'

export function renderAbout() {
  const p = CONFIG.product

  const badge = document.getElementById('brand-version')
  if (badge) badge.textContent = `v${p.version}`

  const el = document.getElementById('about-body')
  if (!el) return
  const rows = [
    ['Product', `${p.name} — ${p.format}`],
    ['Version', `${p.version}  ·  ${p.egCode}`],
    ['Author',  p.author],
    ['Company', `${p.company}　${p.companyZh}`],
    ['Contact', p.email],
    ['Location', p.location],
    ['License', `${p.license} © ${p.year} ${p.company}`],
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
