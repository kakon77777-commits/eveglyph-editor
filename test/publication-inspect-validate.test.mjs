import test from 'node:test'
import assert from 'node:assert/strict'

import { inspectDocument } from '../src/publication/inspect.js'
import { validateDocument } from '../src/publication/validate.js'

const sample = `---
title: 測試論文
---
# 第一章

中文正文與 inline math $x^2 + y^2$。

$$
E = mc^2
$$

## 表格

| A | B |
|---|---|
| 1 | 2 |

![圖](figure.png)

\`\`\`js
console.log('ok')
\`\`\`

::: theorem title="命題"
內容。
:::

::: aimd
@id: node
ordinary prose
:::

::: aimd-value id="x" type="number"
2
:::
`

test('inspectDocument returns publication-relevant structure without changing source', () => {
  const before = sample
  const result = inspectDocument(sample)

  assert.equal(result.title, '測試論文')
  assert.equal(result.metadata.title, '測試論文')
  assert.equal(result.headings.length, 2)
  assert.deepEqual(result.headings.map(h => h.depth), [1, 2])
  assert.equal(result.inlineMathCount, 1)
  assert.equal(result.displayMathCount, 1)
  assert.equal(result.tableCount, 1)
  assert.equal(result.imageCount, 1)
  assert.equal(result.codeBlockCount, 1)
  assert.deepEqual(result.eveglyphBlocks, { callout: 1, aimd: 1, aimdc: 1 })
  assert.equal(sample, before)
})

test('validateDocument rejects unknown publication profile', () => {
  const result = validateDocument('# Title', { profile: 'unknown-profile' })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, 'invalid_profile')
})

test('validateDocument reports unbalanced display math and unclosed fences', () => {
  const result = validateDocument('# T\n\n$$\nx + 1\n\n```js\nconst x = 1')
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.code === 'unbalanced_display_math'))
  assert.ok(result.errors.some(e => e.code === 'unclosed_code_fence'))
})

test('validateDocument reports an unmatched inline math delimiter outside code and display math', () => {
  const result = validateDocument('# T\n\n正文 $x + 1')
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.code === 'unbalanced_inline_math'))
})

test('validateDocument ignores dollar signs inside fenced code', () => {
  const result = validateDocument('# T\n\n```js\nconst price = "$5"\n```')
  assert.equal(result.ok, true)
})

test('validateDocument reports an unclosed EveGlyph block', () => {
  const result = validateDocument('::: theorem\ncontent')
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.code === 'unclosed_eveglyph_block'))
})

test('validateDocument accepts a normal Chinese technical document', () => {
  const result = validateDocument(sample, { profile: 'evemiss-academic-v1' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.resolvedProfile.id, 'evemiss-academic-v1')
})
