// ─── VIEW REGISTRY ────────────────────────────────────────────────
// World IR content types get a specialized read-only preview projection
// instead of the Markdown pipeline; Markdown itself is just what's left
// over when nothing here claims the document. Each entry's `test` sniffs
// the raw YAML/text cheaply (a single regex against the top of the file,
// same style as smview.js's isStateMachineDoc) -- it must never throw and
// must never assume the document fully parses, since previewUpdate() calls
// this on every keystroke (debounced) including mid-edit invalid YAML.
//
// This is the "no pluggable view registry" gap noted in CHANGELOG.md's
// known-gaps list, closed just enough to add the next view types cleanly --
// not a general plugin API, just an ordered list checked top to bottom.

import { isStateMachineDoc, renderStateMachine } from './smview.js'
import { isEntityDoc, renderEntityForm, isEntityListDoc, renderEntityTable } from './entityview.js'

const VIEWS = [
  { test: isStateMachineDoc, render: renderStateMachine },
  { test: isEntityListDoc,   render: renderEntityTable },   // must precede isEntityDoc: both sniff top-of-file `kind:`, list is a distinct value
  { test: isEntityDoc,       render: renderEntityForm }
]

// Returns rendered HTML for the first matching view, or null if the
// document isn't claimed by any registered World IR view (caller's cue to
// fall back to the Markdown pipeline).
export function renderWorldIrProjection(src) {
  for (const view of VIEWS) {
    if (view.test(src)) return view.render(src)
  }
  return null
}
