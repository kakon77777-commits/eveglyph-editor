import { S } from './state.js'
import { CONFIG } from './config.js'
import { editorGetSel } from './editor.js'
import { compileContext } from './context.js'
import { refreshFromDisk } from './files.js'
import { statusUpdate } from './status.js'
import { monitor } from './monitor.js'

// Best-effort readable name for the user's browser language, so the agent
// replies in the user's language instead of defaulting to an arbitrary one.
function userLanguage() {
  const code = (navigator.language || (navigator.languages && navigator.languages[0]) || 'en')
  const lc = code.toLowerCase()
  const names = {
    'zh-tw': 'Traditional Chinese (繁體中文)',
    'zh-hk': 'Traditional Chinese (繁體中文)',
    'zh-cn': 'Simplified Chinese (简体中文)',
    'zh':    'Chinese (中文)',
    'ja':    'Japanese (日本語)',
    'ko':    'Korean (한국어)',
    'en':    'English'
  }
  return names[lc] || names[lc.split('-')[0]] || code
}

export async function detectAgents(fresh = false) {
  try {
    await monitor('agent:detect:start', { fresh })
    const r = await fetch(fresh ? '/api/agents?fresh=1' : '/api/agents')
    if (!r.ok) {
      await monitor('agent:detect:error', { status: r.status })
      return null
    }
    const info = await r.json()
    await monitor('agent:detect:success', {
      cwd: info.cwd,
      found: Object.fromEntries(Object.entries(info.agents || {}).map(([id, agent]) => [id, Boolean(agent.path)])),
      runnable: Object.fromEntries(Object.entries(info.agents || {}).map(([id, agent]) => [id, Boolean(agent.runnable)]))
    })
    return info
  } catch (e) {
    await monitor('agent:detect:error', { error: String(e?.message || e) })
    return null
  }
}

