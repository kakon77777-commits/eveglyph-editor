import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TextDecoder } from 'node:util'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'

// Bump when the agent-resolution logic changes — surfaced in /api/agents._debug
// so we can tell at a glance whether a running server has the latest bridge.
const BRIDGE_BUILD = 'claude-resolver-v2'

// Per-agent invocation. The prompt is fed on stdin; `exe` is the base binary and
// `flags(tier)` returns the fixed flags for a permission tier. The tier maps to REAL
// CLI enforcement (not just prompt text) wherever the CLI supports it:
//   cautious — edit existing files only (no create, no shell/delete)
//   standard — edit + create (no shell/delete)              ← default
//   trusted  — full capability (skips all gating)
// A UI command override replaces all of this verbatim. Fidelity is highest for Claude
// (per-tool allow-list); Codex/Gemini are coarser below the trusted tier (the prompt
// clause carries the create/delete nuance there).
const AGENTS = {
  claude: {
    label: 'Claude Code',
    exe: 'claude',
    flags: (tier) =>
      tier === 'cautious' ? '-p --permission-mode default --allowedTools Edit Read Grep Glob'
      : tier === 'trusted' ? '-p --permission-mode bypassPermissions'
      :                      '-p --permission-mode acceptEdits'
  },
  codex: {
    label: 'Codex CLI',
    exe: 'codex',
    flags: (tier) =>
      tier === 'trusted' ? 'exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox'
      :                    'exec --full-auto --skip-git-repo-check'
  },
  gemini: {
    label: 'Gemini CLI',
    exe: 'gemini',
    flags: (tier) =>
      tier === 'trusted' ? '--yolo'
      :                    '--approval-mode auto_edit'
  }
}

// The permission tier used for detection/display (the probe only runs `<exe> --version`).
const DISPLAY_TIER = 'standard'

const AGENT_EXE_ENV = {
  claude: 'EVEGLYPH_CLAUDE_EXE',
  codex: 'EVEGLYPH_CODEX_EXE',
  gemini: 'EVEGLYPH_GEMINI_EXE'
}

const MONITOR_FILE = process.env.EVEGLYPH_MONITOR_FILE
  || path.resolve(process.cwd(), '..', 'PHOSPHOR', 'eveglyph-monitor.jsonl')
const MONITOR_MAX_BYTES = 5 * 1024 * 1024   // roll over at 5 MB; bounds disk to ~2× this
const big5Decoder = new TextDecoder('big5')

// ── BRIDGE_CONFIG — the server-side config contract ──
// Mirror of src/config.js for the Node process (the browser can't reach these).
// Centralized so the bridge's tunables are declared up front, not scattered as
// magic numbers. (MONITOR_FILE / MONITOR_MAX_BYTES / AGENTS stay above — already named.)
const BRIDGE_CONFIG = {
  agentTimeoutMs:     180000,   // hard-kill an agent run after this
  agentsCacheTtlMs:   30000,    // cache the CLI --version probes
  probeTimeoutMs:     3000,     // per-agent --version probe timeout
  gitMessageMaxChars: 120,      // truncate snapshot/accept commit messages
  gitIdentity: { name: 'EveGlyph Editor', email: 'eveglyph-editor@local' }, // applied to fresh repos only
  monitorTailBytes:   512 * 1024, // GET /api/monitor reads only the file's tail
  monitorViewMax:     1000,       // cap events returned to the in-app viewer
}

let monitorSeq = 0
let monitorRotating = false
const activeAgents = new Map()

// The single workspace the user has opened — pinned by /api/workspace. Every cwd-taking
// endpoint (file I/O, git snapshot/diff/accept/reject, agent spawn) validates against it,
// so a crafted /api request can't aim a destructive `git reset --hard`/`clean -fd` or an
// auto-approve agent at an arbitrary directory. Belt-and-suspenders on top of the
// localhost gate; makes the SECURITY.md workspace-confinement guarantee actually hold.
let confirmedWorkspace = null

function assertWorkspace(cwd) {
  if (!confirmedWorkspace) throw new Error('no workspace opened — open a folder first')
  const abs = path.resolve(cwd || '')
  const rel = path.relative(confirmedWorkspace, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {   // '' (the root itself) or a descendant is allowed
    throw new Error('cwd is outside the opened workspace')
  }
  return abs
}

// ── AIMD Phase 2 — two-tier compute (whitepaper v0.5 §4.6) ──
// Tier 1, "formula": a spreadsheet-style expression grammar (Excel-familiar function
// names) evaluated by a small hand-rolled tokenizer + recursive-descent parser/
// evaluator. A document (including one an auto-approve agent wrote) can carry an
// `expr="..."` on any Logic_Node, so this text is UNTRUSTED input — never eval()/
// Function()/shell out on it; the closed grammar below means the worst a malformed
// expression can do is throw a parse error. Available to every permission tier.
//
// Tier 2, "formal" (lean4/coq/python): real formal verification / symbolic CAS —
// intentionally NOT wired here. Requires the Trusted permission tier just to attempt
// (checked in the /api/compute handler below), and even at Trusted it currently
// reports "not wired yet" — the actual subprocess sandboxing policy (isolation,
// timeouts, resource limits) is a product decision, not something to slip in
// silently just because the permission check passed.
const AIMD_CONSTANTS = { pi: Math.PI, e: Math.E }

// Zero/one/two-arg functions — evaluated eagerly, args pre-reduced to numbers.
const AIMD_FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp,
  power: (x, y) => Math.pow(x, y),
  mod: (x, y) => x % y,
  round: (x, digits = 0) => { const f = Math.pow(10, digits); return Math.round(x * f) / f },
  pi: () => Math.PI,   // Excel-style PI() alongside the bare `pi` constant
}

