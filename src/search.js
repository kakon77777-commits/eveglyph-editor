// ─── EXACT SEARCH (v0.3) ──────────────────────────────────────────
// A visible, human-owned navigator — NOT AI. Whitepaper §5.2 / §12.1: the
// editor's eyes. Exact string/regex/case/whole-word search over the current file
// or the whole workspace, with a results list and click-to-jump. (AI semantic
// search is a separate future track, §12.2.)
import { S }                 from './state.js'
import { CONFIG }            from './config.js'
import { editorGet, editorGoToMatch, editorSet, editorReplaceRange } from './editor.js'
import { openFile, refreshFromDisk, saveFile } from './files.js'
import { monitor }           from './monitor.js'
import { renderDiffHTML }    from './diffview.js'

const $ = (id) => document.getElementById(id)

function buildRegex(q, { regex, caseSensitive, wholeWord }) {
  let pattern = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (wholeWord) pattern = `\\b(?:${pattern})\\b`   // group so \b binds the WHOLE pattern, not just the first/last alternative
  return new RegExp(pattern, 'g' + (caseSensitive ? '' : 'i'))
}

// Collect every match in one text body → {path, offset, len, line, snippet}.
function findInText(text, re, path) {
  const out = []
  re.lastIndex = 0
  let m, guard = 0
  while ((m = re.exec(text)) && guard++ < CONFIG.search.matchCapPerFile) {
    if (m[0] === '') { re.lastIndex++; continue }     // zero-width match → don't spin
    const offset = m.index
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1
    const nl = text.indexOf('\n', offset)
    const lineEnd = nl === -1 ? text.length : nl
    const line = text.slice(0, offset).split('\n').length
    out.push({ path, offset, len: m[0].length, line, snippet: text.slice(lineStart, lineEnd).trim().slice(0, CONFIG.search.snippetMaxChars) })
  }
  return out
}

async function textForPath(path) {
  if (path === S.active) return editorGet()           // freshest (may be unsaved)
  const fi = S.files.get(path)
  if (!fi) return null
  if (fi.content != null) return fi.content            // cached
  if (fi.source !== 'bridge') return null              // picker files we haven't opened → skip
  try {
    const r = await fetch(`/api/workspace/file?${new URLSearchParams({ cwd: S.workspaceRoot, path })}`)
    if (!r.ok) return null
    return (await r.json()).content || ''
  } catch { return null }
}

export async function runSearch() {
  const q = $('search-input').value
  const out = $('search-results')
  if (!q.trim()) { out.innerHTML = ''; return }

  const opts = {
    regex: $('search-regex').checked,
    caseSensitive: $('search-case').checked,
    wholeWord: $('search-word').checked
  }
  const scope = document.querySelector('input[name="search-scope"]:checked')?.value || 'file'

  let re
  try { re = buildRegex(q, opts) }
  catch (e) { out.innerHTML = `<div class="search-empty">Invalid regex: ${esc(e.message)}</div>`; return }

  await monitor('search:run', { scope, ...opts, qlen: q.length })

  let all = []
  if (scope === 'file') {
    if (S.active) all = findInText(editorGet(), re, S.active)
  } else {
    out.innerHTML = '<div class="search-empty">Searching…</div>'
    for (const path of [...S.files.keys()]) {
      const text = await textForPath(path)
      if (text != null) all.push(...findInText(text, re, path))
    }
  }
  renderResults(all)
}

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

function renderResults(results) {
  const out = $('search-results')
  if (!results.length) { out.innerHTML = '<div class="search-empty">No matches.</div>'; return }

  const byFile = new Map()
  for (const r of results) { (byFile.get(r.path) || byFile.set(r.path, []).get(r.path)).push(r) }

  out.innerHTML = ''
  const head = document.createElement('div')
  head.className = 'search-count'
  head.textContent = `${results.length} match${results.length === 1 ? '' : 'es'} · ${byFile.size} file${byFile.size === 1 ? '' : 's'}`
  out.appendChild(head)

  for (const [path, list] of byFile) {
    const fh = document.createElement('div')
    fh.className = 'search-file'
    fh.textContent = path
    out.appendChild(fh)
    for (const r of list) {
      const item = document.createElement('div')
      item.className = 'search-hit'
      const ln = document.createElement('span'); ln.className = 'search-ln'; ln.textContent = r.line
      const sn = document.createElement('span'); sn.className = 'search-snip'; sn.textContent = r.snippet
      const rep = document.createElement('button'); rep.className = 'search-rep'; rep.textContent = 'replace'; rep.title = 'Replace this match (undoable)'
      rep.onclick = (e) => { e.stopPropagation(); replaceOne(r) }
      item.append(ln, sn, rep)
      item.onclick = () => jumpTo(r)
      out.appendChild(item)
    }
  }
}

async function jumpTo(r) {
  if (r.path !== S.active) await openFile(r.path)
  editorGoToMatch(r.offset, r.len)
  await monitor('search:jump', { path: r.path, line: r.line })
}

// ─── REPLACE (Phase 2, §12.3 conservative) ────────────────────────
const readOpts = () => ({ regex: $('search-regex').checked, caseSensitive: $('search-case').checked, wholeWord: $('search-word').checked })

// Replacement spec for String.replace: regex mode keeps $1 capture-group expansion;
// literal mode escapes $ so the replacement text is inserted verbatim.
const replSpec = (repl, regex) => regex ? repl : repl.replace(/\$/g, '$$$$')