export async function runAgent(userTask) {
  await monitor('agent:run:start', {
    provider: S.cfg.provider,
    agent: S.cfg.agent || 'claude',
    cwd: S.cfg.workspace || '',
    active: S.active || null,
    taskBytes: userTask.length
  })

  const wrap = document.getElementById('ai-resp-wrap')
  const resp = document.getElementById('ai-resp')
  const stopBtn = document.getElementById('btn-agent-stop')
  wrap.style.display = 'flex'
  showDiffActions(false)        // clear any stale review UI from a previous run…
  S._pendingReview = null       // …and its pending-commit target (avoid acting on a stale baseline)

  // In agent mode the editor and agent share ONE workspace: S.workspaceRoot is
  // the folder actually loaded via the bridge; fall back to the configured path.
  const cwd = (S.workspaceRoot || S.cfg.workspace || '').trim()
  const agent = S.cfg.agent || 'claude'
  const command = (S.cfg.agentCmd || '').trim()

  if (!cwd) {
    await monitor('agent:run:block', { reason: 'missing workspace' })
    resp.className = 'err'
    resp.textContent = 'Set the workspace absolute path in Settings first. That is the folder the agent will edit.'
    return
  }

  const info = await detectAgents()
  S.agentBridge = info
  const selected = info?.agents?.[agent]
  const resolvedCommand = command || selected?.resolvedCmd || ''
  if (!info) {
    S.agentConnected = false
    statusUpdate()
    await monitor('agent:run:block', { reason: 'bridge offline', agent, cwd })
    resp.className = 'err'
    resp.textContent = 'Local bridge is offline. Start EveGlyph Editor with start-eveglyph.bat or npm run dev.'
    return
  }

  if (!selected?.runnable && !command) {
    S.agentConnected = false
    statusUpdate()
    await monitor('agent:run:block', { reason: 'agent not runnable', agent, cwd, error: selected?.error || '' })
    resp.className = 'err'
    resp.textContent = selected?.path
      ? `${agent} was found but cannot run: ${selected.error || 'unknown error'}. Add a command override in Settings or install a runnable CLI.`
      : `${agent} is not on PATH. Add a command override in Settings or install the CLI.`
    return
  }

  S.agentConnected = true
  statusUpdate()

  const perm = S.cfg.agentPermission || 'standard'
  // Re-confirm whenever the target workspace changes — not once per session — UNLESS
  // permission is "trusted" (the user has opted to skip the auto-approve dialog).
  // (Confirming for folder A must NOT silently authorize edits in folder B.)
  if (S._agentOkCwd !== cwd) {
    if (perm === 'trusted') {
      S._agentOkCwd = cwd
    } else {
      const ok = confirm(`Local-agent mode lets "${agent}" run with auto-approve and edit files in:\n\n${cwd}\n\nContinue?`)
      if (!ok) {
        await monitor('agent:run:cancel', { agent, cwd })
        return
      }
      S._agentOkCwd = cwd
    }
  }

  const selection = editorGetSel()
  const active = S.active || '(no file open)'
  const lang = userLanguage()
  const mode = S.cfg.agentMode || 'patch'   // suggest | patch | direct (whitepaper §11.2)
  // Context compiler (v0.3): prepend the workspace's .eveglyph/ operating manual
  // (rules + glossary + memory) so the agent inherits the human's standing constraints.
  const { preamble } = await compileContext(userTask, mode)
  const taskBlock =
`Active file: ${active}
Current selection:
${selection || '(none)'}

Task:
${userTask}`
  const langRule =
`Reply to the user in the same language as the Task above; if that is unclear, reply in ${lang}. This language rule applies ONLY to your chat reply — do NOT translate or change the language of the document's own content unless the task explicitly asks for it.`
  const permClause = {
    cautious: 'Permission: CAUTIOUS — edit existing files with minimal, surgical changes only; do NOT create or delete files. If the task needs more, stop and explain.',
    standard: 'Permission: STANDARD — you may edit and create files in the workspace; do not delete files (rename with a .archived suffix if removal is needed).',
    trusted:  'Permission: TRUSTED — you may edit, create, and remove files freely within the workspace.'
  }[perm] || ''
  const prompt = preamble + (mode === 'suggest'
? `You are a review/analysis assistant for a Markdown workspace.
Do NOT edit, create, or delete any files. Respond with your analysis, review, or concrete suggestions as plain text only.

${taskBlock}

${langRule}`
: `You are an autonomous file-editing agent working inside a Markdown workspace.
${taskBlock}

${permClause}
Make any changes by editing the files in the working directory directly.
Edit files only — do NOT run git, commit, or push; EveGlyph Editor handles version control and diff review.
${langRule}`)

  // The agent works quietly: we do NOT stream its raw chatter into the panel
  // (noisy, and can carry CLI/encoding garble). Results show via the file
  // refresh; raw output still goes to the monitor for debugging. (User ask:
  // out of sight, out of mind.) Proper diff-first review comes later (PatchMD).
  resp.className = ''
  resp.innerHTML = '<span class="spinner"></span> Wish granted — working…'
  S.lastResp = null
  S.agentRunning = true
  S.agentAbort = new AbortController()
  if (stopBtn) stopBtn.disabled = false

  let collected = ''
  let buf = ''
  let exitCode = 0
  let sawError = false
  let reviewable = false
  const startedAt = Date.now()
  const maxRuntimeMs = S.cfg.agentTimeoutMs ?? CONFIG.agentTimeoutMs
  let runtimeTimer = null
  try {
    runtimeTimer = setTimeout(() => {
      if (S.agentAbort) S.agentAbort.abort()
      stopAgent('timeout')
    }, maxRuntimeMs)
    // Snapshot the workspace first (git) so the agent's edits become a reviewable
    // diff — even in Suggest mode, so we can detect (and revert) any edits the agent
    // makes despite being told not to.
    try {
      const snap = await fetch('/api/git/snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, label: userTask })
      }).then(r => r.json())
      reviewable = Boolean(snap?.ok && snap?.available)
    } catch { reviewable = false }
    await monitor('agent:run:request', { agent, cwd, hasOverride: Boolean(command), resolved: Boolean(resolvedCommand), reviewable })
    const r = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: S.agentAbort.signal,
      body: JSON.stringify({
        agent,
        prompt,
        cwd,
        command: resolvedCommand || undefined,
        timeoutMs: maxRuntimeMs
      })
    })
    if (!r.ok || !r.body) throw new Error(`bridge HTTP ${r.status}`)

    const reader = r.body.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        handleMsg(msg)
      }
    }

    S.lastResp = collected
    if (sawError || exitCode) {
      resp.className = 'err'
      resp.textContent = `✗ Agent finished with errors (exit ${exitCode || '?'}). Check the result, or the monitor log.`
      showDiffActions(false)
    } else if (mode === 'suggest') {
      // Suggest: the agent should only advise. But the CLI *can* edit files; if it
      // did so despite the instruction, don't lie — refresh, show the changes, revert.
      let review = null
      if (reviewable) {
        try { review = await fetch(`/api/git/diff?${new URLSearchParams({ cwd })}`).then(r => r.json()) } catch {}
      }
      if (review?.available && review.hasChanges) {
        await refreshFromDisk()
        resp.className = ''
        resp.innerHTML = `<div class="diff-head">⚠ Suggest mode — but the agent edited files anyway. Revert if unwanted.</div>` + renderDiff(review.diff, 'direct')
        S._pendingReview = { cwd, message: userTask }
        showDiffActions(true, 'direct')
      } else {
        resp.className = ''
        resp.textContent = collected.trim() || '✓ Done — the agent returned no text.'
        showDiffActions(false)
      }
    } else {
      resp.innerHTML = '<span class="spinner"></span> Refreshing files…'
      await refreshFromDisk()
      if (reviewable) {
        let review = null
        try { review = await fetch(`/api/git/diff?${new URLSearchParams({ cwd })}`).then(r => r.json()) } catch {}
        if (review?.available && review.hasChanges) {
          resp.className = ''
          resp.innerHTML = renderDiff(review.diff, mode)
          S._pendingReview = { cwd, message: userTask }
          showDiffActions(true, mode)
        } else {
          resp.className = ''
          resp.textContent = '✓ Done — the agent made no file changes.'
          showDiffActions(false)
        }
      } else {
        resp.className = ''
        resp.textContent = '✓ Done. Files refreshed. (git unavailable → no diff review)'
        showDiffActions(false)
      }
    }
    if (!S.cfg.agentQuiet && mode !== 'suggest' && collected.trim()) {
      const det = document.createElement('details')
      det.className = 'agent-raw'
      const sum = document.createElement('summary'); sum.textContent = 'Raw agent output'
      const pre = document.createElement('pre'); pre.textContent = collected
      det.append(sum, pre)
      resp.appendChild(det)
    }
    await monitor('agent:run:success', { agent, cwd, mode, perm, bytes: collected.length, exitCode, reviewable, runtimeMs: Date.now() - startedAt })
  } catch (e) {
    resp.className = 'err'
    const stopped = e.name === 'AbortError'
    resp.textContent = stopped
      ? '■ Stopped.'
      : `✗ Error: ${e.message}. Local-agent mode only works while the dev server is running.`
    showDiffActions(false)   // a failed/stopped run must not leave stale, actionable diff buttons
    await monitor(stopped ? 'agent:run:stopped' : 'agent:run:error', { agent, cwd, error: String(e?.message || e), runtimeMs: Date.now() - startedAt })
  } finally {
    if (runtimeTimer) clearTimeout(runtimeTimer)
    S.agentRunning = false
    S.agentAbort = null
    if (stopBtn) stopBtn.disabled = true
  }

  // Raw agent output is collected (for the monitor / lastResp) but NOT displayed.
  function handleMsg(msg) {
    switch (msg.type) {
      case 'stdout':
      case 'stderr':
        collected += msg.data
        break
      case 'error':
        sawError = true
        break
      case 'done':
        exitCode = msg.code || 0
        break
    }
  }
}

