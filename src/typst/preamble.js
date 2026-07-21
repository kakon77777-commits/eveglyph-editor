// ─── Typst preamble generator (roadmap Phase 4: Typst Theme Compiler) ──────
// Replaces typstconvert.js's previously-hardcoded PREAMBLE string. Combines
// a theme (typography/scale/colors/spacing) with a layout profile
// (page/margin/paragraph/numbering) into real Typst `#set`/`#show` rules —
// this is the actual "compiler" half of "Theme Token + Layout Profile +
// Publication Rules → Typst Program" (whitepaper §5.1).
import { getTheme } from './theme.js'
import { getLayout } from './layout.js'

export function buildPreamble(themeId, layoutId) {
  const theme = getTheme(themeId)
  const layout = getLayout(layoutId)
  const { typography: fonts, scale, colors, spacing } = theme
  const { page, paragraph, numbering } = layout

  return `#set page(paper: "${page.size}", margin: (x: ${page.margin.x}, y: ${page.margin.y}))
#set text(font: ("${fonts.bodyLatin}", "${fonts.bodyZh}"), size: ${scale.body}, fill: rgb("${colors.text}"))
#set par(justify: ${paragraph.justify}, leading: ${spacing.leading}, first-line-indent: ${paragraph.firstLineIndent})
#set heading(numbering: none)
#show heading: it => {
  set text(font: ("${fonts.headingLatin}", "${fonts.headingZh}"), weight: "bold", fill: rgb("${colors.text}"))
  set text(size: (${scale.h1}, ${scale.h2}, ${scale.h3}, ${scale.body}).at(calc.min(it.level - 1, 3)))
  v(${spacing.sectionBefore}, weak: true)
  it.body
  v(${spacing.sectionAfter}, weak: true)
}
${numbering.equations ? '#set math.equation(numbering: "(1)")' : ''}
#show raw.where(block: true): it => block(fill: rgb("#f4f4f5"), inset: 8pt, radius: 3pt, width: 100%, text(font: "${fonts.mono}", it))
#show raw.where(block: false): it => box(fill: rgb("#f0f0f0"), inset: (x: 3pt, y: 0pt), outset: (y: 2pt), radius: 2pt, text(font: "${fonts.mono}", it))
#show link: it => text(fill: rgb("${colors.accent}"), it)

`
}
