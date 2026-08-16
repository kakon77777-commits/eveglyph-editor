---
type: note
status: draft
tags: [dynamic-logic, live-paper, aimd-c]
---

# Dynamic Logic MVP — live judgment + formula replay

This demo is intentionally small. It proves one thing visually:

$$
\boxed{\Omega \rightarrow \top_p \rightarrow \Omega \rightarrow \bot_p}
$$

The four evidence blocks are document-declared events for this first MVP.
The History controls do **not** rewrite this Markdown; they only move an
in-memory replay cursor and re-render the same evidence prefix.

## Claim

::: aimd-claim {id="weather-claim"}
statement: "Tomorrow afternoon will be rainy."
:::

## Evidence stream

First supporting source:

::: aimd-evidence {id="forecast-a" claim="@weather-claim" direction="support" weight="0.9" verified="true" sequence="1"}
label: Forecast A supports rain
source: demo://forecast-a
:::

Second supporting source — with two verified evidence items, the demo policy
now allows provisional support:

::: aimd-evidence {id="forecast-b" claim="@weather-claim" direction="support" weight="0.8" verified="true" sequence="2"}
label: Forecast B independently supports rain
source: demo://forecast-b
:::

A major counter-signal arrives and reopens the previously closed judgment:

::: aimd-evidence {id="front-shift" claim="@weather-claim" direction="oppose" weight="5" verified="true" sequence="3"}
label: Frontal system shifts away
source: demo://front-shift
:::

A second strong opposing signal closes provisionally in the other direction:

::: aimd-evidence {id="radar-update" claim="@weather-claim" direction="oppose" weight="5" verified="true" sequence="4"}
label: Radar update further reduces rain support
source: demo://radar-update
:::

## Judgment runtime

::: aimd-judgment {id="weather-judge" claim="@weather-claim"}
support_threshold: 0.8
oppose_threshold: 0.2
min_evidence_count: 2
reopen_delta: 0.2
:::

Current runtime state: **{{ weather-judge.state }}**  
Triadic projection: **{{ weather-judge.projection }}**  
Current support score: **{{ weather-judge.support }}**

The formula below is the existing AIMD-C formula renderer reading a Dynamic
Logic external ref — there is no second math evaluator hidden behind it:

::: aimd-view {source="@weather-judge.support" renderer="formula"}
S_t
:::

## Replay

Use ← / → below. The formula and the judgment block re-render against the
selected evidence prefix.

::: aimd-history {claim="@weather-claim"}
:::

Expected evidence-prefix states:

1. step 0: $\Omega$ (open)
2. step 1: $\Omega$ (generating)
3. step 2: $\top_p$ (provisional support)
4. step 3: $\Omega$ (reopened)
5. step 4: $\bot_p$ (provisional oppose)

::: note {title="MVP boundary"}
The replay cursor is intentionally UI-local in v0.1. A later increment will
persist an append-only event sidecar; this demo first verifies the semantic
boundary and the AIMD-C integration without prematurely adding disk mutation.
:::
