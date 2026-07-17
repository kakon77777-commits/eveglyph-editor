import { S } from './state.js'
import { CONFIG } from './config.js'
import { editorGetSel } from './editor.js'
import { compileContext } from './context.js'
import { refreshFromDisk } from './files.js'
import { statusUpdate } from './status.js'
import { monitor } from './monitor.js'
import { renderDiffHTML } from './diffview.js'
import { t, tPlural } from './i18n/index.js'

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
    resp.textContent = t('agent.missingWorkspace')
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
    resp.textContent = t('agent.bridgeOffline')
    return
  }

  if (!selected?.runnable && !command) {
    S.agentConnected = false
    statusUpdate()
    await monitor('agent:run:block', { reason: 'agent not runnable', agent, cwd, error: selected?.error || '' })
    resp.className = 'err'
    resp.textContent = selected?.path
      ? t('agent.agentBlockedFound', { agent, error: selected.error || 'unknown error' })
      : t('agent.agentBlockedNotFound', { agent })
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
      const ok = confirm(t('agent.confirmRun', { agent, cwd }))
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
  // Live activity view: a transient "agent working…" panel that ticks elapsed time
  // and streams the agent's output tail while it runs, then is replaced by the diff on
  // completion. Respects agentQuiet: quiet → meter only; loud → output tail.
  let actLines = []
  let actCount = 0
  const ACT_TAIL = 14
  const actEsc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const renderActivity = () => {
    if (!S.agentRunning) return
    const secs = Math.round((Date.now() - startedAt) / 1000)
    const lineWord = tPlural('agent.lineCount', 'agent.lineCountPlural', actCount)
    const head = `<div class="agent-act-h"><span class="agent-act-dot"></span><span>${t('agent.activityWorking')} <b>${secs}s</b> · ${actCount} ${lineWord}</span></div>`
    const body = (!S.cfg.agentQuiet && actLines.length)
      ? `<pre class="agent-act-log">${actLines.map(actEsc).join('\n')}</pre>` : ''
    resp.className = ''
    resp.innerHTML = head + body
  }
  renderActivity()
  const actTimer = setInterval(renderActivity, 600)
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
        command: command || undefined,   // user override only; else the bridge resolves exe + permission-tier flags
        permission: perm,                 // cautious | standard | trusted → REAL CLI enforcement (bridge AGENTS.flags)
        timeoutMs: maxRuntimeMs
      })
    })
    if (!r.ok || !r.body) {
      // Surface the bridge's actual message (e.g. "command override requires
      // Trusted permission") instead of a bare status code — this is an early,
      // synchronous rejection (bad request), not a stream that's already started.
      const detail = await r.text().catch(() => '')
      throw new Error(detail || `bridge HTTP ${r.status}`)
    }

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
    clearInterval(actTimer)   // stop the live activity view before rendering the result

    S.lastResp = collected
    if (sawError || exitCode) {
      resp.className = 'err'
      resp.textContent = t('agent.finishedWithErrors', { code: exitCode || '?' })
      showDiffActions(false)
    } else if (mode === 'suggest') {
      // Suggest: the agent should only advise. But the CLI *can* edit files; if it
      // did so despite the instruction, don't lie — refresh, show the changes, revert.
      // A FAILED diff read must surface as a warning, never as a false "no changes".
      const review = reviewable ? await fetchAgentDiff(cwd) : { state: 'unavailable' }
      if (review.state === 'changes') {
        await refreshFromDisk()
        resp.className = ''
        resp.innerHTML = `<div class="diff-head">${t('agent.suggestButEdited')}</div>` + renderDiff(review.diff, 'direct')
        // Treated the same as Direct mode (no manual Accept gate — see below), so
        // it needs the same auto-commit to avoid the same misattribution bug.
        await commitDirectChanges(cwd, userTask)
        S._pendingReview = { cwd, message: userTask, committed: true }
        showDiffActions(true, 'direct')
      } else if (review.state === 'error') {
        resp.className = 'warn'
        resp.textContent = (collected.trim() ? collected.trim() + '\n\n' : '') +
          t('agent.suggestDiffReadFailed')
        showDiffActions(false)
      } else {
        resp.className = ''
        resp.textContent = collected.trim() || t('agent.suggestNoText')
        showDiffActions(false)
      }
    } else {
      resp.innerHTML = `<span class="spinner"></span> ${t('agent.refreshingFiles')}`
      await refreshFromDisk()
      if (!reviewable) {
        resp.className = ''
        resp.textContent = t('agent.doneNoGit')
        showDiffActions(false)
      } else {
        const review = await fetchAgentDiff(cwd)
        if (review.state === 'changes') {
          resp.className = ''
          resp.innerHTML = renderDiff(review.diff, mode)
          if (mode === 'direct') await commitDirectChanges(cwd, userTask)
          S._pendingReview = { cwd, message: userTask, committed: mode === 'direct' }
          showDiffActions(true, mode)
        } else if (review.state === 'error') {
          // Diff READ failed — the agent may well have changed files. Warn instead of
          // the old silent "no file changes" false negative (PatchMD honesty).
          resp.className = 'warn'
          resp.textContent = t('agent.diffReadFailed')
          showDiffActions(false)
        } else {
          resp.className = ''
          resp.textContent = t('agent.doneNoChanges')
          showDiffActions(false)
        }
      }
    }
    if (!S.cfg.agentQuiet && mode !== 'suggest' && collected.trim()) {
      const det = document.createElement('details')
      det.className = 'agent-raw'
      const sum = document.createElement('summary'); sum.textContent = t('agent.rawOutputSummary')
      const pre = document.createElement('pre'); pre.textContent = collected
      det.append(sum, pre)
      resp.appendChild(det)
    }
    await monitor('agent:run:success', { agent, cwd, mode, perm, bytes: collected.length, exitCode, reviewable, runtimeMs: Date.now() - startedAt })
  } catch (e) {
    resp.className = 'err'
    const stopped = e.name === 'AbortError'
    resp.textContent = stopped
      ? t('agent.stopped')
      : t('agent.errorGeneric', { message: e.message })
    showDiffActions(false)   // a failed/stopped run must not leave stale, actionable diff buttons
    await monitor(stopped ? 'agent:run:stopped' : 'agent:run:error', { agent, cwd, error: String(e?.message || e), runtimeMs: Date.now() - startedAt })
  } finally {
    if (runtimeTimer) clearTimeout(runtimeTimer)
    clearInterval(actTimer)
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
        for (const ln of String(msg.data).split('\n')) {
          if (!ln.trim()) continue
          actLines.push(ln.length > 200 ? ln.slice(0, 200) + '…' : ln)
          actCount++
        }
        if (actLines.length > ACT_TAIL) actLines = actLines.slice(-ACT_TAIL)
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
  if (reject) reject.textContent = mode === 'direct' ? t('agent.revert') : t('agent.reject')
}

