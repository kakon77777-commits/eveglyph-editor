// ─── Typst PDF export — UI wiring (Phase 3) ────────────────────────────────
// Converts the active Markdown document to real typeset PDF via typstconvert.js
// + typstexport.js (WASM compiler, self-hosted — see those files' headers).
// First export in a session downloads ~51MB (compiler WASM ~27MB + local fonts
// ~24MB, incl. Traditional Chinese via Noto Serif TC), same-origin, cached by
// the browser after.
import { S } from './state.js'
import { editorGet } from './editor.js'
import { markdownToTypst } from './typstconvert.js'
import { compileTypstToPdf } from './typstexport.js'
import { monitor } from './monitor.js'
import { t } from './i18n/index.js'

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportActiveAsPdf() {
  if (!S.active || !/\.md$/i.test(S.active)) {
    alert(t('typstuiDynamic.openMdFirstAlert'))
    return
  }
  const btn = document.getElementById('btn-export-pdf')
  const original = btn.textContent
  btn.disabled = true
  btn.textContent = t('typstuiDynamic.compiling')
  const md = editorGet()
  await monitor('typst:export:start', { file: S.active, mdBytes: md.length })
  try {
    const typstSource = markdownToTypst(md)
    const pdfBytes = await compileTypstToPdf(typstSource)
    const base = S.active.replace(/^.*[\\/]/, '').replace(/\.md$/i, '') || 'document'
    downloadBytes(pdfBytes, `${base}.pdf`)
    await monitor('typst:export:success', { file: S.active, pdfBytes: pdfBytes.length })
  } catch (e) {
    const detail = Array.isArray(e) ? e.map(d => d.message || String(d)).join('; ') : (e?.message || String(e))
    await monitor('typst:export:error', { file: S.active, error: detail })
    alert(t('typstuiDynamic.exportFailedAlert', { message: detail }))
  } finally {
    btn.disabled = false
    btn.textContent = original
  }
}
