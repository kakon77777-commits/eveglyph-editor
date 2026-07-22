// ─── EveGlyph Editor — MCP tool set (shared between transports) ────────────
// createMcpServer(workspaceRoot) builds a fully-configured McpServer with all
// 5 tools registered. Extracted out of mcp-server.js (stdio) so the new
// remote/HTTP entry point (mcp-server-remote.js) can reuse the exact same
// tool implementations rather than a second, maybe-drifting copy — the two
// entry points differ only in how a client reaches this server (stdin/stdout
// vs. an HTTP request over a Cloudflare Tunnel), not in what it can do.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'
import jsYaml from 'js-yaml'

import { isAimdcType, parseAimdcBlock } from './src/aimdc/parser.js'
import { evaluateDocument } from './src/aimdc/graph.js'
import { validateStateMachine, validateEntity, validateEntityList } from './src/validate.js'

function isTextFile(name) {
  return /\.(md|txt|html|json|ya?ml)$/i.test(name)
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

// Mirrors vite-agent-bridge.js's detectFileEncoding/decodeFileBuffer — reads
// a file's real encoding (jschardet) instead of assuming UTF-8, since
// existing workspace files may be legacy-encoded (Big5/GBK).
function detectFileEncoding(buf, fallback = 'UTF-8') {
  try {
    const r = jschardet.detect(buf)
    const enc = (r && r.encoding) || ''
    if (enc.toLowerCase() === 'ascii') return 'UTF-8'
    if (!enc) return fallback
    return iconv.encodingExists(enc) ? enc : fallback
  } catch { return fallback }
}

function decodeFileBuffer(buf) {
  let enc = detectFileEncoding(buf)
  let content
  try { content = iconv.decode(buf, enc) }
  catch { enc = 'UTF-8'; content = buf.toString('utf8') }
  return { content, encoding: enc }
}

// Same block-splitting regex previewUpdate()/typstconvert.js use ([\w-]+,
// not \w+, so hyphenated types like aimd-value parse correctly) — duplicated
// rather than importing preview.js/typstconvert.js, which pull in
// CodeMirror/DOMPurify/marked and other browser-only modules a Node process
// can't load.
const AIMDC_BLOCK_RE = /^:::\s+([\w-]+)([^\n]*)\n([\s\S]*?)^:::/gm

function extractAimdcBlocks(src) {
  const blocks = []
  let m
  AIMDC_BLOCK_RE.lastIndex = 0
  while ((m = AIMDC_BLOCK_RE.exec(src))) {
    const [, type, rest, body] = m
    if (isAimdcType(type)) blocks.push(parseAimdcBlock(type, rest, body))
  }
  return blocks
}

const mapToObject = (map) => Object.fromEntries([...map.entries()])

const errorResult = (e) => ({ content: [{ type: 'text', text: `Error: ${e?.message || e}` }], isError: true })
const jsonResult = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] })