function aimdTokenize(src) {
  const toks = []
  // Longest-match-first so `<=`/`>=`/`<>` aren't sliced into `<`/`=`.
  const re = /\s*(<>|>=|<=|=|<|>|[+\-*/^(),]|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\.\d+)/y
  let i = 0
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m || m[0].length === 0) throw new Error(`unrecognized character at position ${i}: "${src[i]}"`)
    toks.push(m[1])
    i += m[0].length
  }
  return toks
}

const COMPARE_OPS = new Set(['=', '<>', '>', '<', '>=', '<='])

function aimdParse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseCompare() {
    const lhs = parseAdd()
    if (COMPARE_OPS.has(peek())) { const op = next(); return { op, lhs, rhs: parseAdd() } }
    return lhs
  }
  function parseAdd() {
    let node = parseMul()
    while (peek() === '+' || peek() === '-') { const op = next(); node = { op, lhs: node, rhs: parseMul() } }
    return node
  }
  function parseMul() {
    let node = parsePow()
    while (peek() === '*' || peek() === '/') { const op = next(); node = { op, lhs: node, rhs: parsePow() } }
    return node
  }
  function parsePow() {
    const node = parseUnary()
    if (peek() === '^') { next(); return { op: '^', lhs: node, rhs: parsePow() } }   // right-assoc
    return node
  }
  function parseUnary() {
    if (peek() === '-') { next(); return { op: 'neg', arg: parseUnary() } }
    return parsePrimary()
  }
  function parsePrimary() {
    const t = next()
    if (t === undefined) throw new Error('unexpected end of expression')
    if (t === '(') {
      const node = parseCompare()   // a parenthesized group may itself be a comparison, e.g. IF((3>2), 1, 0)
      if (next() !== ')') throw new Error('expected ")"')
      return node
    }
    if (/^\d/.test(t) || t.startsWith('.')) return { op: 'num', value: Number(t) }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        next()
        const args = []
        if (peek() !== ')') {
          args.push(parseCompare())   // args may be comparisons too, e.g. SUM(3>2, 4)
          while (peek() === ',') { next(); args.push(parseCompare()) }
        }
        if (next() !== ')') throw new Error('expected ")"')
        return { op: 'call', name: t.toLowerCase(), args }
      }
      return { op: 'ident', name: t.toLowerCase() }
    }
    throw new Error(`unexpected token "${t}"`)
  }

  const tree = parseCompare()
  if (pos !== tokens.length) throw new Error(`unexpected trailing token "${tokens[pos]}"`)
  return tree
}

const toNum  = (v) => typeof v === 'boolean' ? (v ? 1 : 0) : v
const toBool = (v) => typeof v === 'boolean' ? v : (Number.isFinite(v) && v !== 0)

// Returns a number or a boolean (comparisons/AND/OR/NOT/IF-condition are boolean;
// everything else is numeric) — never a string; text Excel functions (CONCATENATE,
// TEXT, LEFT/RIGHT, …) are a deliberate scope cut, not built in this pass.
function aimdEval(node) {
  switch (node.op) {
    case 'num': return node.value
    case 'ident': {
      if (node.name in AIMD_CONSTANTS) return AIMD_CONSTANTS[node.name]
      throw new Error(`unknown identifier "${node.name}" — only pi/e are supported (this expression may need Tier 2 formal verification, not the Tier 1 formula evaluator)`)
    }
    case 'neg': return -toNum(aimdEval(node.arg))
    case '+': return toNum(aimdEval(node.lhs)) + toNum(aimdEval(node.rhs))
    case '-': return toNum(aimdEval(node.lhs)) - toNum(aimdEval(node.rhs))
    case '*': return toNum(aimdEval(node.lhs)) * toNum(aimdEval(node.rhs))
    case '/': return toNum(aimdEval(node.lhs)) / toNum(aimdEval(node.rhs))
    case '^': return Math.pow(toNum(aimdEval(node.lhs)), toNum(aimdEval(node.rhs)))
    case '=': case '<>': {
      const lhs = toNum(aimdEval(node.lhs)), rhs = toNum(aimdEval(node.rhs))
      const scale = Math.max(1, Math.abs(lhs), Math.abs(rhs))
      const eq = Math.abs(lhs - rhs) / scale < 1e-9
      return node.op === '=' ? eq : !eq
    }
    case '>':  return toNum(aimdEval(node.lhs)) >  toNum(aimdEval(node.rhs))
    case '<':  return toNum(aimdEval(node.lhs)) <  toNum(aimdEval(node.rhs))
    case '>=': return toNum(aimdEval(node.lhs)) >= toNum(aimdEval(node.rhs))
    case '<=': return toNum(aimdEval(node.lhs)) <= toNum(aimdEval(node.rhs))
    case 'call': return aimdCall(node.name, node.args)
    default: throw new Error(`internal: unhandled node "${node.op}"`)
  }
}

