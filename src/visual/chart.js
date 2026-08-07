// ─── Chart IR (roadmap Phase 5: Visual IR) ──────────────────────────────────
// Self-contained single-series bar/line/pie charts — the same "own inline
// YAML data, no source= yet" scope aimd-table shipped with in Phase 3
// (multi-series is a real, deferred extension, not attempted here: it needs
// a legend, per-series color assignment, and axis scaling across series,
// none of which a single-series v1 needs). Hand-rolled SVG, no charting
// library — matches this project's standing "no framework, hand-rolled"
// convention (the math evaluator, i18n, and the Typst converter are all
// the same choice for the same reason: small, fully-understood, no
// supply-chain surface for something this codebase can just draw itself).
import jsYaml from 'js-yaml'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function parseChartAttrs(attrs) {
  return {
    id: attrs.id || null,
    chartType: (attrs.type || 'bar').toLowerCase(),
    title: attrs.title || '',
  }
}

// `rows` is a plain array of `{label, value}` (or any two keys — the first
// string-ish field is treated as the label, the first number-ish field as
// the value, so `- category: ...\n  amount: ...` works just as well as
// `- label: ...\n  value: ...`; no fixed key names to memorize).
export function normalizeChartRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map(r => {
    if (!r || typeof r !== 'object') return null
    const keys = Object.keys(r)
    const labelKey = keys.find(k => typeof r[k] === 'string') || keys[0]
    const valueKey = keys.find(k => typeof r[k] === 'number')
    if (valueKey === undefined) return null
    return { label: String(r[labelKey] ?? ''), value: Number(r[valueKey]) }
  }).filter(Boolean)
}

const CHART_COLORS = ['var(--ac)', '#a78bfa', '#fbbf24', '#4ade80', '#f87171', '#60a5fa', '#f472b6', '#38bdf8']

function emptyChart(message) {
  return `<div class="visual-block visual-empty">${esc(message)}</div>`
}

function barChartSvg(rows, title) {
  const W = 420, H = 260, padL = 36, padB = 34, padT = title ? 28 : 12, padR = 12
  const plotW = W - padL - padR, plotH = H - padT - padB
  const max = Math.max(...rows.map(r => r.value), 0)
  const barW = plotW / rows.length
  const bars = rows.map((r, i) => {
    const h = max > 0 ? (r.value / max) * plotH : 0
    const x = padL + i * barW + barW * 0.12
    const w = barW * 0.76
    const y = padT + (plotH - h)
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="var(--ac)" rx="2"/>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="visual-val">${esc(fmtNum(r.value))}</text>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="${(padT + plotH + 16).toFixed(1)}" text-anchor="middle" class="visual-label">${esc(truncateLabel(r.label))}</text>`
  }).join('')
  return svgWrap(W, H, bars, title, padL, padT, plotH)
}

function lineChartSvg(rows, title) {
  const W = 420, H = 260, padL = 36, padB = 34, padT = title ? 28 : 12, padR = 12
  const plotW = W - padL - padR, plotH = H - padT - padB
  const values = rows.map(r => r.value)
  const max = Math.max(...values), min = Math.min(0, ...values)
  const range = (max - min) || 1
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0
  const points = rows.map((r, i) => {
    const x = padL + i * stepX
    const y = padT + plotH - ((r.value - min) / range) * plotH
    return { x, y, r }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const dots = points.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--ac)"/>` +
    `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" class="visual-val">${esc(fmtNum(p.r.value))}</text>` +
    `<text x="${p.x.toFixed(1)}" y="${(padT + plotH + 16).toFixed(1)}" text-anchor="middle" class="visual-label">${esc(truncateLabel(p.r.label))}</text>`
  ).join('')
  const line = `<path d="${path}" fill="none" stroke="var(--ac)" stroke-width="2"/>`
  return svgWrap(W, H, line + dots, title, padL, padT, plotH)
}

function pieChartSvg(rows, title) {
  const W = 300, H = 260, cx = W / 2, cy = title ? 140 : 130, radius = 96
  const total = rows.reduce((s, r) => s + Math.max(r.value, 0), 0)
  if (total <= 0) return emptyChart('All values are zero or negative — nothing to draw.')
  let angle = -Math.PI / 2
  const slices = rows.map((r, i) => {
    const frac = Math.max(r.value, 0) / total
    const a0 = angle
    const a1 = angle + frac * Math.PI * 2
    angle = a1
    const x0 = cx + radius * Math.cos(a0), y0 = cy + radius * Math.sin(a0)
    const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1)
    const large = (a1 - a0) > Math.PI ? 1 : 0
    const color = CHART_COLORS[i % CHART_COLORS.length]
    const path = frac >= 0.999
      ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`
      : `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${radius},${radius} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${color}"/>`
    return path
  }).join('')
  const legend = rows.map((r, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length]
    const pct = ((Math.max(r.value, 0) / total) * 100).toFixed(1)
    return `<div class="visual-legend-item"><span class="visual-legend-swatch" style="background:${color}"></span>${esc(r.label)} — ${esc(fmtNum(r.value))} (${pct}%)</div>`
  }).join('')
  const titleHtml = title ? `<text x="${cx}" y="18" text-anchor="middle" class="visual-title">${esc(title)}</text>` : ''
  return `<div class="visual-block visual-chart">` +
    `<svg viewBox="0 0 ${W} ${H}" class="visual-svg">${titleHtml}${slices}</svg>` +
    `<div class="visual-legend">${legend}</div>` +
    `</div>`
}

function svgWrap(W, H, inner, title, padL, padT, plotH) {
  const titleHtml = title ? `<text x="${W / 2}" y="16" text-anchor="middle" class="visual-title">${esc(title)}</text>` : ''
  const axis = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - 12}" y2="${padT + plotH}" class="visual-axis"/>` +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" class="visual-axis"/>`
  return `<div class="visual-block visual-chart">` +
    `<svg viewBox="0 0 ${W} ${H}" class="visual-svg">${titleHtml}${axis}${inner}</svg>` +
    `</div>`
}

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
}
function truncateLabel(s) {
  return s.length > 10 ? s.slice(0, 9) + '…' : s
}

export function renderChartFromRows(rows, opts) {
  const norm = normalizeChartRows(rows)
  if (!norm.length) return emptyChart('No rows, or no numeric value field found.')
  if (opts.chartType === 'line') return lineChartSvg(norm, opts.title)
  if (opts.chartType === 'pie') return pieChartSvg(norm, opts.title)
  return barChartSvg(norm, opts.title)   // 'bar' is the default for any unrecognized type
}

// Standalone `::: chart {...} ... :::` block — self-contained YAML rows,
// same "own inline data" scope as aimd-table.
export function renderChartBlock(rest, body) {
  const attrs = parseAttrsString(rest)
  const opts = parseChartAttrs(attrs)
  let rows
  try { rows = jsYaml.load(body.trim()) || [] }
  catch (e) { return emptyChart(`Invalid chart data: ${e.message}`) }
  return renderChartFromRows(rows, opts)
}

// Shared with plot.js — the same `{key="value"}` attribute shape every
// `:::` block in this app uses.
export function parseAttrsString(rest) {
  const attrs = {}
  const re = /([\w-]+)="([^"]*)"/g
  let m
  while ((m = re.exec(rest))) attrs[m[1]] = m[2]
  return attrs
}