// Validates + resolves workspaceRoot (must already be an absolute, existing
// directory — callers do that check once at startup, not per tool call) and
// returns a configured McpServer. A fresh instance per call: the stdio entry
// makes one for its one long-lived connection; the remote/stateless HTTP
// entry makes one per incoming request (mirroring the SDK's own stateless
// example), so nothing here may hold connection-specific state.
export function createMcpServer(workspaceRoot) {
  const WORKSPACE_ROOT = workspaceRoot

  // Mirrors vite-agent-bridge.js's resolveInside() — every file op must
  // resolve inside WORKSPACE_ROOT, no ../ escape.
  function resolveInside(rel = '') {
    const target = path.resolve(WORKSPACE_ROOT, rel)
    if (target !== WORKSPACE_ROOT && !target.startsWith(WORKSPACE_ROOT + path.sep)) {
      throw new Error('path escapes workspace')
    }
    return target
  }

  async function listFiles(dir = '', out = []) {
    const abs = path.join(WORKSPACE_ROOT, dir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const rel = dir ? path.join(dir, entry.name) : entry.name
      const normalized = rel.split(path.sep).join('/')
      if (entry.isDirectory()) await listFiles(rel, out)
      else if (entry.isFile() && isTextFile(entry.name)) out.push(normalized)
    }
    return out
  }

  const server = new McpServer({ name: 'eveglyph-editor', version: '0.5.0' })

  server.registerTool('list_files', {
    title: 'List workspace files',
    description: `List every text file (.md/.txt/.html/.json/.yaml/.yml) in the opened EveGlyph workspace (${WORKSPACE_ROOT}), as paths relative to the workspace root. node_modules/dist/build/.git and dotfiles are excluded.`,
  }, async () => {
    try { return jsonResult({ workspace: WORKSPACE_ROOT, files: await listFiles() }) }
    catch (e) { return errorResult(e) }
  })

  server.registerTool('read_file', {
    title: 'Read a workspace file',
    description: 'Read one file from the opened EveGlyph workspace by its path relative to the workspace root. Auto-detects encoding (handles legacy Big5/GBK files, not just UTF-8).',
    inputSchema: { path: z.string().describe('File path relative to the workspace root, e.g. "notes/plan.md"') },
  }, async ({ path: relPath }) => {
    try {
      const buf = await fs.readFile(resolveInside(relPath))
      const { content, encoding } = decodeFileBuffer(buf)
      return jsonResult({ path: relPath, content, encoding })
    } catch (e) { return errorResult(e) }
  })

  server.registerTool('write_file', {
    title: 'Write a workspace file',
    description: 'Create or overwrite one file in the opened EveGlyph workspace, UTF-8 encoded. Creates parent directories as needed. Does not run a git snapshot/diff on its own — if the workspace is a git repo, review the change with your own git tooling after writing.',
    inputSchema: {
      path: z.string().describe('File path relative to the workspace root'),
      content: z.string().describe('Full new file content'),
    },
  }, async ({ path: relPath, content }) => {
    try {
      const abs = resolveInside(relPath)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
      return jsonResult({ ok: true, path: relPath, bytes: Buffer.byteLength(content, 'utf8') })
    } catch (e) { return errorResult(e) }
  })

  server.registerTool('evaluate_aimdc', {
    title: 'Evaluate AIMD-C computable blocks',
    description: 'Parse and evaluate every AIMD-C block (aimd-value/function/compute/assert/table/view) in a piece of EveGlyph-MD content, returning computed results, the dependency-evaluation ledger, and any type/reference errors — the same engine the live preview and PDF export use. Pass document content directly (use read_file first if it lives on disk).',
    inputSchema: { content: z.string().describe('EveGlyph-MD document content, or just the relevant ::: aimd-* ::: blocks') },
  }, async ({ content }) => {
    try {
      const blocks = extractAimdcBlocks(content)
      if (!blocks.length) return jsonResult({ blocks: 0, results: {}, issues: [], ledger: [] })
      const doc = evaluateDocument(blocks)
      return jsonResult({ blocks: blocks.length, results: mapToObject(doc.results), issues: doc.issues, ledger: doc.ledger })
    } catch (e) { return errorResult(e) }
  })

  server.registerTool('validate_world_ir', {
    title: 'Validate a World IR YAML document',
    description: 'Validate a CompilableWorld World IR YAML document (kind: state_machine / entity / entity_list) and return structured issues ({severity, code, message}) — the same validator the in-app World IR views use.',
    inputSchema: { content: z.string().describe('Raw YAML content of a World IR document') },
  }, async ({ content }) => {
    try {
      const kind = /^\s*kind:\s*state_machine\b/m.test(content) ? 'state_machine'
        : /^\s*kind:\s*entity_list\b/m.test(content) ? 'entity_list'
        : /^\s*kind:\s*entity\b/m.test(content) ? 'entity'
        : null
      if (!kind) {
        return jsonResult({ kind: null, issues: [{ severity: 'error', code: 'not_world_ir', message: 'content does not start with kind: state_machine / entity / entity_list' }] })
      }
      let doc
      try { doc = jsYaml.load(content) }
      catch (e) { return jsonResult({ kind, issues: [{ severity: 'error', code: 'parse_error', message: String(e?.message || e) }] }) }
      const issues = kind === 'state_machine' ? validateStateMachine(doc)
        : kind === 'entity_list' ? validateEntityList(doc)
        : validateEntity(doc)
      return jsonResult({ kind, issues })
    } catch (e) { return errorResult(e) }
  })

  return server
}

// Shared by both entry points: resolve + validate a workspace-root CLI arg,
// exiting the process with a clear message if it's missing or not a real
// directory. No implicit cwd fallback — same deliberate "confirm before
// touching files" posture as the bridge's /api/workspace open step.
export async function resolveWorkspaceRootOrExit(argv, usage) {
  const arg = argv[2]
  if (!arg) {
    console.error(usage)
    process.exit(1)
  }
  const root = path.resolve(arg)
  const stat = await fs.stat(root).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    console.error(`workspace root is not a directory: ${root}`)
    process.exit(1)
  }
  return root
}
