// ─── Typst WASM export — Phase 1 (compiler plumbing) ───────────────────────
// The Typst compiler/renderer ship as ordinary npm dependencies; their WASM
// binaries live in node_modules and are bundled same-origin by Vite via
// `?url` imports below — never fetched from an external CDN at runtime.
// Fonts are the same story: typst.ts's default behavior fetches its "text"
// font set (DejaVuSansMono/LibertinusSerif/NewCM10/NewCMMath — the last one
// is load-bearing, Typst hard-errors "no font could be found" compiling ANY
// math without it) from a jsdelivr CDN on first compile. Neo asked for this
// feature to be fully self-hosted, so those 17 files (public domain / OFL,
// from github.com/typst/typst-assets@v0.13.1, ~8.4MB, downloaded with his
// explicit go-ahead 2026-07-14) live in public/fonts/typst/ and are served
// same-origin instead. CJK coverage: Typst's own "cjk" asset bundle only has
// a Simplified-Chinese-tuned Noto font — wrong glyph shapes for Neo's
// Traditional Chinese documents — so Noto Serif TC (variable font, all
// weights in one file, OFL, from github.com/google/fonts, ~16.85MB,
// downloaded with Neo's explicit go-ahead 2026-07-14) is loaded instead.
import { $typst, initOptions } from '@myriaddreamin/typst.ts'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

let configured = false
function configure() {
  if (configured) return
  configured = true
  $typst.setCompilerInitOptions({
    getModule: () => compilerWasmUrl,
    beforeBuild: [initOptions.loadFonts(
      ['/fonts/typst/NotoSerifTC-Variable.ttf'],
      { assets: ['text'], assetUrlPrefix: '/fonts/typst/' }
    )]
  })
  $typst.setRendererInitOptions({
    getModule: () => rendererWasmUrl
  })
}

// Compiles Typst source to PDF bytes. Returns a Uint8Array.
export async function compileTypstToPdf(source) {
  configure()
  return $typst.pdf({ mainContent: source })
}

// Compiles Typst source to an SVG string (for in-app preview, not export).
export async function compileTypstToSvg(source) {
  configure()
  return $typst.svg({ mainContent: source })
}

// Compiles and also surfaces Typst's own compile diagnostics (warnings +
// errors) alongside the PDF bytes — the plain compileTypstToPdf() above
// discards these. Used to check font-coverage warnings (e.g. missing CJK
// glyphs) without guessing from rendered output.
export async function compileTypstToPdfWithDiagnostics(source) {
  configure()
  const path = `/tmp/${Math.random().toString(36).slice(2)}.typ`
  await $typst.addSource(path, source)
  const compiler = await $typst.getCompilerReset()
  return compiler.compile({
    mainFilePath: path,
    format: 1, // CompileFormatEnum.pdf
    diagnostics: 'full'
  })
}