export async function stopAgent(reason = 'user') {
  if (S.agentAbort) S.agentAbort.abort()
  try {
    await fetch('/api/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
  } catch (_) {}
}

// ─── DIFF REVIEW (PatchMD MVP) ────────────────────────────────────
function showDiffActions(show, mode = 'patch') {
  const row = document.getElementById('diff-actions')
  const accept = document.getElementById('btn-diff-accept')
  const reject = document.getElementById('btn-diff-reject')
  if (row) row.style.display = show ? 'flex' : 'none'
  // Direct mode keeps the changes by default → no Accept gate, only a Revert.
  if (accept) accept.style.display = (show && mode !== 'direct') ? '' : 'none'
  if (reject) reject.textContent = mode === 'direct' ? '↩ Revert' : '✗ Reject'
}

function renderDiff(diff, mode = 'patch') {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const body = (diff || '').split('\n').map(l => {
    let cls = 'd-ctx'
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')) cls = 'd-hdr'
    else if (l.startsWith('@@')) cls = 'd-hunk'
    else if (l.startsWith('+')) cls = 'd-add'
    else if (l.startsWith('-')) cls = 'd-del'
    return `<span class="${cls}">${esc(l) || ' '}</span>`
  }).join('\n')
  const head = mode === 'direct'
    ? "The agent's changes are applied — Revert to undo, or just keep them."
    : "Review the agent's changes — Accept to keep (commit), Reject to discard."
  return `<div class="diff-head">${head}</div><pre class="diff">${body}</pre>`
}

export async function acceptReview() {
  const r = S._pendingReview
  const resp = document.getElementById('ai-resp')
  if (!r) return
  try {
    await fetch('/api/git/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: r.cwd, message: r.message })
    })
    resp.className = ''
    resp.textContent = '✓ Accepted — committed.'
    await monitor('git:ui:accept', { cwd: r.cwd })
  } catch (e) { resp.className = 'err'; resp.textContent = `✗ Accept failed: ${e.message}` }
  S._pendingReview = null
  showDiffActions(false)
}

export async function rejectReview() {
  const r = S._pendingReview
  const resp = document.getElementById('ai-resp')
  if (!r) return
  try {
    await fetch('/api/git/reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: r.cwd })
    })
    await refreshFromDisk()
    resp.className = ''
    resp.textContent = '↩ Reverted — the agent\'s changes were discarded.'
    await monitor('git:ui:reject', { cwd: r.cwd })
  } catch (e) { resp.className = 'err'; resp.textContent = `✗ Reject failed: ${e.message}` }
  S._pendingReview = null
  showDiffActions(false)
}
