import { S } from './state.js'
import { CONFIG } from './config.js'
import { editorGetSel, editorGet } from './editor.js'
import { runAgent } from './agent.js'
import { monitor } from './monitor.js'

// Presets aligned with whitepaper Appendix B. Two kinds:
//   text      — transforms the current selection / document (works for any provider)
//   workspace — a workspace-level agent task (filesystem/git); local-agent only
export const PRESETS = {
  clean: {
    label: '🧹 Clean AI residue', kind: 'text',
    build: (text) => `You are cleaning a Markdown document. Remove conversational AI residue only:
- Role markers ("Theia:", "Neo.K:", "BOSS:", "Claude:", "Assistant:" …).
- Meta-commentary ("As an AI…", "BOSS mode", "Sure, here's…").
- Chat back-and-forth not intended as document content.
Be conservative — PRESERVE all real content AND the author's voice: sarcasm, rhetorical questions, wry asides and informal tone are content, not residue. Do not flatten the style.
Return ONLY the cleaned Markdown, no explanation.

---
${text}
---`
  },
  expand: {
    label: '↗ Academic expand', kind: 'text',
    build: (text) => `Expand the following academic text. Preserve the precise language, logical structure, and the author's voice. Add supporting detail, clarify implied steps, develop underdeveloped points — do not pad. Return only the expanded text:

${text}`
  },
  voice: {
    label: '🎙 Preserve-voice rewrite', kind: 'text',
    build: (text) => `Lightly correct the text below: fix ONLY grammar, typos, and genuine clarity problems. Do NOT change the author's voice, tone, sarcasm, rhetorical style, register, or word choice beyond what an error requires. When in doubt, leave it. Return only the corrected text:

${text}`
  },
  katex: {
    label: '∑ Fix KaTeX', kind: 'text',
    build: (text) => `Fix LaTeX/KaTeX syntax only. Ensure inline math uses $...$ and display math uses $$...$$; repair broken or missing delimiters. Do not change prose or the meaning of the math. Return only the corrected text:

${text}`
  },
  headings: {
    label: '⌗ Normalize headings', kind: 'text',
    build: (text) => `Normalize the Markdown heading hierarchy below: consistent #/##/### levels, no skipped levels, a single top-level H1. Do NOT change any heading text or body content. Return only the corrected Markdown:

${text}`
  },
  whitepaper: {
    label: '📄 Extract whitepaper draft', kind: 'text',
    build: (text) => `From the notes/conversation below, extract and organize a structured whitepaper draft: clear sections with headings, coherent prose, logical flow. Preserve the author's ideas, terminology, and voice — do not invent claims. Return only the draft Markdown:

${text}`
  },
  eveglyph: {
    label: '🔧 Fix structure + EveGlyph-MD', kind: 'text',
    build: (text) => `This Markdown was converted from DOCX, so its structure may be off. Fix: heading hierarchy, list formatting, broken emphasis/links, and stray conversion artifacts. Where the document is a clear unit, you MAY add minimal EveGlyph-MD frontmatter (type/status/tags). Preserve the author's content, terminology, and voice — do not rewrite prose. Return only the corrected Markdown:

${text}`
  },
  changelog: {
    label: '📝 Generate changelog', kind: 'workspace',
    build: () => `Look at the recent changes in this workspace (use git history / diff if available). Write a concise CHANGELOG entry summarizing what changed, grouped logically (Added / Changed / Fixed). Prepend the new entry to CHANGELOG.md in the workspace root (create the file if it does not exist). Edit only CHANGELOG.md.`
  },
  audit: {
    label: '🔍 Workspace audit', kind: 'workspace',
    build: () => `Scan the Markdown/text files in this workspace and produce an audit: list duplicate, outdated, conflicting, or cleanup-worthy files, each with a one-line reason. Write the report to workspace-audit.md in the workspace root. Edit only workspace-audit.md — do not modify any other file.`
  }
}

// Build the Quick-actions list from PRESETS (single source of truth — no label drift),
// grouped by kind, each button wired to aiPreset.
export function renderPresets() {
  const list = document.getElementById('preset-list')
  if (!list) return
  list.innerHTML = ''
  let lastKind = null
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.kind !== lastKind) {
      const sep = document.createElement('div')
      sep.className = 'preset-sep'
      sep.textContent = p.kind === 'workspace' ? 'Workspace · local agent' : 'On selection / document'
      list.appendChild(sep)
      lastKind = p.kind
    }
    const b = document.createElement('button')
    b.className = 'pbtn' + (p.kind === 'workspace' ? ' pbtn-ws' : '')
    b.dataset.p = key
    b.textContent = p.label
    b.onclick = () => { monitor('click', { target: 'preset', preset: key }); aiPreset(key) }
    list.appendChild(b)
  }
}

