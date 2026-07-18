---
type: note
status: draft
tags: [aimd-c, computable-document, phase-3]
---

# AIMD-C — computable document demo

This replaces the earlier `::: aimd … :::` / `Logic_Node` / `Coupling Node`
syntax entirely (roadmap v0.6, Decision 1) with **AIMD-C v0.1**: typed
values, pure functions, a dependency graph, assertions, and a computation
ledger — not just static blocks that look like they compute something.

Everything below only ever uses **L1 (pure functions)** — arithmetic,
comparisons, `IF`/`AND`/`OR`/`NOT`. No file/network/agent access, no
external effects; that's intentionally the entire scope of this phase (see
the roadmap's five-level execution model, L0–L4). The Tier 1 formula
evaluator this app already had (`vite-agent-bridge.js`) is the seed this
grew from — arithmetic core unchanged, extended with named variables, a
`name := expr` form, and a real dependency graph on top.

## A value, a function, a computation

A named input:

::: aimd-value {id="radius" type="Number"}
2
:::

A pure function — typed input, typed output, one expression:

::: aimd-function {id="circle-area" pure="true"}
input:
  r: Number

output:
  area: Number

expression:
  area := pi * r^2
:::

Binding the value to the function:

::: aimd-compute {id="result" use="circle-area"}
r := @radius
:::

The block above shows its own state and result inline, but the same value
can also be referenced directly in prose: the computed area is
**{{ result.area }}**. Edit `radius`'s value above and this number updates
on the next render — no page reload, no separate "run" step.

An assertion — checked, not assumed:

::: aimd-assert {id="area-positive"}
@result.area > 0
:::

The same result, projected as a typeset equation instead of a status chip
(this is real KaTeX — the `renderer="formula"` view emits actual `$$...$$`
math source, rendered by the same pipeline as every other formula in this
app):

::: aimd-view {source="@result.area" renderer="formula"}
area
:::

## A second function — year-over-year growth

::: aimd-function {id="yoy-growth" pure="true"}
input:
  current: Number
  previous: Number

output:
  growth: Number

expression:
  growth := (current - previous) / previous
:::

::: aimd-value {id="revenue-this-year" type="Number"}
120
:::

::: aimd-value {id="revenue-last-year" type="Number"}
100
:::

::: aimd-compute {id="growth" use="yoy-growth"}
current := @revenue-this-year
previous := @revenue-last-year
:::

Growth came out to {{ growth.growth }} (0.2 = 20%), formatted as a
percentage-style number view:

::: aimd-view {source="@growth.growth" renderer="number"}
format: "0.00"
:::

## A table

`aimd-table` holds self-contained inline data (no `source=` yet — that's a
later increment, once there's a real List/Table-valued expression story):

::: aimd-table {id="scores"}
- name: Alice
  score: 92
- name: Bob
  score: 78
:::

## What an honest failure looks like

This assertion is written to fail on purpose — AIMD-C doesn't hide a wrong
answer, it reports it:

::: aimd-assert {id="deliberately-false"}
@result.area > 1000
:::

And this compute block binds a value of the wrong type — a real
`TypeError`, checked before evaluation ever runs, not a silent wrong
answer:

::: aimd-value {id="not-a-number" type="Boolean"}
true
:::

::: aimd-compute {id="type-mismatch" use="circle-area"}
r := @not-a-number
:::

::: note {title="What's not here yet"}
This is v0.1 — L1 only. Not yet built: `map`/`filter`/`reduce` or any
List/Table-valued *expression* (values can hold a List/Table, like the
table above, but a function body can't operate on one yet); L2's
document-attached sandboxed compute (WASM/Pyodide); L3/L4's workspace and
agent layers (those already exist for the rest of this app — Diff Review,
permission tiers — AIMD-C's later versions are meant to plug into that
infrastructure, not rebuild it). Real formal verification (Lean4/Coq) is
still the honest "not wired yet" stub in `vite-agent-bridge.js`'s
`/api/compute` — its future home is AIMD-C v0.4, per the roadmap.
:::
