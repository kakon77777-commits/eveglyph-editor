// ─── i18n Phase 2: string translation ──────────────────────────────────
// No framework — a plain key→string dictionary per locale (matches this
// codebase's existing hand-rolled-over-dependency style), English as the
// base/fallback so a partially-translated locale never shows a blank
// string. Scope (Neo, 2026-07-15): front-stage UI chrome only — buttons,
// labels, menus, tooltips, alerts. AI prompt text, Monitor/diagnostic
// content, and document content are deliberately NOT translated.
import en from './en.js'
import zhTW from './zh-TW.js'

const LOCALES = { en, 'zh-TW': zhTW }

function lookup(dict, key) {
  let cur = dict
  for (const part of key.split('.')) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

// Translates a dot-path key ("topbar.save") in the given (or current) locale,
// falling back to English, then to the key itself so a typo is visible
// rather than silently blank.
export function t(key, lang) {
  const locale = LOCALES[lang] || LOCALES[currentLang] || en
  return lookup(locale, key) ?? lookup(en, key) ?? key
}

let currentLang = 'en'

// Walks the DOM applying every data-i18n* attribute found. Call on boot and
// whenever the language setting changes — cheap enough (a few hundred
// elements) to just re-run rather than diff.
export function applyTranslations(lang, root = document) {
  currentLang = lang || 'en'
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'), currentLang)
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'), currentLang)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'), currentLang)
  })
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'), currentLang)
  })
}
