import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler'

const RENDERER_VERSION = '0.7.0'
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../..')
const FONT_DIR = path.join(REPO_ROOT, 'public', 'fonts', 'typst')

// A compiler is cached per absolute workspace root. This keeps relative image
// and asset resolution anchored to the workspace selected when the MCP server
// starts, instead of incorrectly resolving user assets from the EveGlyph repo.
const compilers = new Map()

function getCompiler(workspaceRoot = REPO_ROOT) {
  const root = path.resolve(workspaceRoot)
  if (compilers.has(root)) return compilers.get(root)
  const compiler = NodeCompiler.create({
    workspace: root,
    fontArgs: [{ fontPaths: [FONT_DIR] }],
  })
  compilers.set(root, compiler)
  return compiler
}

function normalizeCompileError(error) {
  const err = new Error(Array.isArray(error)
    ? error.map(item => item?.message || String(item)).join('; ')
    : (error?.message || String(error)))
  err.code = 'compile_error'
  return err
}

export async function renderTypstToPdf(typstSource, { workspaceRoot = REPO_ROOT } = {}) {
  if (typeof typstSource !== 'string' || !typstSource.trim()) {
    const err = new Error('Typst source must be a non-empty string')
    err.code = 'invalid_source'
    throw err
  }

  const instance = getCompiler(workspaceRoot)
  try {
    const bytes = instance.pdf({ mainFileContent: typstSource })
    return {
      bytes: Buffer.from(bytes),
      diagnostics: [],
      renderer: { backend: 'typst-node', version: RENDERER_VERSION },
    }
  } catch (error) {
    throw normalizeCompileError(error)
  } finally {
    // typst.ts documents the global compilation cache as process-wide and
    // recommends max_age=10 for ordinary non-watch tools.
    instance.evictCache(10)
  }
}

export const NODE_RENDERER_INFO = Object.freeze({
  backend: 'typst-node',
  version: RENDERER_VERSION,
  defaultWorkspace: REPO_ROOT,
  fontDirectory: FONT_DIR,
})
