---
type: note
status: draft
tags: [visual-ir, chart, plot, phase-5]
---

# Visual IR — chart & function-plot demo

Roadmap v0.6 Phase 5: chart and function-plot rendering, hand-rolled SVG, no
charting library. This pass is deliberately scoped to **single-series**
charts and **HTML/SVG preview only** — multi-series legends and Typst PDF
projection are real, separate follow-ups, not built here (see PROGRESS.md).

## Standalone chart — own inline data

Same "self-contained YAML rows" shape `aimd-table` already uses. `type` is
`bar` (default), `line`, or `pie`.

::: chart {id="quarterly" type="bar" title="Quarterly Revenue"}
- label: Q1
  value: 120
- label: Q2
  value: 150
- label: Q3
  value: 90
- label: Q4
  value: 205
:::

Same data, as a line chart:

::: chart {id="quarterly-line" type="line" title="Quarterly Revenue (trend)"}
- label: Q1
  value: 120
- label: Q2
  value: 150
- label: Q3
  value: 90
- label: Q4
  value: 205
:::

And as a pie chart — any key names work, not just `label`/`value` (the
first string field is the label, the first number field is the value):

::: chart {id="share" type="pie" title="Market Share"}
- product: Alpha
  share: 42
- product: Beta
  share: 31
- product: Gamma
  share: 27
:::

## Standalone function plot

The expression in the body is evaluated with AIMD-C's own evaluator
(`src/aimdc/evaluator.js`) — same arithmetic/trig/log grammar, no `eval`.
`domain="[a, b]"` sets the x-range; the y-range auto-scales to what the
function actually produces over that domain.

::: plot {id="sine" domain="[-6.28, 6.28]" title="y = sin(x)"}
sin(x)
:::

::: plot {id="parabola" domain="[-5, 5]" title="y = x^2 - 3x + 1"}
x^2 - 3*x + 1
:::

A function with an undefined region breaks the curve there instead of
drawing a straight line across it or failing the whole plot:

::: plot {id="reciprocal" domain="[-4, 4]" title="y = 1/x"}
1/x
:::

## Chart fed by an AIMD-C computed table

`aimd-view {renderer="chart"}` reuses this exact same chart renderer, just
sourced from a live computed value instead of literal data in the block —
edit the numbers below and the chart updates with everything else on
re-render, same as any other AIMD-C view.

::: aimd-table {id="scores"}
- name: Alice
  score: 92
- name: Bob
  score: 78
- name: Carol
  score: 85
:::

::: aimd-view {source="@scores" renderer="chart"}
type: bar
title: Team Scores
:::

## What's honestly not here yet

Multi-series charts (a legend, per-series colors, shared axis scaling — a
real, deferred extension, not attempted this pass); Diagram IR
(flowchart/graph auto-layout — the most algorithmically complex of the
three Visual IR types the roadmap lists, scoped out of this pass entirely
per Neo's own call); Typst PDF projection for chart/plot blocks (mirrors
how AIMD-C v0.1 shipped compute-only before Phase 4 connected it to PDF
export — same shape, next round); `aimd-view {renderer="plot"}` (would mean
referencing a function's own definition, not a resolved value — doesn't fit
the current `source=` model without a bigger change).