function aimdCall(name, argNodes) {
  // IF/AND/OR/NOT get the raw AST nodes so they can short-circuit (skip evaluating
  // the branch/operand that doesn't matter) instead of eagerly running every arg —
  // real Excel semantics, and avoids e.g. evaluating a division-by-zero branch that
  // IF() was specifically written to guard against.
  if (name === 'if') {
    if (argNodes.length !== 3) throw new Error('IF expects exactly 3 arguments: IF(condition, then, else)')
    return toBool(aimdEval(argNodes[0])) ? aimdEval(argNodes[1]) : aimdEval(argNodes[2])
  }
  if (name === 'and') return argNodes.every(n => toBool(aimdEval(n)))
  if (name === 'or')  return argNodes.some(n => toBool(aimdEval(n)))
  if (name === 'not') {
    if (argNodes.length !== 1) throw new Error('NOT expects exactly 1 argument')
    return !toBool(aimdEval(argNodes[0]))
  }

  const args = argNodes.map(n => toNum(aimdEval(n)))
  if (name === 'sum')     return args.reduce((a, b) => a + b, 0)
  if (name === 'average') { if (!args.length) throw new Error('AVERAGE needs at least 1 argument'); return args.reduce((a, b) => a + b, 0) / args.length }
  if (name === 'min')     { if (!args.length) throw new Error('MIN needs at least 1 argument'); return Math.min(...args) }
  if (name === 'max')     { if (!args.length) throw new Error('MAX needs at least 1 argument'); return Math.max(...args) }
  if (name === 'count')   return args.length

  const fn = AIMD_FUNCTIONS[name]
  if (!fn) throw new Error(`unknown function "${name.toUpperCase()}" — not in the Tier 1 formula function set`)
  return fn(...args)
}

// Returns { state, coherence, detail } — never throws; parse/eval failures come back
// as an honest "Unsupported" state instead of a 500 (the expression may be valid
// symbolic math that just isn't a spreadsheet formula, e.g. the whitepaper's own
// Maxwell's-law example — that needs Tier 2 formal verification, not this).
function aimdCompute(expr) {
  try {
    const result = aimdEval(aimdParse(aimdTokenize(String(expr || ''))))
    if (typeof result === 'boolean') {
      return { state: result ? 'Verified' : 'Failed', coherence: result ? 1 : 0, detail: null }
    }
    return { state: 'Computed', coherence: result, detail: null }
  } catch (e) {
    return { state: 'Unsupported', coherence: null, detail: String(e?.message || e) }
  }
}

// Keep the diagnostic stream bounded: when it exceeds the cap, roll the current
// file to a single ".1" backup (replacing any previous one) and start fresh.
async function rotateMonitorIfNeeded() {
  if (monitorRotating) return
  try {
    const st = await fs.stat(MONITOR_FILE)
    if (st.size > MONITOR_MAX_BYTES) {
      monitorRotating = true
      await fs.rm(MONITOR_FILE + '.1', { force: true }).catch(() => {})
      await fs.rename(MONITOR_FILE, MONITOR_FILE + '.1')
    }
  } catch {
    // no file yet, or a rotation race — safe to ignore
  } finally {
    monitorRotating = false
  }
}

async function emitMonitor(type, payload = {}) {
  const evt = {
    stream: 'eveglyph',
    proto: 'phosphor-jsonl-v1',
    seq: ++monitorSeq,
    ts: new Date().toISOString(),
    type,
    ...payload
  }

  try {
    await fs.mkdir(path.dirname(MONITOR_FILE), { recursive: true })
    await rotateMonitorIfNeeded()
    await fs.appendFile(MONITOR_FILE, JSON.stringify(evt) + '\n', 'utf8')
  } catch {
    // Monitoring must never break the app it observes.
  }
}

function quoteCmd(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

function decodeOutput(buffer) {
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try { return big5Decoder.decode(buffer) } catch { return utf8 }
}

// \u2500\u2500 FILE ENCODING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Files aren't all UTF-8 (Big5, GBK, Shift-JIS, UTF-16, \u2026). Detect the source
// encoding (jschardet) and decode to a UTF-8 string for the editor; on save,
// encode back to the file's original encoding (preserve) via iconv-lite.
// `fallback` is the user's Settings default-encoding: a SOFT fallback applied only
// when detection is non-committal, never an override.
//  • pure ASCII (no high bytes) → UTF-8: a universal subset, so plain English files
//    never get a surprising label, and the bytes are identical anyway.
//  • jschardet gives up (null) or guesses an unsupported codec → user fallback
//    (this is what fixes an undetected Big5/GBK file opening as mojibake).
//  • a confident, supported guess → keep it (Big5 stays Big5).
function detectFileEncoding(buf, fallback = 'UTF-8') {
  const fb = iconv.encodingExists(fallback) ? fallback : 'UTF-8'
  try {
    const r = jschardet.detect(buf)
    const enc = (r && r.encoding) || ''
    if (enc.toLowerCase() === 'ascii') return 'UTF-8'
    if (!enc) return fb
    return iconv.encodingExists(enc) ? enc : fb
  } catch { return fb }
}

function decodeFileBuffer(buf, override, fallback = 'UTF-8') {
  const fb = iconv.encodingExists(fallback) ? fallback : 'UTF-8'
  let enc = (override && override.trim()) || detectFileEncoding(buf, fb)
  if (!iconv.encodingExists(enc)) enc = fb
  let content
  try { content = iconv.decode(buf, enc) }
  catch { enc = 'UTF-8'; content = buf.toString('utf8') }
  return { content, encoding: enc }
}

// ── GIT (diff review / undo layer — PatchMD MVP) ────────────────────────────
// Git captures the agent's edits so the user can review a real diff and
// accept (commit) or reject (reset) — no custom diff engine needed.
let _gitExe = null
async function gitExe() {
  if (_gitExe) return _gitExe
  _gitExe = (process.platform === 'win32' ? await which('git') : 'git') || 'git'
  return _gitExe
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    let out = Buffer.alloc(0), err = Buffer.alloc(0)
    gitExe().then((exe) => {
      let child
      try { child = spawn(exe, args, { cwd }) }
      catch (e) { return resolve({ code: -1, out: '', err: String(e?.message || e) }) }
      child.stdout.on('data', d => { out = Buffer.concat([out, d]) })
      child.stderr.on('data', d => { err = Buffer.concat([err, d]) })
      child.on('error', e => resolve({ code: -1, out: '', err: String(e?.message || e) }))
      child.on('close', code => resolve({ code, out: out.toString('utf8'), err: err.toString('utf8') }))
    })
  })
}