function renderDiff(diff, mode = 'patch') {
  const head = mode === 'direct'
    ? t('agent.diffHeadDirect')
    : t('agent.diffHeadPatch')
  return `<div class="diff-head">${head}</div>${renderDiffHTML(diff)}`
}

// Fetch the post-run diff and classify the outcome so a FAILED read is never reported
// as "no changes" (the old silent catch → false negative). States:
//   changes     — staged edits vs the pre-agent baseline (review them)
//   clean       — git readable, genuinely nothing changed
//   unavailable — not a git repo / git off → no diff review possible
//   error       — the diff request itself failed → warn, do NOT claim "no changes"
async function fetchAgentDiff(cwd) {
  let r
  try { r = await fetch(`/api/git/diff?${new URLSearchParams({ cwd })}`) }
  catch (e) { return { state: 'error', error: String(e?.message || e) } }
  if (!r.ok) return { state: 'error', error: `diff HTTP ${r.status}` }
  let review
  try { review = await r.json() } catch { return { state: 'error', error: 'diff parse failed' } }
  if (!review || review.available === false) return { state: 'unavailable' }
  if (review.hasChanges) return { state: 'changes', diff: review.diff }
  return { state: 'clean' }
}

// Direct mode (and the "suggest but the agent edited anyway" fallback) has no
// manual Accept gate — showDiffActions() hides that button for them, so without
// this, the changes would just sit uncommitted until the *next* run's pre-agent
// snapshot silently swept them in under an anonymous "pre-agent: ..." message,
// misattributing this run's actual edit as if it were pre-existing baseline state.
// Committing immediately here, under the task's own message, fixes that — Revert
// (rejectReview, `committed: true`) then resets past this commit (HEAD~1), not just
// HEAD, to still land back at the real pre-agent snapshot.
async function commitDirectChanges(cwd, message) {
  try {
    await fetch('/api/git/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, message })
    })
    await monitor('git:direct:auto-commit', { cwd })
  } catch (e) {
    await monitor('git:direct:auto-commit:error', { cwd, error: String(e?.message || e) })
  }
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
    resp.textContent = t('agent.accepted')
    await monitor('git:ui:accept', { cwd: r.cwd })
  } catch (e) { resp.className = 'err'; resp.textContent = t('agent.acceptFailed', { message: e.message }) }
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
      body: JSON.stringify({ cwd: r.cwd, committed: Boolean(r.committed) })
    })
    await refreshFromDisk()
    resp.className = ''
    resp.textContent = t('agent.reverted')
    await monitor('git:ui:reject', { cwd: r.cwd })
  } catch (e) { resp.className = 'err'; resp.textContent = t('agent.rejectFailed', { message: e.message }) }
  S._pendingReview = null
  showDiffActions(false)
}
