import { markdownToTypst } from '../typstconvert.js'
import { resolvePublicationProfile } from './profiles.js'

function error(code, message) {
  return { code, message }
}

function stripFencedCode(source) {
  return source.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g, '$1')
}

function hasUnclosedCodeFence(source) {
  const lines = source.split(/\r?\n/)
  let fence = null
  for (const line of lines) {
    const match = line.match(/^[ \t]*(```+|~~~+)/)
    if (!match) continue
    const marker = match[1][0]
    if (!fence) fence = marker
    else if (marker === fence) fence = null
  }
  return fence !== null
}

function hasUnclosedEveGlyphBlock(source) {
  let depth = 0
  for (const line of source.split(/\r?\n/)) {
    if (/^:::[ \t]+[\w-]+/.test(line)) depth += 1
    else if (/^:::[ \t]*$/.test(line) && depth > 0) depth -= 1
  }
  return depth !== 0
}

function countUnescapedInlineDelimiters(source) {
  // Display math is removed first so each `$$` pair is not mistaken for two
  // inline delimiters. A backslash escapes a literal dollar in prose.
  const withoutDisplay = source.replace(/\$\$[\s\S]*?\$\$/g, '')
  let count = 0
  for (let i = 0; i < withoutDisplay.length; i++) {
    if (withoutDisplay[i] !== '$') continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && withoutDisplay[j] === '\\'; j--) backslashes += 1
    if (backslashes % 2 === 0) count += 1
  }
  return count
}

export function validateDocument(source, { profile } = {}) {
  const errors = []
  const warnings = []
  const notices = []
  let resolvedProfile = null

  if (typeof source !== 'string') {
    errors.push(error('invalid_source', 'source must be a string'))
    return { ok: false, errors, warnings, notices, resolvedProfile }
  }

  try {
    resolvedProfile = resolvePublicationProfile(profile)
  } catch (e) {
    errors.push(error('invalid_profile', e.message))
  }

  if (hasUnclosedCodeFence(source)) {
    errors.push(error('unclosed_code_fence', 'document contains an unclosed fenced code block'))
  }
  if (hasUnclosedEveGlyphBlock(source)) {
    errors.push(error('unclosed_eveglyph_block', 'document contains an unclosed EveGlyph ::: block'))
  }

  const prose = stripFencedCode(source)
  const displayDelimiterCount = (prose.match(/\$\$/g) || []).length
  if (displayDelimiterCount % 2 !== 0) {
    errors.push(error('unbalanced_display_math', 'document contains an unmatched $$ display-math delimiter'))
  }

  if (displayDelimiterCount % 2 === 0 && countUnescapedInlineDelimiters(prose) % 2 !== 0) {
    errors.push(error('unbalanced_inline_math', 'document contains an unmatched $ inline-math delimiter'))
  }

  if (!errors.some(e => e.code === 'unclosed_code_fence' || e.code === 'unclosed_eveglyph_block')) {
    try {
      markdownToTypst(source)
    } catch (e) {
      errors.push(error('conversion_error', e?.message || String(e)))
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notices,
    resolvedProfile,
  }
}
