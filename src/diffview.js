// ─── DIFF VIEW (PatchMD) ──────────────────────────────────────────
// Shared unified-diff renderer for the agent review panel (agent.js) and the
// workspace replace-all result (search.js) — one source of truth, no drift.
// A `git diff` is grouped into per-file cards, each with +adds / −dels counts and
// line-level coloring. Pure string→HTML: every line is escaped (agent/git output is
// UNTRUSTED) and rendered as text via textContent-equivalent escaping, never markup.

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

// Readable path from a "diff --git a/x b/x" header (handles spaces + rename forms).
function fileLabel(header) {
  const m = header.match(/^diff --git a\/(.+?) b\/(.+)$/)
  if (m) return m[2]
  return header.replace(/^diff --git\s*/, '').trim() || 'changes'
}

function lineClass(l) {
  if (l.startsWith('@@')) return 'd-hunk'
  if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ||
      l.startsWith('new file') || l.startsWith('deleted file') || l.startsWith('rename ') ||
      l.startsWith('similarity ') || l.startsWith('old mode') || l.startsWith('new mode')) return 'd-hdr'
  if (l.startsWith('+')) return 'd-add'
  if (l.startsWith('-')) return 'd-del'
  return 'd-ctx'
}

// Split a unified diff into per-file groups. Each group starts at a `diff --git`
// line; any preamble before the first one is kept as an untitled group.
function splitByFile(diff) {
  const groups = []
  let cur = null
  for (const l of (diff || '').split('\n')) {
    if (l.startsWith('diff --git ')) {
      cur = { label: fileLabel(l), lines: [], adds: 0, dels: 0 }
      groups.push(cur)
      continue
    }
    if (!cur) { cur = { label: '', lines: [], adds: 0, dels: 0 }; groups.push(cur) }
    cur.lines.push(l)
    if (l[0] === '+' && !l.startsWith('+++')) cur.adds++
    else if (l[0] === '-' && !l.startsWith('---')) cur.dels++
  }
  // Drop a leading empty untitled group (a diff that starts with `diff --git`).
  return groups.filter(g => g.label || g.lines.some(x => x.length))
}

// Render a unified diff as per-file <details> cards. `open` controls whether the
// cards start expanded (true for a fresh review; pass false for a compact recap).
export function renderDiffHTML(diff, { open = true } = {}) {
  const groups = splitByFile(diff)
  if (!groups.length) return '<pre class="diff"></pre>'
  return groups.map(g => {
    const body = g.lines.map(l => `<span class="${lineClass(l)}">${esc(l) || ' '}</span>`).join('\n')
    const counts = `<span class="df-counts"><span class="df-add">+${g.adds}</span><span class="df-del">−${g.dels}</span></span>`
    const name = esc(g.label || 'changes')
    return `<details class="dfile"${open ? ' open' : ''}>` +
      `<summary class="dfile-h"><span class="dfile-name" title="${name}">${name}</span>${counts}</summary>` +
      `<pre class="diff">${body}</pre>` +
      `</details>`
  }).join('')
}
