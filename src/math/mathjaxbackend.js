// ─── MathJax fallback backend (multi-backend rendering roadmap, Phase 2b) ──
// Lazy-loaded (dynamic import, same pattern as the Typst WASM work in
// typstexport.js) — never bundled into the app's initial load. Uses
// MathJax's own lower-level component API directly (TeX/SVG/liteAdaptor
// classes, `@mathjax/src/js/...`) rather than the pre-built `tex-svg.js`
// bundle, which is a 1.85MB IIFE built for a <script> tag + a
// `window.MathJax` global and doesn't fit this app's ESM/dynamic-import
// architecture (confirmed by installing and inspecting it directly,
// 2026-07-18 — see PROGRESS.md's Phase 2 entry). liteAdaptor is MathJax's
// own DOM-independent virtual node implementation (not jsdom) — produces a
// node serialized via `adaptor.outerHTML()` into a plain HTML string, same
// "produce a string, let DOMPurify sanitize it" pattern used everywhere
// else in this app for untrusted/generated content.
//
// Packages loaded: base + ams (adds `multline`, among others) + newcommand +
// configmacros + mhchem (adds `\ce{...}`) — chosen because these are exactly
// the packages needed to cover the real gaps Phase 1 found in katex
// (examples/math-corpus.md's "Unsupported" section). Deliberately NOT
// loading `noundefined`: that package makes MathJax silently render an
// undefined command as plain text instead of erroring — the same silent-
// degradation class of problem Phase 1 exists to catch. Skipping it keeps a
// genuinely undefined macro an honest failure here too, verified empirically
// (with `noundefined` loaded, `\notarealcommand{x}` renders with no error
// marker at all; without it, it correctly errors).
let mathDocument = null
let adaptor = null
let loadPromise = null

async function ensureLoaded() {
  if (mathDocument) return
  if (!loadPromise) loadPromise = (async () => {
    const [
      { mathjax },
      { TeX },
      { SVG },
      { liteAdaptor },
      { RegisterHTMLHandler },
    ] = await Promise.all([
      import('@mathjax/src/js/mathjax.js'),
      import('@mathjax/src/js/input/tex.js'),
      import('@mathjax/src/js/output/svg.js'),
      import('@mathjax/src/js/adaptors/liteAdaptor.js'),
      import('@mathjax/src/js/handlers/html.js'),
    ])
    await Promise.all([
      import('@mathjax/src/js/input/tex/ams/AmsConfiguration.js'),
      import('@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'),
      import('@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js'),
      import('@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'),
    ])
    adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'configmacros', 'mhchem'] })
    const svg = new SVG({ fontCache: 'local' })
    mathDocument = mathjax.document('', { InputJax: tex, OutputJax: svg })
  })()
  await loadPromise
}

// Never throws — returns { ok: true, html } or { ok: false, error } so
// callers don't need their own try/catch around every call.
export async function renderWithMathJax(texSource, displayMode) {
  try {
    await ensureLoaded()
    const node = mathDocument.convert(texSource, { display: !!displayMode })
    const html = adaptor.outerHTML(node)
    if (html.includes('data-mjx-error')) {
      return { ok: false, error: 'MathJax could not render this formula either.' }
    }
    return { ok: true, html }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}
