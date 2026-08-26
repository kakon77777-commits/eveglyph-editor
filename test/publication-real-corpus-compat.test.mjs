import test from 'node:test'
import assert from 'node:assert/strict'

import { markdownToTypst } from '../src/typstconvert.js'
import { preparePublication } from '../src/publication/prepare.js'
import { renderTypstToPdf } from '../src/publication/node-renderer.js'

test('math delimiters inside Markdown code spans remain literal code', () => {
  const typst = markdownToTypst('**Canonical math delimiters:** `$...$` and `$$...$$`')
  assert.match(typst, /`\$\.\.\.\$`/)
  assert.match(typst, /`\$\$\.\.\.\$\$`/)
  assert.doesNotMatch(typst, /\n\$\s*\.\s*\.\s*\.\s*\$\n/)
})

test('CSM boxed display math becomes a real Typst content box', () => {
  const typst = markdownToTypst(String.raw`$$
\boxed{\text{Observed Proof Space} \neq \text{Admissible Proof Space}.}
$$`)
  assert.match(typst, /#rect\(stroke:/)
  assert.doesNotMatch(typst, /\$\s*boxed\b/)
})

test('CSM math textbf compatibility preserves bold text semantics', () => {
  const typst = markdownToTypst(String.raw`$$
\textbf{CSM Paper 01 — Globality Typing}
$$`)
  assert.match(typst, /upright\(bold\("CSM Paper 01 — Globality Typing"\)\)/)
})

test('CSM extensible arrow and textbf aliases compile without unknown variables', async () => {
  const source = String.raw`# CSM real-corpus compatibility

$$
X \xrightarrow{\mathsf{BridgeCert}} Y.
$$

$$
\mathfrak N_{\rm C}
\xleftrightarrow[\mathsf{Idealization}]{\mathsf{Interpretation}}
\mathfrak N_{\rm P}.
$$

$$
\boxed{\textbf{CSM Paper 01 — Globality Typing}.}
$$`
  const prepared = preparePublication(source, { profile: 'evemiss-academic-v1' })
  assert.doesNotMatch(prepared.typstSource, /\b(?:xrightarrow|xleftrightarrow|textbf|boxed)\b/)
  const result = await renderTypstToPdf(prepared.typstSource)
  assert.equal(Buffer.from(result.bytes).subarray(0, 5).toString('ascii'), '%PDF-')
  assert.ok(result.bytes.length > 1000)
})
