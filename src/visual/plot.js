// ─── Function Plot IR (roadmap Phase 5: Visual IR) ──────────────────────────
// Samples a single-variable expression across a domain and draws it as an
// SVG curve. Reuses AIMD-C's own expression evaluator (tokenize/
// parseExpression/evaluate) unmodified — a bare identifier already resolves
// against `env` by plain property lookup (evaluator.js's `case 'ident'`),
// so `evaluate(ast, {x: 1.5})` for a variable named `x` needed zero new
// evaluator code, just a new caller. Same closed-grammar, no-eval safety
// this app already relies on everywhere else.
import { tokenize, parseExpression, evaluate } from '../aimdc/evaluator.js'
import { parseAttrsString } from './chart.js'

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function parseDomain(raw, fallback) {
  const m = /^\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*$/.exec(String(raw || ''))
  if (!m) return fallback
  const a = Number(m[1]), b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) return fallback
  return [a, b]
}

function emptyPlot(message) {
  return `<div class="visual-block visual-empty">${esc(message)}</div>`
}

// Renders `fnSource` (e.g. "sin(x)", "x^2 - 3*x + 1") over `domain` as an
// SVG path. Never throws: a parse failure is an honest inline error (same
// "diagnose, don't crash" posture as aimdc/render.js's renderError); a
// point that fails to evaluate (e.g. 1/x at x=0, log(x) for x<0) is simply
// skipped — the curve breaks there instead of the whole plot disappearing.
export function renderFunctionPlot(fnSource, opts = {}) {
  const variable = (opts.variable || 'x').toLowerCase()
  const domain = parseDomain(opts.domain, [-10, 10])
  const samples = Math.min(Math.max(parseInt(opts.samples, 10) || 200, 20), 2000)
  const title = opts.title || ''

  let ast
  try { ast = parseExpression(tokenize(fnSource)) }
  catch (e) { return emptyPlot(`Could not parse "${fnSource}": ${e.message}`) }

  const [a, b] = domain
  const points = []
  for (let i = 0; i <= samples; i++) {
    const x = a + (b - a) * (i / samples)
    let y
    try { y = evaluate(ast, { [variable]: x }) }
    catch { y = null }
    points.push(Number.isFinite(y) ? { x, y } : null)
  }
  const finiteYs = points.filter(Boolean).map(p => p.y)
  if (!finiteYs.length) return emptyPlot(`"${fnSource}" never evaluated to a finite value over [${a}, ${b}].`)

  const W = 420, H = 260, padL = 40, padR = 16, padT = title ? 28 : 14, padB = 30
  const plotW = W - padL - padR, plotH = H - padT - padB
  const yMin = Math.min(...finiteYs), yMax = Math.max(...finiteYs)
  const yRange = (yMax - yMin) || 1
  const xToPx = (x) => padL + ((x - a) / (b - a)) * plotW
  const yToPx = (y) => padT + plotH - ((y - yMin) / yRange) * plotH

  // Break the path at each gap (null point) instead of drawing a straight
  // line across an undefined region.
  let d = ''
  let drawing = false
  for (const p of points) {
    if (!p) { drawing = false; continue }
    const px = xToPx(p.x).toFixed(1), py = yToPx(p.y).toFixed(1)
    d += (drawing ? ' L' : ' M') + px + ',' + py
    drawing = true
  }

  const zeroLine = (yMin < 0 && yMax > 0)
    ? `<line x1="${padL}" y1="${yToPx(0).toFixed(1)}" x2="${W - padR}" y2="${yToPx(0).toFixed(1)}" class="visual-axis-zero"/>`
    : ''
  const axis = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" class="visual-axis"/>` +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" class="visual-axis"/>`
  const domainLabels = `<text x="${padL}" y="${padT + plotH + 16}" class="visual-label">${esc(fmtAxisNum(a))}</text>` +
    `<text x="${W - padR}" y="${padT + plotH + 16}" text-anchor="end" class="visual-label">${esc(fmtAxisNum(b))}</text>`
  const rangeLabels = `<text x="${padL - 4}" y="${padT + 4}" text-anchor="end" class="visual-label">${esc(fmtAxisNum(yMax))}</text>` +
    `<text x="${padL - 4}" y="${padT + plotH}" text-anchor="end" class="visual-label">${esc(fmtAxisNum(yMin))}</text>`
  const titleHtml = title ? `<text x="${W / 2}" y="16" text-anchor="middle" class="visual-title">${esc(title)}</text>` : ''
  const curve = `<path d="${d.trim()}" fill="none" stroke="var(--ac)" stroke-width="2"/>`

  return `<div class="visual-block visual-chart">` +
    `<svg viewBox="0 0 ${W} ${H}" class="visual-svg">${titleHtml}${axis}${zeroLine}${curve}${domainLabels}${rangeLabels}</svg>` +
    `</div>`
}

function fmtAxisNum(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
}

// Standalone `::: plot {...} fn-body :::` block.
export function renderPlotBlock(rest, body) {
  const attrs = parseAttrsString(rest)
  const fnSource = body.trim()
  if (!fnSource) return emptyPlot('No function expression in the block body.')
  return renderFunctionPlot(fnSource, attrs)
}