export async function aiSend() {
  const input = document.getElementById('ai-input').value.trim()
  await monitor('ai:send', {
    provider: S.cfg.provider,
    active: S.active || null,
    hasInput: Boolean(input)
  })

  if (S.cfg.provider === 'local-agent') {
    if (!input) {
      await monitor('ai:block', { reason: 'empty local-agent task' })
      alert('Type a task for the agent.')
      return
    }
    return runAgent(input)
  }

  const sel = editorGetSel()
  const doc = editorGet()
  const ctx = sel || doc                 // a selection narrows the focus; otherwise the whole document
  if (!input && !ctx) {
    await monitor('ai:block', { reason: 'empty prompt' })
    return
  }

  // Cloud providers can't read files — inline the document (or selection) so the AI
  // can actually see the Markdown it's being asked about. (Local agents read the file
  // from disk themselves, so this only matters for the Anthropic/OpenAI path.)
  let prompt
  if (input) {
    const label = sel ? 'Selected text' : (S.active ? `Document: ${S.active}` : 'Document')
    prompt = ctx ? `${input}\n\n--- ${label} ---\n${ctx}` : input
  } else {
    prompt = `Review and improve the following Markdown text:\n\n${ctx}`
  }

  await monitor('ai:context', { scope: sel ? 'selection' : (doc ? 'document' : 'none'), ctxChars: ctx.length })
  await aiCall(prompt)
}

export async function aiPreset(key) {
  const p = PRESETS[key]
  if (!p) return

  // Workspace tasks (changelog, audit) need filesystem/git → local agent only.
  if (p.kind === 'workspace') {
    if (S.cfg.provider !== 'local-agent') {
      await monitor('ai:block', { reason: 'workspace preset needs local agent', preset: key })
      alert('This action scans/edits the whole workspace — set Provider to "Local Agent (CLI)" first.')
      return
    }
    await monitor('ai:preset', { provider: S.cfg.provider, preset: key, kind: 'workspace' })
    return runAgent(p.build())
  }

  const sel = editorGetSel()
  const txt = sel || editorGet()
  await monitor('ai:preset', { provider: S.cfg.provider, preset: key, kind: 'text', active: S.active || null, hasText: Boolean(txt.trim()) })

  if (!txt.trim()) {
    await monitor('ai:block', { reason: 'empty preset text', preset: key })
    alert('No text selected or document is empty.')
    return
  }

  if (S.cfg.provider === 'local-agent') return runAgent(p.build(txt))
  await aiCall(p.build(txt))
}

// The actual provider call, decoupled from the AI-panel DOM — aiCall() below wraps
// this for the panel; anything else that just needs "ask the configured cloud
// provider a question, get text back" (e.g. AI semantic search) calls this directly
// instead of duplicating the Anthropic/OpenAI branches.
export async function callAiProvider(prompt) {
  const { provider, url, key, model } = S.cfg
  await monitor('ai:call:start', { provider, model, promptBytes: prompt.length })

  if (provider === 'anthropic') {
    const r = await fetch(CONFIG.anthropicUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': CONFIG.anthropicVersion,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model || CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error?.message || `HTTP ${r.status}`)
    }
    const d = await r.json()
    // A safety decline returns HTTP 200 with an empty content array — surface it
    // instead of silently showing a blank response.
    const text = d.stop_reason === 'refusal'
      ? `[Request declined by the model's safety system${d.stop_details?.category ? ` — ${d.stop_details.category}` : ''}.]`
      : (d.content?.[0]?.text ?? '')
    await monitor('ai:call:success', { provider, bytes: text.length })
    return text
  }

  const base = url.replace(/\/$/, '') || CONFIG.openaiUrlFallback
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key || 'no-key'}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.error?.message || `HTTP ${r.status}`)   // surface the provider's message, not just the code
  }
  const d = await r.json()
  const text = d.choices?.[0]?.message?.content ?? ''
  await monitor('ai:call:success', { provider, bytes: text.length })
  return text
}

export async function aiCall(prompt) {
  const wrap = document.getElementById('ai-resp-wrap')
  const resp = document.getElementById('ai-resp')
  wrap.style.display = 'flex'
  resp.className = 'loading'
  resp.innerHTML = '<span class="spinner"></span> Calling AI...'
  S.lastResp = null

  try {
    const text = await callAiProvider(prompt)
    S.lastResp = text
    resp.textContent = text
    resp.className = ''
  } catch (e) {
    resp.textContent = `Error: ${e.message}\n\nCheck Settings, API key, and provider.`
    resp.className = 'err'
    await monitor('ai:call:error', { provider: S.cfg.provider, error: String(e?.message || e) })
  }
}
