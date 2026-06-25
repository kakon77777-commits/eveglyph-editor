// ─── MONITOR VIEWER ───────────────────────────────────────────────
// Reads back the PHOSPHOR diagnostic stream (eveglyph-monitor.jsonl) the bridge writes
// — a back-stage "what just happened" panel for debugging agent runs, file I/O, git
// snapshots and UI events. Read-only; needs the bridge (dev server) up, and the GET
// endpoint that ships with it (older/un-restarted bridges degrade to a hint).
// Event text is rendered via textContent (never innerHTML) — agent stdout samples and
// file paths in the stream are untrusted.
import { CONFIG } from './config.js'

let lastEvents = []
let lastFilter = ''
let autoTimer = null

// Colour bucket by event family (rules in styles.css: .mon-agent/.mon-git/.mon-file/…).
function typeClass(type = '') {
  if (/error/i.test(type)) return 'mon-error'
  if (type.startsWith('agent:')) return 'mon-agent'
  if (type.startsWith('git:')) return 'mon-git'
  if (type.startsWith('file:') || type.startsWith('workspace:')) return 'mon-file'
  if (type.startsWith('ui:')) return 'mon-ui'
  return ''
}

// Compact one-line payload: the non-envelope fields as `key=val`, each value truncated.
function summarize(evt) {
  const skip = new Set(['stream', 'proto', 'seq', 'ts', 'type'])
  const parts = []
  for (const [k, v] of Object.entries(evt)) {
    if (skip.has(k) || v === null || v === undefined || v === '') continue
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (s.length > 80) s = s.slice(0, 80) + '…'
    parts.push(`${k}=${s}`)
  }
  return parts.join('  ')
}

const hhmmss = (ts) => { try { return new Date(ts).toLocaleTimeString() } catch { return ts || '' } }

export async function loadMonitor() {
  const body = document.getElementById('monitor-body')
  const status = document.getElementById('monitor-status')
  if (!body) return
  try {
    const r = await fetch(`/api/monitor?limit=${CONFIG.monitorView.limit}`)
    const ct = r.headers.get('content-type') || ''
    // A POST-only (pre-restart) bridge falls through to Vite, which serves text/html.
    if (!ct.includes('application/json')) throw new Error('bridge-old')
    const data = await r.json()
    if (!r.ok) throw new Error(data?.error || `monitor error (${r.status})`)   // a real bridge error → surface it
    lastEvents = (Array.isArray(data.events) ? data.events : []).filter(e => e && typeof e === 'object')
    renderMonitor()
    if (status) status.textContent = data.exists
      ? `${lastEvents.length} event(s) · ${(data.file || '').split(/[\\/]/).pop() || ''}`
      : 'No events yet — the stream is created on first activity.'
  } catch (e) {
    lastEvents = []
    body.replaceChildren()
    if (status) status.textContent =
      e?.message === 'bridge-old' ? 'Restart the dev server (start-eveglyph.bat) to enable the monitor viewer.'
      : e?.name === 'TypeError'   ? 'Bridge offline — start the dev server to view the monitor stream.'
      : (e?.message || 'Monitor unavailable.')
  }
}

function renderMonitor() {
  const body = document.getElementById('monitor-body')
  if (!body) return
  body.replaceChildren()
  const f = lastFilter.toLowerCase()
  const rows = lastEvents.filter(e => !f ||
    (e.type || '').toLowerCase().includes(f) || summarize(e).toLowerCase().includes(f))

  if (!rows.length) {
    const d = document.createElement('div')
    d.className = 'mon-empty'
    d.textContent = f ? 'No matching events.' : 'No events.'
    body.appendChild(d)
    return
  }
  for (const e of rows) {
    const row = document.createElement('div')
    row.className = ('mon-row ' + typeClass(e.type)).trim()
    const t = document.createElement('span');  t.className = 'mon-time';    t.textContent = hhmmss(e.ts)
    const ty = document.createElement('span'); ty.className = 'mon-type';   ty.textContent = e.type || '?'
    const p = document.createElement('span');  p.className = 'mon-payload'; p.textContent = summarize(e)
    row.append(t, ty, p)
    body.appendChild(row)
  }
  body.scrollTop = body.scrollHeight   // newest at the bottom
}

export function setMonitorFilter(v) { lastFilter = v || ''; renderMonitor() }

export function startMonitorAuto() {
  stopMonitorAuto()
  autoTimer = setInterval(loadMonitor, CONFIG.monitorView.autoRefreshMs)
}
export function stopMonitorAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null } }