async function isGitRepo(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 && r.out.trim() === 'true'
}

// Give a fresh repo a commit identity so commits don't fail; don't touch an
// existing repo that already has one configured.
async function ensureGitIdentity(cwd) {
  const email = (await runGit(cwd, ['config', 'user.email'])).out.trim()
  if (!email) {
    await runGit(cwd, ['config', 'user.email', BRIDGE_CONFIG.gitIdentity.email])
    await runGit(cwd, ['config', 'user.name', BRIDGE_CONFIG.gitIdentity.name])
  }
}

// Commit whatever's staged under `message`, but only when there's actually
// something to commit (or this is a brand-new repo with no HEAD yet, which needs
// one commit to have a valid baseline at all) — skips the old unconditional
// `--allow-empty`, which minted a useless commit on every single agent run/replace
// even when nothing had changed since the last one.
async function commitIfChanged(cwd, message) {
  const staged = await runGit(cwd, ['diff', '--cached', '--quiet'])   // exit 0 = no staged diff
  const hasHead = (await runGit(cwd, ['rev-parse', 'HEAD'])).code === 0
  if (staged.code !== 0) {
    await runGit(cwd, ['commit', '-m', message])
  } else if (!hasHead) {
    await runGit(cwd, ['commit', '-m', message, '--allow-empty'])
  }
  return (await runGit(cwd, ['rev-parse', 'HEAD'])).out.trim()
}

function withVersionArg(command) {
  const trimmed = command.trim()
  return `${trimmed} --version`
}

async function powershellCommandPath(name) {
  if (process.platform !== 'win32') return null
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn(ps, ['-NoProfile', '-Command', `(Get-Command ${JSON.stringify(name)} -ErrorAction SilentlyContinue).Source`])
    } catch {
      return resolve(null)
    }
    child.stdout.on('data', d => { out += d })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() || null : null))
  })
}

async function which(name) {
  if (process.platform === 'win32') {
    const lname = name.toLowerCase()
    // Resolve known versioned-folder installs first so we pick the CLI, not a
    // same-named GUI app on PATH (e.g. the WindowsApps Claude desktop app).
    if (lname === 'codex') {
      const local = await findLocalCodexExe()
      if (local) return local
    }
    if (lname === 'claude') {
      const local = await findLocalClaudeExe()
      if (local) return local
    }
    if (lname === 'gemini') {
      const local = await findLocalGeminiExe()
      if (local) return local
    }
  }

  const fromPowerShell = await powershellCommandPath(name)
  if (fromPowerShell) return fromPowerShell

  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'C:\\Windows\\System32\\where.exe' : 'which'
    let out = ''
    let child
    try { child = spawn(finder, [name]) } catch { return resolve(null) }
    child.stdout.on('data', d => { out += d })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() : null))
  })
}

async function findLocalCodexExe() {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    : null
  if (!base) return null

  try {
    const entries = await fs.readdir(base, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const exe = path.join(base, entry.name, 'codex.exe')
      try {
        await fs.access(exe)
        return exe
      } catch {}
    }
  } catch {}

  return null
}

// The Gemini CLI installs as a global npm package, so its launcher shim lives in
// the npm global bin (%APPDATA%\npm on Windows). Resolve it directly so detection
// works even when that dir isn't on PATH — parity with the claude/codex resolvers.
async function findLocalGeminiExe() {
  const roots = []
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm'))
  const home = os.homedir()
  if (home) roots.push(path.join(home, 'AppData', 'Roaming', 'npm'))
  for (const base of [...new Set(roots)]) {
    for (const name of ['gemini.cmd', 'gemini.exe', 'gemini']) {   // .cmd is the runnable Windows shim
      const exe = path.join(base, name)
      try { await fs.access(exe); return exe } catch {}
    }
  }
  return null
}

// Newest-first comparator for version folder names like "2.1.170".
function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0)
    if (diff) return diff
  }
  return 0
}

// Candidate roots for %APPDATA%, tolerant of APPDATA being unset in some launch
// environments — fall back to the OS home dir and USERPROFILE.
function roamingRoots() {
  const roots = []
  if (process.env.APPDATA) roots.push(process.env.APPDATA)
  const home = os.homedir()
  if (home) roots.push(path.join(home, 'AppData', 'Roaming'))
  if (process.env.USERPROFILE) roots.push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming'))
  return [...new Set(roots)]
}

