// ─── AI SEMANTIC SEARCH (whitepaper §12.2) ────────────────────────
// A second, deliberately SEPARATE search mode from search.js's exact/regex
// navigator (§5.2/§12.1: "human-owned, NOT AI"). This one answers a natural-
// language question using whichever cloud provider is configured in Settings
// (Anthropic or OpenAI-compatible) — one-shot: the corpus is sent as plain prompt
// context, not a dedicated embeddings index, so it's bounded by
// CONFIG.aiSearch.maxContextChars rather than scaling to arbitrary workspace size.
// Doesn't work with the "Local Agent (CLI)" provider — that's a different
// invocation shape (spawn + stdin), not a simple chat-completion call.
import { S } from './state.js'
import { CONFIG } from './config.js'
import { callAiProvider } from './ai.js'
import { editorGet, editorGoToMatch } from './editor.js'
import { openFile } from './files.js'
import { monitor } from './monitor.js'
import { t, tPlural } from './i18n/index.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

async function textForPath(path) {
  if (path === S.active) return editorGet()
  const fi = S.files.get(path)
  if (!fi) return null
  if (fi.content != null) return fi.content
  if (fi.source !== 'bridge') return null
  try {
    const r = await fetch(`/api/workspace/file?${new URLSearchParams({ cwd: S.workspaceRoot, path })}`)
    if (!r.ok) return null
    return (await r.json()).content || ''
  } catch { return null }
}

// Assembles the corpus as plain prompt context, capped at maxContextChars. Stops
// adding files once the cap is hit rather than truncating mid-file, so every
// included file is intact (a half-file would make the "quote verbatim" instruction
// to the model unreliable right at the cut point).
async function buildCorpus(scope) {
  const cap = CONFIG.aiSearch.maxContextChars
  const paths = scope === 'file' ? (S.active ? [S.active] : []) : [...S.files.keys()]
  const parts = []
  let used = 0
  let truncated = false
  let fileCount = 0
  for (const path of paths) {
    const text = await textForPath(path)
    if (text == null) continue
    const block = `### FILE: ${path}\n${text}\n`
    if (used + block.length > cap) { truncated = true; if (parts.length) continue; }
    parts.push(block)
    used += block.length
    fileCount++
  }
  return { text: parts.join('\n'), truncated, fileCount }
}

function buildPrompt(query, corpus) {
  return `You are a semantic search assistant over a set of Markdown/text files. Given the corpus below and a natural-language question, find the passages most relevant to answering it — not just keyword matches, actual conceptual relevance.

Return ONLY a JSON array (no markdown fences, no prose outside the JSON), each item shaped exactly like:
{"file": "<the FILE path exactly as given>", "snippet": "<a short, EXACT VERBATIM quote copied character-for-character from that file, 5-25 words>", "reason": "<one short sentence on why this is relevant to the question>"}

Rules:
- "snippet" MUST be an exact substring of the named file's content — do not paraphrase, summarize, or fix typos in it. It's used to locate the passage afterward, so it has to match verbatim.
- Return at most 8 items, most relevant first.
- If nothing in the corpus is meaningfully relevant, return an empty array: []

Question: ${query}

Corpus:
${corpus}`
}

function parseResults(raw) {
  // Models sometimes wrap JSON in ```json fences despite instructions — strip if present.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('response was not a JSON array')
  return parsed
    .filter(r => r && typeof r.file === 'string' && typeof r.snippet === 'string')
    .slice(0, 8)
}

export async function runAiSearch() {
  const query = $('aisearch-input')?.value.trim()
  const out = $('aisearch-results')
  if (!out) return
  if (!query) { out.innerHTML = ''; return }

  if (S.cfg.provider === 'local-agent') {
    out.innerHTML = `<div class="search-empty">${t('aiSearchDynamic.needsCloudProvider')}</div>`
    return
  }
  if (!S.cfg.key) {
    out.innerHTML = `<div class="search-empty">${t('aiSearchDynamic.needsApiKey')}</div>`
    return
  }

  const scope = document.querySelector('input[name="aisearch-scope"]:checked')?.value || 'file'
  out.innerHTML = `<div class="search-empty"><span class="spinner"></span> ${t('aiSearchDynamic.asking')}</div>`
  await monitor('aisearch:run', { scope, provider: S.cfg.provider, qlen: query.length })

  const corpus = await buildCorpus(scope)
  if (!corpus.text.trim()) {
    out.innerHTML = `<div class="search-empty">${t('aiSearchDynamic.nothingToSearch')}</div>`
    return
  }

  try {
    const raw = await callAiProvider(buildPrompt(query, corpus.text))
    const results = parseResults(raw)
    renderAiResults(results, corpus)
    await monitor('aisearch:success', { scope, results: results.length, truncated: corpus.truncated })
  } catch (e) {
    out.innerHTML = `<div class="search-empty">✗ ${esc(e.message)}</div>`
    await monitor('aisearch:error', { scope, error: String(e?.message || e) })
  }
}

function renderAiResults(results, corpus) {
  const out = $('aisearch-results')
  out.innerHTML = ''

  if (corpus.truncated) {
    const warn = document.createElement('div')
    warn.className = 'search-empty'
    warn.style.color = 'var(--t2)'
    warn.textContent = t('aiSearchDynamic.truncatedWarn', { cap: (CONFIG.aiSearch.maxContextChars / 1000).toFixed(0), count: corpus.fileCount })
    out.appendChild(warn)
  }

  if (!results.length) {
    const empty = document.createElement('div')
    empty.className = 'search-empty'
    empty.textContent = t('aiSearchDynamic.noResults')
    out.appendChild(empty)
    return
  }

  const head = document.createElement('div')
  head.className = 'search-count'
  const resultWord = tPlural('aiSearchDynamic.resultCount', 'aiSearchDynamic.resultCountPlural', results.length, { count: results.length })
  head.textContent = resultWord + t('aiSearchDynamic.aiRanked')
  out.appendChild(head)

  for (const r of results) {
    const item = document.createElement('div')
    item.className = 'search-hit aisearch-hit'
    const file = document.createElement('div'); file.className = 'search-file'; file.textContent = r.file
    const sn = document.createElement('div'); sn.className = 'search-snip'
    sn.textContent = r.snippet.length > CONFIG.aiSearch.snippetMaxChars ? r.snippet.slice(0, CONFIG.aiSearch.snippetMaxChars) + '…' : r.snippet
    const why = document.createElement('div'); why.className = 'aisearch-reason'; why.textContent = r.reason || ''
    item.append(file, sn, why)
    item.onclick = () => jumpToSnippet(r)
    out.appendChild(item)
  }
}

// The model was asked to quote verbatim, but isn't guaranteed to have — fall back
// to just opening the file (still useful) if the snippet can't be located exactly.
async function jumpToSnippet(r) {
  if (r.file !== S.active) await openFile(r.file)
  const text = editorGet()
  const offset = text.indexOf(r.snippet)
  if (offset === -1) {
    await monitor('aisearch:jump', { file: r.file, exact: false })
    return
  }
  editorGoToMatch(offset, r.snippet.length)
  await monitor('aisearch:jump', { file: r.file, exact: true })
}
