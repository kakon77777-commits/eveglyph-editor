// ─── IMPORT / CONVERT (v0.3) ──────────────────────────────────────
// DOCX → HTML (mammoth) → Markdown (turndown) → a no-AI rules pass → save into
// the workspace → open in the editor. The heavy libs are lazy-loaded (dynamic
// import) so they only cost bytes when the user actually imports a file.
// Three-stage workflow (whitepaper): import (formatting drifts) → rules cleanup
// (no tokens) → optional AI preset "Fix structure + EveGlyph-MD" (the 🔧 preset).
import { S }          from './state.js'
import { importFile } from './files.js'
import { monitor }    from './monitor.js'

// Stage 2 — rules pass. Normalize what a DOCX→MD conversion reliably mangles
// (heading spacing, list/blank-line noise). Deterministic, no AI. Exported so it
// can be re-run on demand later.
export function cleanupRules(md) {
  let s = String(md || '').replace(/\r\n?/g, '\n')
  s = s.replace(/[ \t]+$/gm, '')                       // trailing whitespace
  s = s.replace(/\n{3,}/g, '\n\n')                     // collapse blank-line runs
  s = s.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2')     // blank line BEFORE a heading
  s = s.replace(/^(#{1,6} .+)\n(?=[^\n])/gm, '$1\n\n') // blank line AFTER a heading
  s = s.replace(/\n{3,}/g, '\n\n')                     // re-collapse after inserts
  return s.trim() + '\n'
}

// A unique <base>.md name within the current workspace (never overwrite).
function uniqueName(base) {
  let name = `${base}.md`
  let n = 1
  while (S.files.has(name)) name = `${base}-${n++}.md`
  return name
}

export async function importDocx(file) {
  if (!file || !/\.docx$/i.test(file.name)) { alert('Drop a .docx file.'); return false }
  if (!S.workspaceMode) { alert('Open a workspace folder first, then import.'); return false }

  await monitor('import:docx:start', { name: file.name, bytes: file.size })
  try {
    // Stage 1 — convert. Lazy-load the converters.
    const [mammothMod, turndownMod] = await Promise.all([
      import('mammoth/mammoth.browser.js'),
      import('turndown')
    ])
    const mammoth = mammothMod.default || mammothMod
    const TurndownService = turndownMod.default || turndownMod
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })

    const arrayBuffer = await file.arrayBuffer()
    const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer })
    const md = cleanupRules(td.turndown(html || ''))   // stage 1 + stage 2

    const name = uniqueName(file.name.replace(/\.docx$/i, ''))
    const ok = await importFile(name, md)
    await monitor('import:docx:done', { name, ok, mdBytes: md.length, warnings: (messages || []).length })
    return ok
  } catch (e) {
    console.error(e)
    await monitor('import:docx:error', { error: String(e?.message || e) })
    alert('DOCX import failed: ' + (e?.message || e))
    return false
  }
}

// Import any dropped/selected files that are .docx (ignores the rest).
export async function importFiles(fileList) {
  for (const f of [...(fileList || [])]) {
    if (/\.docx$/i.test(f.name)) await importDocx(f)
  }
}