// Replace ONE match — always routed through the editor (open the file first if
// needed) so it's undoable with Ctrl+Z and only touches disk when the user saves.
async function replaceOne(r) {
  const q = $('search-input').value
  if (!q.trim()) return
  const opts = readOpts()
  let re; try { re = buildRegex(q, opts) } catch { return }
  const single = new RegExp(re.source, re.flags.replace('g', ''))
  const spec = replSpec($('search-replace').value, opts.regex)

  if (r.path !== S.active) await openFile(r.path)
  const text = editorGet()
  const matchText = text.slice(r.offset, r.offset + r.len)
  if (!single.test(matchText)) { runSearch(); return }   // stale offset (doc changed) → refresh and bail
  editorReplaceRange(r.offset, r.offset + r.len, matchText.replace(single, spec))
  await monitor('search:replace-one', { path: r.path })
  runSearch()
}

// Replace ALL in scope. In-file → one undoable editor transaction (Ctrl+Z).
// Workspace → git snapshot (undo checkpoint) → write changed files → diff + Revert.
export async function replaceAll() {
  const q = $('search-input').value
  const repl = $('search-replace').value
  const out = $('search-results')
  if (!q.trim()) return
  const opts = readOpts()
  let re; try { re = buildRegex(q, opts) } catch (e) { out.innerHTML = `<div class="search-empty">Invalid regex: ${esc(e.message)}</div>`; return }
  const spec = replSpec(repl, opts.regex)
  const scope = document.querySelector('input[name="search-scope"]:checked')?.value || 'file'

  // Gather targets + total count (for the confirmation).
  const targets = []
  let total = 0
  const paths = scope === 'file' ? (S.active ? [S.active] : []) : [...S.files.keys()]
  for (const path of paths) {
    const text = path === S.active ? editorGet() : await textForPath(path)
    if (text == null) continue
    re.lastIndex = 0
    const count = (text.match(re) || []).length
    if (!count) continue
    targets.push({ path, newText: text.replace(re, spec) })
    total += count
  }
  if (!total) { out.innerHTML = '<div class="search-empty">No matches to replace.</div>'; return }

  const warn = opts.regex ? '\n\n⚠ Regex replace: $1, $2 … expand capture groups.' : ''
  const where = scope === 'file' ? 'the current file' : `${targets.length} file(s)`
  if (!confirm(`Replace ${total} match${total === 1 ? '' : 'es'} in ${where} with "${repl}"?${warn}`)) return

  if (scope === 'file') {
    editorSet(targets[0].newText)   // one transaction → Ctrl+Z undoes the whole replace
    await monitor('search:replace-all', { scope, total })
    runSearch()
    return
  }

  // Workspace: the dangerous bulk op gets the heavy safety.
  const cwd = S.workspaceRoot
  out.innerHTML = '<div class="search-empty">Replacing…</div>'

  // Fold the active file's unsaved edits into the baseline first, so the snapshot
  // captures the user's actual work and Revert restores it (not just their last save).
  if (S.active && S.files.get(S.active)?.modified) { try { await saveFile() } catch {} }

  let reviewable = false
  try {
    const s = await fetch('/api/git/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, label: `pre-replace: ${q} -> ${repl}` }) }).then(r => r.json())
    reviewable = Boolean(s?.ok && s?.available)
  } catch {}

  // No git checkpoint → this bulk overwrite CANNOT be undone. Warn BEFORE writing.
  if (!reviewable && !confirm(`⚠ Git is unavailable here, so replacing across ${targets.length} file(s) CANNOT be undone. Proceed anyway?`)) {
    runSearch(); return
  }

  const failed = []
  for (const t of targets) {
    const fi = S.files.get(t.path)
    try {
      const r = await fetch('/api/workspace/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, path: t.path, content: t.newText, encoding: fi?.encoding || S.cfg.defaultEncoding || 'UTF-8' }) })
      if (!r.ok) failed.push(t.path)
    } catch { failed.push(t.path) }
  }
  await refreshFromDisk()
  await monitor('search:replace-all', { scope, total, files: targets.length, failed: failed.length })

  let diff = null
  if (reviewable) { try { diff = await fetch(`/api/git/diff?${new URLSearchParams({ cwd })}`).then(r => r.json()) } catch {} }
  renderReplaceResult(total, targets.length, diff, reviewable, cwd, failed)
}

function renderReplaceResult(total, fileCount, diff, reviewable, cwd, failed = []) {
  const out = $('search-results')
  out.innerHTML = ''
  const okFiles = fileCount - failed.length
  const head = document.createElement('div'); head.className = 'search-count'
  head.textContent = `Replaced in ${okFiles} file${okFiles === 1 ? '' : 's'}${reviewable ? ' — review the diff, then Revert to undo.' : ' (git unavailable → no undo).'}`
  out.appendChild(head)
  if (failed.length) {
    const warn = document.createElement('div'); warn.className = 'search-empty'; warn.style.color = 'var(--err)'
    warn.textContent = `⚠ ${failed.length} file(s) failed to write: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`
    out.appendChild(warn)
  }
  if (diff?.available && diff.hasChanges) {
    const box = document.createElement('div'); box.className = 'diff-files'
    box.innerHTML = renderDiffHTML(diff.diff)
    out.appendChild(box)
  }
  if (reviewable) {
    const btn = document.createElement('button'); btn.className = 'btn-g danger'; btn.textContent = '↩ Revert replace'; btn.style.marginTop = '8px'
    btn.onclick = () => revertReplace(cwd)
    out.appendChild(btn)
  }
}

async function revertReplace(cwd) {
  try {
    await fetch('/api/git/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd }) })
    await refreshFromDisk()
    $('search-results').innerHTML = '<div class="search-empty">↩ Reverted — replacements discarded.</div>'
    await monitor('search:replace:revert', { cwd })
  } catch (e) {
    $('search-results').innerHTML = `<div class="search-empty">Revert failed: ${esc(e.message)}</div>`
  }
}
