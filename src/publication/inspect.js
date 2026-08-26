import { marked } from 'marked'
import { parseFrontmatter } from '../frontmatter.js'

const EVEGLYPH_BLOCK_RE = /^:::[ \t]+([\w-]+)[^\n]*\r?\n[\s\S]*?^:::[ \t]*$/gm
const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g
const INLINE_MATH_RE = /\$[^$\n]+?\$/g

function walkTokens(tokens, counts, headings) {
  for (const token of tokens || []) {
    if (token.type === 'heading') {
      headings.push({ depth: token.depth, text: token.text || '' })
    } else if (token.type === 'table') {
      counts.tableCount += 1
    } else if (token.type === 'code') {
      counts.codeBlockCount += 1
    } else if (token.type === 'image') {
      counts.imageCount += 1
    }

    if (Array.isArray(token.tokens)) walkTokens(token.tokens, counts, headings)
    if (Array.isArray(token.items)) {
      for (const item of token.items) walkTokens(item.tokens, counts, headings)
    }
    if (Array.isArray(token.header)) {
      for (const cell of token.header) walkTokens(cell.tokens, counts, headings)
    }
    if (Array.isArray(token.rows)) {
      for (const row of token.rows) for (const cell of row) walkTokens(cell.tokens, counts, headings)
    }
  }
}

function countEveGlyphBlocks(source) {
  const result = { callout: 0, aimd: 0, aimdc: 0 }
  EVEGLYPH_BLOCK_RE.lastIndex = 0
  let match
  while ((match = EVEGLYPH_BLOCK_RE.exec(source))) {
    const type = match[1].toLowerCase()
    if (type === 'aimd') result.aimd += 1
    else if (type.startsWith('aimd-')) result.aimdc += 1
    else result.callout += 1
  }
  return result
}

function countImages(tokens) {
  let count = 0
  marked.walkTokens(tokens, token => {
    if (token.type === 'image') count += 1
  })
  return count
}

export function inspectDocument(source = '') {
  if (typeof source !== 'string') throw new TypeError('source must be a string')

  const { data, body } = parseFrontmatter(source)
  const displayMath = body.match(DISPLAY_MATH_RE) || []
  const withoutDisplayMath = body.replace(DISPLAY_MATH_RE, '')
  const inlineMath = withoutDisplayMath.match(INLINE_MATH_RE) || []
  const tokens = marked.lexer(body)
  const headings = []
  const counts = { tableCount: 0, imageCount: 0, codeBlockCount: 0 }
  walkTokens(tokens, counts, headings)
  counts.imageCount = countImages(tokens)

  const title = typeof data.title === 'string' && data.title
    ? data.title
    : (headings.find(h => h.depth === 1)?.text || '')

  return {
    title,
    metadata: { ...data },
    headings,
    characters: body.length,
    inlineMathCount: inlineMath.length,
    displayMathCount: displayMath.length,
    tableCount: counts.tableCount,
    imageCount: counts.imageCount,
    codeBlockCount: counts.codeBlockCount,
    eveglyphBlocks: countEveGlyphBlocks(body),
    notices: [],
  }
}
