---
type: note
status: draft
tags: [dynamic-logic, live-paper, aimd-c]
---

# Dynamic Logic MVP — browser-live judgment + formula replay

This demo is intentionally small. It proves one thing visually:

$$
\boxed{\Omega \rightarrow \top_p \rightarrow \Omega \rightarrow \bot_p}
$$

The four evidence blocks are document-declared events for this first MVP.
The History controls do **not** rewrite this Markdown; they only move an
in-memory replay cursor and re-render the same evidence prefix.

The browser renderer is event-driven rather than decorative: **Play** advances
one real evidence step at a time. Evidence cards enter the active domain,
judgment metrics show real deltas, state changes pulse once, and the AIMD-C
formula below is recomputed from the same Dynamic Logic external ref. When no
state/value changes, the page stays still.

## Claim

::: aimd-claim {id="weather-claim"}
statement: "Tomorrow afternoon will be rainy."
:::

## Evidence stream

First supporting source:

::: aimd-evidence {id="forecast-a" claim="@weather-claim" direction="support" weight="0.9" verified="true" sequence="1"}
source_type: document
label: Forecast A supports rain
source: demo://forecast-a
:::

Second supporting source — with two verified evidence items, the demo policy
now allows provisional support:

::: aimd-evidence {id="forecast-b" claim="@weather-claim" direction="support" weight="0.8" verified="true" sequence="2"}
source_type: document
label: Forecast B independently supports rain
source: demo://forecast-b
:::

A major counter-signal arrives and reopens the previously closed judgment:

::: aimd-evidence {id="front-shift" claim="@weather-claim" direction="oppose" weight="5" verified="true" sequence="3"}
source_type: document
label: Frontal system shifts away
source: demo://front-shift
:::

A second strong opposing signal closes provisionally in the other direction:

::: aimd-evidence {id="radar-update" claim="@weather-claim" direction="oppose" weight="5" verified="true" sequence="4"}
source_type: document
label: Radar update further reduces rain support
source: demo://radar-update
:::

## Judgment runtime — visualization + replay controls

Use **▶ Play** for automatic event-driven playback, or ← / → for manual steps.
The formula, evidence cards, metrics, and judgment block all re-render from the
same selected evidence prefix. **⏸ Pause** freezes exactly where it is; **Live**
returns to the latest state. Everything that reacts to replay lives together in
this one section — nothing to scroll away from while you're driving it.

::: aimd-history {claim="@weather-claim"}
:::

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

Expected evidence-prefix states: step 0 $\Omega$ (open) · step 1 $\Omega$
(generating) · step 2 $\top_p$ (provisional support) · step 3 $\Omega$
(reopened) · step 4 $\bot_p$ (provisional oppose).

::: note {title="Motion boundary"}
This is semantic motion, not a fake thinking animation. CSS motion is emitted
only when a browser frame observes a real replay/state/value change. The
renderer also honors `prefers-reduced-motion`. The replay cursor is still
intentionally UI-local — a later increment persists an append-only event
sidecar; this phase verifies the continuous visual semantics first without
prematurely adding disk mutation.
:::
