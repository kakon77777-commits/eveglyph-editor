---
type: note
status: draft
tags: [math, katex, diagnostics, demo]
---

# Math Corpus — diagnostics demo

The multi-backend rendering roadmap's Phase 1 is a diagnostics layer: KaTeX
failures used to vanish silently (the raw `$...$` text just sat there,
unrendered, with no explanation). Now a failure shows up as a diagnostics
panel at the top of this preview, and is logged to the Monitor tab
(`math:render:error` events) — nothing should disappear without a trace.

Every formula below was actually run through this app's exact KaTeX version
(0.16.47, `katex/contrib/auto-render`, no extension packages loaded) before
being written down here — nothing in this file is a guess about what KaTeX
supports. Scroll to the bottom for the section that's expected to fail.

## Basic

$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$

## Calculus

$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$

## Linear algebra

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

## Logic

$$\forall x \in \mathbb{R},\ x^2 \ge 0$$

## Set theory

$$A \cup B \subseteq C$$

## Category theory

$$F: \mathcal{C} \to \mathcal{D}$$

## Physics

$$\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}$$

## Statistics

$$\mathcal{N}(\mu, \sigma^2)$$

## Rare symbols

KaTeX's coverage is wider than it gets credit for — `\upharpoonright` renders
fine despite being an obscure restriction operator:

$$a \upharpoonright b$$

## Unsupported (expected to fail — this is the point of this section)

These four are confirmed real gaps in this app's KaTeX setup, not
hypothetical ones. Each should trigger the diagnostics panel above and a
`math:render:error` Monitor entry.

The `multline` environment (no such environment in KaTeX — `aligned` is the
usual substitute, same fix already applied on the Typst export side):

$$\begin{multline} a + b \\ = c \end{multline}$$

`mhchem`'s `\ce` (chemistry notation — needs an extension this app doesn't
load):

$$\ce{H2O}$$

An undefined control sequence (typo or a command that was never real):

$$\notarealcommand{x}$$

The `tikzcd` environment (commutative diagrams — a LaTeX package, not part of
KaTeX's math core):

$$\begin{tikzcd} A \arrow[r] & B \end{tikzcd}$$
