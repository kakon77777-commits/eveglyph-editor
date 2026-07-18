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
Phase 2 adds Safe Rewrite: some of what looks like a KaTeX gap is really
just a syntactic alias KaTeX doesn't recognize by name — those get quietly
fixed before rendering instead of being diagnosed. See the "Auto-normalized"
section below. Phase 2b adds an automatic MathJax retry for whatever's left —
KaTeX's real gaps aren't MathJax's gaps too, so some (not all) of what
follows now renders anyway, a moment after the diagnostics panel first
appears. See "Rescued by MathJax" and the (now shorter) "Still unsupported"
sections below.

Every formula below was actually run through this app's exact KaTeX and
MathJax setup (katex 0.16.47 via `katex/contrib/auto-render`; MathJax 4.1.3
via `@mathjax/src`'s component API, packages `base/ams/newcommand/
configmacros/mhchem`) before being written down here — nothing in this file
is a guess about what either engine supports.

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

## Auto-normalized (Phase 2 Safe Rewrite)

`split` is semantically identical to `aligned`, but KaTeX has never
implemented the `split` name itself — this used to land in the "Unsupported"
section below. Now `src/math/rewrite.js` rewrites it before KaTeX ever sees
it, so this renders cleanly and only a quiet note appears above (not an
error):

$$\begin{split} a &= b + c \\ &= d + e \end{split}$$

## Rescued by MathJax (Phase 2b fallback)

KaTeX has never supported either of these, but MathJax does (with the
`ams`/`mhchem` packages, which this app loads for exactly this reason). The
diagnostics panel above briefly shows an error for each on first render,
then quietly resolves once the fallback attempt lands — watch the Monitor
tab for `math:render:fallback-success` events, or just notice these two
formulas render normally a moment after the page settles:

The `multline` environment (no such environment in KaTeX — `aligned` is the
usual substitute, same fix already applied on the Typst export side, but
MathJax just handles `multline` directly):

$$\begin{multline} a + b \\ = c \end{multline}$$

`mhchem`'s `\ce` (chemistry notation — KaTeX needs an extension this app
doesn't load; MathJax's `mhchem` package handles it natively):

$$\ce{H2O}$$

## Still unsupported (expected to fail everywhere — this is the point of this section)

These two are confirmed real gaps in *both* engines, not hypothetical ones.
Each should keep showing in the diagnostics panel above even after the
MathJax fallback has had time to run, plus a Monitor entry recording that
the fallback was tried and also failed
(`math:render:fallback-failed`).

An undefined control sequence (typo or a command that was never real — no
engine can render a command that was never defined anywhere):

$$\notarealcommand{x}$$

The `tikzcd` environment (commutative diagrams — a real LaTeX package built
on TikZ, which neither KaTeX nor MathJax implement):

$$\begin{tikzcd} A \arrow[r] & B \end{tikzcd}$$
