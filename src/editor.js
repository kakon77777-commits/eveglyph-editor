// ─── EDITOR ───────────────────────────────────────────────────────
import { basicSetup, EditorView } from 'codemirror'
import { EditorState }            from '@codemirror/state'
import { markdown }               from '@codemirror/lang-markdown'
import { oneDark }                from '@codemirror/theme-one-dark'

import { S }             from './state.js'
import { CONFIG }        from './config.js'
import { statusUpdate }  from './status.js'
import { tabUpdate }     from './tabs.js'
import { previewUpdate } from './preview.js'

export function editorInit(doc = '') {
  const wrap = document.getElementById('editor-container')
  const ph   = document.getElementById('editor-placeholder')
  if (ph) ph.remove()

  if (S.editor) { S.editor.destroy(); S.editor = null }

  const customTheme = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': {
      fontFamily: S.cfg.editorFontFamily || CONFIG.editor.fontFamily,
      fontSize: `${S.cfg.editorFontSize ?? CONFIG.editor.fontSize}px`,
      lineHeight: `${CONFIG.editor.lineHeight}`,
      padding: '16px 4px'
    },
    '.cm-gutters': { minWidth: '52px', borderRight: '1px solid var(--bdr)' }
  })

  // oneDark only in dark theme; light theme uses CodeMirror's default light styling.
  const darkTheme = (S.cfg.theme || CONFIG.theme) !== 'light'

  S.editor = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        ...(darkTheme ? [oneDark] : []),
        customTheme,
        EditorView.updateListener.of(u => {
          if (u.docChanged)    onDocChange()
          if (u.selectionSet) onSelChange()
        })
      ]
    }),
    parent: wrap
  })
}

export const editorGet     = ()    => S.editor?.state.doc.toString() ?? ''
export const editorSet     = (doc) => {
  if (!S.editor) { editorInit(doc); return }
  S.editor.dispatch({ changes: { from:0, to: S.editor.state.doc.length, insert: doc } })
}
export const editorGetSel  = ()    => {
  if (!S.editor) return ''
  const { from, to } = S.editor.state.selection.main
  return S.editor.state.sliceDoc(from, to)
}
export const editorReplace = (txt) => {
  if (!S.editor) return
  const { from, to } = S.editor.state.selection.main
  S.editor.dispatch({ changes: { from, to, insert: txt } })
  S.editor.focus()
}
export const editorAppend  = (txt) => {
  if (!S.editor) return
  const end = S.editor.state.doc.length
  S.editor.dispatch({ changes: { from: end, to: end, insert: '\n\n' + txt } })
  S.editor.focus()
}

// Select an absolute [from, from+len) range and scroll it into view — search's
// click-to-jump. Offsets are clamped so a stale result can never throw.
export function editorGoToMatch(from, len) {
  if (!S.editor) return
  const max = S.editor.state.doc.length
  const a = Math.min(Math.max(from, 0), max)
  const b = Math.min(a + Math.max(len, 0), max)
  S.editor.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true })
  S.editor.focus()
}

// Replace an absolute [from, to) range — search's replace-one. A single CodeMirror
// transaction, so it's undoable with Ctrl+Z (the §12.3 undo checkpoint for in-file edits).
export function editorReplaceRange(from, to, insert) {
  if (!S.editor) return
  const max = S.editor.state.doc.length
  const a = Math.min(Math.max(from, 0), max)
  const b = Math.min(Math.max(to, a), max)
  S.editor.dispatch({ changes: { from: a, to: b, insert }, selection: { anchor: a + insert.length }, scrollIntoView: true })
  S.editor.focus()
}

// Replace the whole doc WITHOUT flagging the file as modified.
// Used when reloading content from disk after an external/agent edit.
export const editorSetSilent = (doc) => {
  _docChangeSkip = true
  editorSet(doc)
  _docChangeSkip = false
}

// ─── EDITOR EVENTS ────────────────────────────────────────────────
let _previewTimer = null
let _docChangeSkip = false

function onDocChange() {
  if (_docChangeSkip || !S.active) return
  const fi = S.files.get(S.active)
  if (fi) { fi.modified = true; statusUpdate(); tabUpdate() }
  clearTimeout(_previewTimer)
  _previewTimer = setTimeout(previewUpdate, CONFIG.editor.previewDebounceMs)
}

function onSelChange() {
  const sel = editorGetSel()
  document.getElementById('ai-sel').textContent = sel
    ? (sel.length > 240 ? sel.slice(0,240) + '…' : sel) : '—'
  if (S.editor) {
    const pos  = S.editor.state.selection.main.head
    const line = S.editor.state.doc.lineAt(pos)
    document.getElementById('s-cursor').textContent =
      `Ln ${line.number}, Col ${pos - line.from + 1}`
  }
}