// Folders that may hold claude-code\<version>\claude.exe. Covers BOTH a normal
// install (%APPDATA%\Claude\claude-code) AND the MSIX-packaged Claude desktop
// app, whose "Roaming\Claude" is a virtualized redirect that a normally-launched
// process often cannot follow ("system cannot find the path specified"). The
// real files live under %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\...
async function claudeSearchBases() {
  const bases = []
  for (const root of roamingRoots()) {
    bases.push(path.join(root, 'Claude', 'claude-code'))
  }
  const localApp = process.env.LOCALAPPDATA
    || (os.homedir() && path.join(os.homedir(), 'AppData', 'Local'))
  if (localApp) {
    const pkgRoot = path.join(localApp, 'Packages')
    try {
      const pkgs = await fs.readdir(pkgRoot, { withFileTypes: true })
      for (const pkg of pkgs) {
        if (pkg.isDirectory() && /^Claude_/i.test(pkg.name)) {
          bases.push(path.join(pkgRoot, pkg.name, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
        }
      }
    } catch {}
  }
  return [...new Set(bases)]
}

// Pick the newest version's exe — and crucially the CLI, not the WindowsApps
// desktop GUI app that shares the name "claude".
async function findLocalClaudeExe() {
  for (const base of await claudeSearchBases()) {
    try {
      const entries = await fs.readdir(base, { withFileTypes: true })
      const versions = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort(compareVersionsDesc)
      for (const v of versions) {
        const exe = path.join(base, v, 'claude.exe')
        try {
          await fs.access(exe)
          return exe
        } catch {}
      }
    } catch {}
  }

  return null
}

async function resolveAgentCommand(agentId, command, permission = 'standard') {
  if (command && command.trim()) {
    // The override "owns the whole command" — it runs completely unmodified, so it
    // bypasses every tier-based restriction the cautious/standard flag sets exist
    // for. Requiring Trusted here makes that bypass an explicit, deliberate choice
    // rather than something a Cautious/Standard-tier config can do silently.
    if (permission !== 'trusted') {
      throw new Error('Command override requires the Trusted permission tier (it replaces the whole command, bypassing all tier-based CLI restrictions) — switch to Trusted in Settings, or clear the override.')
    }
    return command.trim()
  }
  const spec = AGENTS[agentId]
  if (!spec) return null
  const flags = spec.flags(permission)
  const resolved = process.env[AGENT_EXE_ENV[agentId]] || await which(spec.exe)
  if (!resolved) return `${spec.exe} ${flags}`.trim()
  return `${quoteCmd(resolved)} ${flags}`.trim()
}

function probeCommand(command) {
  return new Promise((resolve) => {
    let child
    let stderr = Buffer.alloc(0)
    const timer = setTimeout(() => {
      try { child?.kill() } catch {}
      resolve({ runnable: false, error: 'probe timed out' })
    }, BRIDGE_CONFIG.probeTimeoutMs)

    try {
      child = spawn(withVersionArg(command), { shell: true, cwd: process.cwd() })
    } catch (e) {
      clearTimeout(timer)
      resolve({ runnable: false, error: String(e?.message || e) })
      return
    }

    child.stderr.on('data', d => { stderr = Buffer.concat([stderr, d]) })
    child.on('error', e => {
      clearTimeout(timer)
      resolve({ runnable: false, error: String(e?.message || e) })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({
        runnable: code === 0,
        error: code === 0 ? '' : (decodeOutput(stderr).trim() || `exit ${code}`)
      })
    })
  })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function isTextFile(name) {
  return /\.(md|txt|html|json|ya?ml)$/i.test(name)
}

// Directories never shown in the file tree (deps, build output, VCS).
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

async function listFiles(root, dir = '', out = []) {
  const abs = path.join(root, dir)
  const entries = await fs.readdir(abs, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
    const rel = dir ? path.join(dir, entry.name) : entry.name
    const normalized = rel.split(path.sep).join('/')

    if (entry.isDirectory()) {
      await listFiles(root, rel, out)
    } else if (entry.isFile() && isTextFile(entry.name)) {
      out.push(normalized)
    }
  }

  return out
}

function resolveInside(root, rel = '') {
  const base = path.resolve(root)
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('path escapes workspace')
  }
  return target
}

function json(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Only serve /api to requests that are actually local. Blocks CSRF / DNS-rebinding:
// a malicious page would carry a foreign Host (rebinding) or Origin (cross-site).
function isLocalRequest(req) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase()
  const hostOk = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  const origin = req.headers.origin
  if (origin) {
    try {
      const oh = new URL(origin).hostname.toLowerCase()
      if (!(oh === 'localhost' || oh === '127.0.0.1' || oh === '::1')) return false
    } catch { return false }
  }
  return hostOk
}

// Probing each agent (spawn `--version`) is slow; cache the result briefly so the
// per-run detect and every settings onchange don't re-spawn three processes.
let agentsCache = null
let agentsCacheAt = 0
const AGENTS_TTL_MS = BRIDGE_CONFIG.agentsCacheTtlMs

async function getAgentsInfo(force = false) {
  if (!force && agentsCache && Date.now() - agentsCacheAt < AGENTS_TTL_MS) {
    return agentsCache
  }
  const agents = {}
  for (const [id, agent] of Object.entries(AGENTS)) {
    const stdFlags = agent.flags(DISPLAY_TIER)
    const resolved = process.env[AGENT_EXE_ENV[id]] || await which(agent.exe)
    const resolvedCmd = resolved ? `${quoteCmd(resolved)} ${stdFlags}`.trim() : null
    const probe = resolved ? await probeCommand(quoteCmd(resolved)) : { runnable: false, error: 'not found on PATH' }
    agents[id] = {
      label: agent.label,
      cmd: `${agent.exe} ${stdFlags}`.trim(),
      path: resolved,
      runnable: probe.runnable,
      error: probe.error,
      resolvedCmd: probe.runnable ? resolvedCmd : null
    }
  }
  const _debug = {
    build: BRIDGE_BUILD,
    appdata: process.env.APPDATA || null,
    localappdata: process.env.LOCALAPPDATA || null,
    home: os.homedir(),
    claudeResolved: await findLocalClaudeExe()
  }
  agentsCache = { cwd: process.cwd(), agents, _debug }
  agentsCacheAt = Date.now()
  return agentsCache
}

export function agentBridge() {
  return {
    name: 'eveglyph-agent-bridge',
    apply: 'serve',
    configureServer(server) {
      // Gate every /api endpoint to local requests only (runs before the handlers).
      server.middlewares.use('/api', (req, res, next) => {
        if (!isLocalRequest(req)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'forbidden: local origin only' }))
          return
        }
        next()
      })

      server.middlewares.use('/api/agents', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = new URL(req.url, 'http://localhost')
        const info = await getAgentsInfo(url.searchParams.has('fresh'))
        emitMonitor('agent:detect', {
          cwd: info.cwd,
          agents: Object.fromEntries(Object.entries(info.agents).map(([id, a]) => [id, {
            found: Boolean(a.path),
            runnable: Boolean(a.runnable),
            path: a.path,
            error: a.error
          }]))
        })
        json(res, 200, info)
      })

      server.middlewares.use('/api/monitor', async (req, res, next) => {
        // GET → tail the diagnostic stream for the in-app viewer. The file lives
        // outside the workspace (../PHOSPHOR), so this is the only safe read path;
        // it's a fixed, bridge-owned path (never a user-supplied one).
        if (req.method === 'GET') {
          try {
            const url = new URL(req.url, 'http://localhost')
            const rawLimit = parseInt(url.searchParams.get('limit'), 10)
            const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, BRIDGE_CONFIG.monitorViewMax)
            const events = []
            let exists = true
            try {
              const st = await fs.stat(MONITOR_FILE)
              const start = Math.max(0, st.size - BRIDGE_CONFIG.monitorTailBytes)
              const fh = await fs.open(MONITOR_FILE, 'r')
              try {
                const buf = Buffer.alloc(st.size - start)
                const { bytesRead } = await fh.read(buf, 0, buf.length, start)   // file may have shrunk (rotation) since stat
                let text = buf.toString('utf8', 0, bytesRead)                    // decode only what was actually read (no NUL tail)
                if (start > 0) { const nl = text.indexOf('\n'); if (nl >= 0) text = text.slice(nl + 1) }  // drop torn first line
                for (const line of text.split('\n')) {
                  const s = line.trim()
                  if (!s) continue
                  try { const v = JSON.parse(s); if (v && typeof v === 'object') events.push(v) } catch { /* skip a torn/partial line */ }
                }
              } finally { await fh.close() }
            } catch { exists = false }   // no file yet → empty stream
            json(res, 200, { ok: true, file: MONITOR_FILE, exists, events: events.slice(-limit) })
          } catch (e) {
            json(res, 400, { error: String(e?.message || e) })
          }
          return
        }
        if (req.method !== 'POST') return next()
        try {
          const body = await readJsonBody(req)
          const { type = 'event', ...payload } = body || {}
          await emitMonitor(`ui:${type}`, {
            href: payload.href || null,
            active: payload.active || null,
            ...payload
          })
          json(res, 200, { ok: true })
        } catch (e) {
          emitMonitor('ui:error', { op: 'monitor', error: String(e?.message || e) })
          json(res, 400, { error: String(e?.message || e) })
        }
      })

      // Directory browser for the folder picker: list a directory's subfolders,
      // its parent, and (on Windows) available drives — so the UI can navigate
      // visually and return an absolute path the agent can use. Read-only; names only.
      server.middlewares.use('/api/browse', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        try {
          const url = new URL(req.url, 'http://localhost')
          const raw = url.searchParams.get('path') || ''
          const start = raw ? path.resolve(raw) : os.homedir()
          let dirs = []
          try {
            const entries = await fs.readdir(start, { withFileTypes: true })
            dirs = entries
              .filter(e => { try { return e.isDirectory() } catch { return false } })
              .map(e => e.name)
              .filter(n => !n.startsWith('$') && n !== 'node_modules')
              .sort((a, b) => a.localeCompare(b))
          } catch { /* unreadable dir → empty list, still report the path */ }
          const parent = path.dirname(start)
          const drives = []
          if (process.platform === 'win32') {
            for (const L of 'CDEFGHABIJKLMNOPQRSTUVWXYZ') {
              const root = `${L}:\\`
              try { await fs.access(root); drives.push(root) } catch {}
            }
          }
          json(res, 200, { path: start, parent: parent === start ? null : parent, dirs, drives })
        } catch (e) {
          json(res, 400, { error: String(e?.message || e) })
        }
      })

      server.middlewares.use('/api/workspace', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        if (req.url?.startsWith('/file')) return next()
        try {
          const url = new URL(req.url, 'http://localhost')
          const cwd = url.searchParams.get('cwd') || process.cwd()
          const root = path.resolve(cwd)
          const stat = await fs.stat(root)
          if (!stat.isDirectory()) throw new Error('workspace is not a directory')
          confirmedWorkspace = root   // pin: file/git/agent ops are now confined to this folder
          const files = await listFiles(root)
          emitMonitor('workspace:list', { cwd: root, count: files.length })
          json(res, 200, { cwd: root, name: path.basename(root), files })
        } catch (e) {
          emitMonitor('workspace:error', { op: 'list', error: String(e?.message || e) })
          json(res, 400, { error: String(e?.message || e) })
        }
      })

      server.middlewares.use('/api/workspace/file', async (req, res, next) => {
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost')
            const cwd = url.searchParams.get('cwd') || process.cwd()
            assertWorkspace(cwd)
            const file = url.searchParams.get('path') || ''
            const override = url.searchParams.get('encoding') || ''   // force a specific encoding (optional)
            const fallback = url.searchParams.get('fallback') || 'UTF-8'   // Settings default — soft fallback only
            const buf = await fs.readFile(resolveInside(cwd, file))    // raw bytes, not utf8
            const { content, encoding } = decodeFileBuffer(buf, override, fallback)
            emitMonitor('file:read', { cwd: path.resolve(cwd), path: file, bytes: buf.length, encoding })
            json(res, 200, { path: file, content, encoding })
            return
          }

          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            assertWorkspace(body.cwd || process.cwd())
            const abs = resolveInside(body.cwd || process.cwd(), body.path || '')
            // Preserve the file's original encoding (write back in the same one);
            // unknown/absent → UTF-8.
            const enc = (body.encoding && iconv.encodingExists(body.encoding)) ? body.encoding : 'UTF-8'
            const bytes = iconv.encode(body.content || '', enc)
            await fs.mkdir(path.dirname(abs), { recursive: true })
            await fs.writeFile(abs, bytes)
            emitMonitor('file:write', {
              cwd: path.resolve(body.cwd || process.cwd()),
              path: body.path || '',
              bytes: bytes.length,
              encoding: enc
            })
            json(res, 200, { ok: true, encoding: enc })
            return
          }
        } catch (e) {
          emitMonitor('file:error', { method: req.method, error: String(e?.message || e) })
          json(res, 400, { error: String(e?.message || e) })
          return
        }
        next()
      })

      // AIMD Phase 2 (whitepaper v0.5 §4.6) — compute/verify one Logic_Node's
      // expression. Explicit-click-only from the frontend (never auto-run on
      // render/open), workspace-gated like every other endpoint. `verifier:
      // "internal"` runs the safe arithmetic evaluator above; any other verifier
      // (lean4/coq/python) honestly reports "not wired yet" rather than faking a
      // result or shelling out to an unsandboxed external interpreter.
      server.middlewares.use('/api/compute', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = await readJsonBody(req)
          assertWorkspace(body.cwd || process.cwd())
          const verifier = String(body.verifier || 'formula').toLowerCase()
          const permission = String(body.permission || 'standard').toLowerCase()   // mirrors /api/agent's field
          const nodeId = String(body.node_id || '')
          const expr = String(body.expr || '')

          let result
          if (verifier === 'formula') {
            result = aimdCompute(expr)   // Tier 1 — available at every permission tier
          } else if (permission !== 'trusted') {
            // Tier 2 (formal verification) needs the same elevated tier the local
            // agent's Trusted mode uses — checked server-side, not just hidden in the UI.
            result = { state: 'Unsupported', coherence: null, detail: `verifier "${verifier}" is Tier 2 (formal verification) — requires the Trusted permission tier (Settings ⚙ → Agent permission). Currently: ${permission}.` }
          } else {
            result = { state: 'Unsupported', coherence: null, detail: `verifier "${verifier}" is not wired yet — Trusted tier is satisfied, but the actual sandboxing policy (subprocess isolation, timeouts, resource limits) for shelling out to an external interpreter is still an open product decision (see whitepaper v0.5 §4.6).` }
          }

          emitMonitor('aimd:compute', { node_id: nodeId, verifier, permission, state: result.state })
          json(res, 200, { node_id: nodeId, verifier, ...result })
        } catch (e) {
          emitMonitor('aimd:compute:error', { error: String(e?.message || e) })
          json(res, 400, { error: String(e?.message || e) })
        }
      })

      // Snapshot the workspace before an agent run (init repo if needed) so the
      // agent's edits become a reviewable diff against this baseline.
      server.middlewares.use('/api/git/snapshot', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const body = await readJsonBody(req).catch(() => ({}))
        const cwd = body.cwd || process.cwd()
        const label = String(body.label || '').replace(/\s+/g, ' ').slice(0, BRIDGE_CONFIG.gitMessageMaxChars)
        try {
          assertWorkspace(cwd)
          if (!(await isGitRepo(cwd))) {
            const init = await runGit(cwd, ['init'])
            if (init.code !== 0) { json(res, 200, { ok: false, available: false, error: init.err.trim() || 'git init failed' }); return }
          }
          await ensureGitIdentity(cwd)
          await runGit(cwd, ['add', '-A'])
          const head = await commitIfChanged(cwd, `pre-agent: ${label}`)
          emitMonitor('git:snapshot', { cwd, head })
          json(res, 200, { ok: true, available: true, head })
        } catch (e) { json(res, 400, { error: String(e?.message || e) }) }
      })

      // The agent's changes vs the pre-agent baseline, as a unified diff.
      server.middlewares.use('/api/git/diff', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = new URL(req.url, 'http://localhost')
        const cwd = url.searchParams.get('cwd') || process.cwd()
        try {
          assertWorkspace(cwd)
          if (!(await isGitRepo(cwd))) { json(res, 200, { available: false, hasChanges: false }); return }
          await runGit(cwd, ['add', '-A'])  // stage so new files appear in the diff too
          const diff = (await runGit(cwd, ['diff', '--cached', 'HEAD'])).out
          const stat = (await runGit(cwd, ['diff', '--cached', 'HEAD', '--stat'])).out
          emitMonitor('git:diff', { cwd, bytes: diff.length, changed: diff.trim().length > 0 })
          json(res, 200, { available: true, diff, stat, hasChanges: diff.trim().length > 0 })
        } catch (e) { json(res, 400, { error: String(e?.message || e) }) }
      })

      // Accept: keep the agent's changes as a commit.
      server.middlewares.use('/api/git/accept', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const body = await readJsonBody(req).catch(() => ({}))
        const cwd = body.cwd || process.cwd()
        const msg = String(body.message || 'agent changes').replace(/\s+/g, ' ').slice(0, BRIDGE_CONFIG.gitMessageMaxChars)
        try {
          assertWorkspace(cwd)
          await runGit(cwd, ['add', '-A'])
          await commitIfChanged(cwd, `agent: ${msg}`)
          emitMonitor('git:accept', { cwd })
          json(res, 200, { ok: true })
        } catch (e) { json(res, 400, { error: String(e?.message || e) }) }
      })

      // Reject: discard the agent's changes, back to the pre-agent baseline.
      server.middlewares.use('/api/git/reject', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const body = await readJsonBody(req).catch(() => ({}))
        const cwd = body.cwd || process.cwd()
        // Direct mode auto-commits its own changes (see /api/git/accept and
        // src/agent.js) since it has no manual Accept gate — so there, "reject"
        // means undo that commit too (HEAD~1, back to the pre-agent snapshot),
        // not just reset an already-clean working tree against its own HEAD.
        const target = body.committed ? 'HEAD~1' : 'HEAD'
        try {
          assertWorkspace(cwd)
          await runGit(cwd, ['reset', '--hard', target])
          await runGit(cwd, ['clean', '-fd'])   // remove agent-created untracked files
          emitMonitor('git:reject', { cwd, target })
          json(res, 200, { ok: true })
        } catch (e) { json(res, 400, { error: String(e?.message || e) }) }
      })

      server.middlewares.use('/api/agent', async (req, res, next) => {
        if (req.url?.startsWith('/stop')) return next()
        if (req.method !== 'POST') return next()

        let body
        try { body = await readJsonBody(req) }
        catch { res.statusCode = 400; return res.end('bad request body') }

        const { agent, prompt = '', cwd, command, permission, timeoutMs } = body
        const workdir = cwd || process.cwd()
        try { assertWorkspace(workdir) }   // confine the auto-approve agent to the opened folder
        catch (e) { res.statusCode = 400; return res.end(String(e?.message || e)) }
        const runTimeoutMs = Math.min(Math.max(Number(timeoutMs) || BRIDGE_CONFIG.agentTimeoutMs, 10000), 1800000)   // 10s–30min
        let tmpl
        try { tmpl = await resolveAgentCommand(agent, command, permission) }   // tier → real CLI flags
        catch (e) { res.statusCode = 400; return res.end(String(e?.message || e)) }
        if (!tmpl) { res.statusCode = 400; return res.end('unknown agent') }

        res.setHeader('Content-Type', 'application/x-ndjson')
        res.setHeader('Cache-Control', 'no-cache')
        const send = (obj) => {
          try { res.write(JSON.stringify(obj) + '\n') } catch { /* client gone */ }
        }

        const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        emitMonitor('agent:start', { agent, cwd: workdir, cmd: tmpl, permission: permission || 'standard', promptBytes: Buffer.byteLength(prompt, 'utf8') })
        send({ type: 'meta', agent, cmd: tmpl, cwd: workdir, runId })

        let child
        try {
          // shell:true is required on Windows to resolve .cmd shims.
          child = spawn(tmpl, { shell: true, cwd: workdir })
        } catch (e) {
          emitMonitor('agent:error', { agent, cwd: workdir, error: String(e?.message || e) })
          send({ type: 'error', data: String(e?.message || e) })
          return res.end()
        }

        activeAgents.set(runId, { child, agent, cwd: workdir, startedAt: Date.now() })
        const maxRuntime = setTimeout(() => {
          if (!activeAgents.has(runId)) return
          emitMonitor('agent:timeout', { agent, cwd: workdir, runId, ms: runTimeoutMs })
          send({ type: 'error', data: `Agent stopped after ${Math.round(runTimeoutMs / 1000)} seconds.` })
          try { child.kill() } catch {}
        }, runTimeoutMs)

        try { child.stdin.write(prompt); child.stdin.end() } catch { /* ignore */ }

        // Agent CLIs stream UTF-8. Use ONE stateful decoder per stream so a multibyte
        // char split across a chunk boundary is buffered, not emitted as U+FFFD — which
        // the old per-chunk decodeOutput() then mis-"rescued" as Big5, mojibaking CJK
        // (e.g. 繁中) agent output. The buffered probe path still uses decodeOutput().
        const outDec = new TextDecoder('utf-8')
        const errDec = new TextDecoder('utf-8')
        child.stdout.on('data', d => {
          const data = outDec.decode(d, { stream: true })
          if (!data) return
          emitMonitor('agent:stdout', { agent, cwd: workdir, bytes: Buffer.byteLength(data, 'utf8'), sample: data.slice(0, 500) })
          send({ type: 'stdout', data })
        })
        child.stderr.on('data', d => {
          const data = errDec.decode(d, { stream: true })
          if (!data) return
          emitMonitor('agent:stderr', { agent, cwd: workdir, bytes: Buffer.byteLength(data, 'utf8'), sample: data.slice(0, 500) })
          send({ type: 'stderr', data })
        })
        child.on('error', e => {
          emitMonitor('agent:error', { agent, cwd: workdir, error: String(e?.message || e) })
          send({ type: 'error', data: String(e?.message || e) })
        })
        child.on('close', code => {
          clearTimeout(maxRuntime)
          activeAgents.delete(runId)
          const tailOut = outDec.decode(); const tailErr = errDec.decode()   // flush any buffered trailing bytes
          if (tailOut) send({ type: 'stdout', data: tailOut })
          if (tailErr) send({ type: 'stderr', data: tailErr })
          emitMonitor('agent:done', { agent, cwd: workdir, code })
          send({ type: 'done', code })
          res.end()
        })
        req.on('close', () => {
          if (!activeAgents.has(runId)) return
          clearTimeout(maxRuntime)
          activeAgents.delete(runId)
          emitMonitor('agent:client-close', { agent, cwd: workdir, runId })
          try { child.kill() } catch { /* ignore */ }
        })
      })

      server.middlewares.use('/api/agent/stop', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = {}
        try { body = await readJsonBody(req) } catch {}
        let stopped = 0
        for (const [runId, item] of activeAgents.entries()) {
          activeAgents.delete(runId)
          stopped += 1
          emitMonitor('agent:stop', { agent: item.agent, cwd: item.cwd, runId, reason: body.reason || 'user' })
          try { item.child.kill() } catch {}
        }
        json(res, 200, { ok: true, stopped })
      })
    }
  }
}
