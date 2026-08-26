import { upsertFrontmatter } from '../frontmatter.js'
import { markdownToTypst } from '../typstconvert.js'
import { resolvePublicationSelection } from './profiles.js'
import { validateDocument } from './validate.js'

function publicationError(code, message, details = undefined) {
  const err = new Error(message)
  err.code = code
  if (details !== undefined) err.details = details
  return err
}

export function preparePublication(source, { profile, theme, layout } = {}) {
  const selection = resolvePublicationSelection({ profile, theme, layout })
  const validation = validateDocument(source, { profile: selection.profile })
  if (!validation.ok) {
    throw publicationError('invalid_source', 'document failed publication preflight validation', validation.errors)
  }

  // Presentation selection is applied to an ephemeral derived string only.
  // The caller's canonical UTF-8 source is never changed or written back.
  const renderSource = upsertFrontmatter(source, {
    typst_theme: selection.theme,
    typst_layout: selection.layout,
  })

  let typstSource
  try {
    typstSource = markdownToTypst(renderSource)
  } catch (e) {
    throw publicationError('conversion_error', e?.message || String(e))
  }

  return {
    typstSource,
    profile: selection.profile,
    theme: selection.theme,
    layout: selection.layout,
    validation,
  }
}
