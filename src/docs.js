// ─── DOCS (User Guide + Changelog) ───────────────────────────────
// Renders the repo's own USER-GUIDE.md and CHANGELOG.md inside the app, so "what
// changed" and "how do I use this" are readable without leaving the editor or
// digging through the repo on disk. Static content (not workspace-dependent), so
// it's rendered once at startup, not on every previewUpdate() like the main editor.
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import guideRaw from '../USER-GUIDE.md?raw'
import changelogRaw from '../CHANGELOG.md?raw'

// No injected <h1> wrapper here - USER-GUIDE.md and CHANGELOG.md both already open
// with their own top-level `# ...` heading, so adding another would just duplicate it.
function renderDocSection(id, raw) {
  const html = marked ? marked.parse(raw) : raw
  return `<section id="${id}" class="docs-section">${DOMPurify.sanitize(html)}</section>`
}

export function initDocs() {
  const body = document.getElementById('docs-body')
  if (!body) return
  body.innerHTML =
    renderDocSection('docs-guide', guideRaw) +
    renderDocSection('docs-changelog', changelogRaw)
}

// Switches to the Docs tab (reusing the existing generic .ptab handler in main.js)
// and scrolls to the given section - used by the topbar "What's new" link and the
// two in-panel nav buttons.
export function openDocsSection(sectionId) {
  document.querySelector('.ptab[data-t="docs"]')?.click()
  // Called synchronously, not deferred via requestAnimationFrame: rAF is throttled
  // in a backgrounded/unfocused tab (can silently never fire), and it isn't needed
  // anyway - scrollIntoView triggers its own synchronous layout pass, so it sees
  // the tab's just-removed `display:none` correctly without waiting a frame.
  document.getElementById(sectionId)?.scrollIntoView({ block: 'start' })
}
