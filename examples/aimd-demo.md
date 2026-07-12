---
type: note
status: draft
tags: [aimd, cogni-flow, computable-math, phase-2]
---

# AIMD / Cogni-Flow Protocol — Phase 1 + 2 demo

This is the new block type from **whitepaper v0.5 §4**: `::: aimd … :::`. Two compute
tiers, by design (see the note at the bottom):

- **Tier 1 — `formula`**: a spreadsheet-style expression grammar, Excel-familiar
  function names, safe by construction (no `eval`, no shell-out). Available to
  every permission tier.
- **Tier 2 — `lean4` / `coq` / `python`**: real formal verification. Gated behind
  the **Trusted** permission tier server-side, and — even at Trusted — still
  honestly reports "not wired yet": the actual sandboxing policy for shelling out
  to an external interpreter is Neo's call, not something to slip in silently.

::: aimd
@BaseSpace: 符號即時運算驗證系統_v0.1
@State: Dynamic_Flow

> [D_G=1, λ=0.95] 任務：解耦邏輯驗證與 DOM 渲染，實作動態視口。

[Logic_Node: 0xD442 | expr="2*(3+4) = 14"] 狀態: ? | 相干度: ? | 驗證器: formula

[Logic_Node: 0xD443 | expr="SUM(1,2,3,4) = 10"] 狀態: ? | 相干度: ? | 驗證器: formula

[Logic_Node: 0xD444 | expr="IF(AVERAGE(4,8,12) > 5, 1, 0) = 1"] 狀態: ? | 相干度: ? | 驗證器: formula

[Logic_Node: 0xD445 | expr="AND(3 > 2, 10 = SUM(3,3,4))"] 狀態: ? | 相干度: ? | 驗證器: formula

[Logic_Node: 0xE001 | expr="∇·E = ρ/ε₀"] 狀態: ? | 相干度: ? | 驗證器: lean4

<Coupling Node: ⋈>
Target: LBRAT.Phenomenal_Weight <---> UI.Rendering_Resolution
Action: 將 ρ 與 q 分離，實作前端模糊實在狀態。
</Coupling>
:::

The trunk line (`D_G=1`) always renders — that's the "lightweight state projection"
the whitepaper describes. The `Coupling Node` block starts **collapsed**; click it to
expand in place (plain `<details>`, purely client-side, no fetch).

Every `Logic_Node` above carries `expr="..."` and a **▶ button** — click one to
actually POST to `/api/compute`.

- The four `驗證器: formula` nodes hit the Tier 1 safe evaluator: `SUM`, `AVERAGE`,
  `IF`, `AND`/`OR`/`NOT`, comparisons (`=`/`<>`/`>`/`<`/`>=`/`<=`), plus the earlier
  arithmetic/trig set. Try editing one to something false (e.g. `1 + 1 = 3`) to see a
  **Failed** state, or something the grammar can't parse to see an honest
  **Unsupported** — it never pretends to verify math it can't check.
- The last node (`驗證器: lean4`) is Tier 2. At the default **Standard** permission it
  should come back "requires Trusted permission tier." Switch **Settings ⚙ → Agent
  permission → Trusted** and click again — it'll still say "not wired yet," but now
  for the honest reason (sandboxing policy still pending), not a permission block.

::: note {title="Where this fits"}
`::: aimd … :::` reuses the same `::: type … :::` mechanism as the `note` / `warning`
callouts above — it's not a new top-level syntax, so it can't collide with ordinary
prose elsewhere in a document. See `src/preview.js` (`renderAimdBlock`,
`runAimdCompute`) and `vite-agent-bridge.js` (`/api/compute`, `aimdCompute`).
:::
