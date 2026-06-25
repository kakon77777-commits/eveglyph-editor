import { S, CFG_KEY }   from './state.js'
import { CONFIG }       from './config.js'
import { monitor }      from './monitor.js'
import { statusUpdate } from './status.js'
import { aiCall }       from './ai.js'
import { detectAgents } from './agent.js'
import { loadWorkspacePath } from './files.js'
import { ENCODINGS }    from './encodingmenu.js'

const $ = (id) => document.getElementById(id)

export function setMsg(text, className = '') {
  const msg = $('settings-msg')
  msg.textContent = text
  msg.className = className
}

// Show/hide field groups based on the selected provider.
export function toggleProviderFields(provider) {
  const setDisp = (id, on, mode = 'flex') => {
    const el = $(id)
    if (el) el.style.display = on ? mode : 'none'
  }

  setDisp('s-url-wrap', provider === 'openai')
  setDisp('s-key-wrap', provider !== 'local-agent')
  setDisp('s-model-wrap', provider !== 'local-agent')
  setDisp('s-agent-wrap', provider === 'local-agent')
  setDisp('agent-connect-row', provider === 'local-agent')
}

// Ask the bridge which agents exist and fill the dropdown.
export async function populateAgents() {
  const sel = $('s-agent')
  const hint = $('s-agent-hint')
  if (!sel) return null

  sel.innerHTML = ''
  const info = await detectAgents(true)   // explicit detect → bypass server cache
  S.agentBridge = info

  if (!info) {
    const o = document.createElement('option')
    o.textContent = 'bridge offline - launch start-eveglyph.bat'
    o.disabled = true
    sel.appendChild(o)
    if (hint) hint.textContent = ''
    S.agentConnected = false
    statusUpdate()
    return null
  }

  for (const [id, agent] of Object.entries(info.agents)) {
    const o = document.createElement('option')
    o.value = id
    o.textContent = agent.runnable
      ? `${agent.label} - ready`
      : agent.path
        ? `${agent.label} - found but blocked`
        : `${agent.label} - not on PATH`
    sel.appendChild(o)
  }

  if (S.cfg.agent && Array.from(sel.options).some(o => o.value === S.cfg.agent)) {
    sel.value = S.cfg.agent
  }

  const workspace = $('s-workspace')
  if (workspace && !workspace.value.trim()) workspace.value = info.cwd
  if (hint) hint.textContent = `bridge cwd: ${info.cwd}`
  statusUpdate()
  return info
}

// Seed the model picker so it's useful even before (or without) an API fetch.
const MODEL_PRESETS = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
}

// Fill the Model datalist so the user PICKS a valid model id instead of typing one —
// a wrong id is what produced "model: Sonnet 4.6" (a 404). When a key is present we
// fetch the provider's /v1/models; otherwise (and on failure) we seed known defaults.
// The current saved model is always kept as an option so it round-trips.
export async function populateModels(explicit = false) {
  const dl = $('s-model-list'), hint = $('s-model-hint')
  if (!dl) return
  const provider = $('s-provider').value
  const key = $('s-key').value.trim()
  const seed = (MODEL_PRESETS[provider] || []).map(id => ({ id, label: id }))

  const render = (items, note) => {
    const cur = S.cfg.model ? [{ id: S.cfg.model, label: S.cfg.model }] : []
    const seen = new Set(), opts = []
    for (const it of [...items, ...seed, ...cur]) {
      if (!it.id || seen.has(it.id)) continue
      seen.add(it.id)
      const o = document.createElement('option')
      o.value = it.id
      if (it.label && it.label !== it.id) o.textContent = it.label   // datalist shows id + display name
      opts.push(o)
    }
    dl.replaceChildren(...opts)
    if (hint) hint.textContent = note || ''
  }

  if (provider === 'local-agent') { dl.replaceChildren(); if (hint) hint.textContent = ''; return }
  if (!key) { render([], 'Enter your API key, then ↻ to load the model list.'); return }
  if (explicit && hint) hint.textContent = 'Loading models…'

  try {
    let items = []
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: {
          'x-api-key': key,
          'anthropic-version': CONFIG.anthropicVersion,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`) }
      const d = await r.json()
      items = (d.data || []).map(m => ({ id: m.id, label: m.display_name || m.id }))
    } else {
      const base = ($('s-url').value.trim() || CONFIG.openaiUrlFallback).replace(/\/$/, '')
      const r = await fetch(`${base}/v1/models`, { headers: { 'Authorization': `Bearer ${key}` } })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`) }
      const d = await r.json()
      items = (d.data || []).map(m => ({ id: m.id, label: m.id }))
    }
    render(items, items.length
      ? `${items.length} models — click the Model field to pick one.`
      : 'No models returned — type an id or check the endpoint.')
    monitor('models:fetch', { provider, count: items.length })
  } catch (e) {
    render([], `Couldn't load models (${e.message}). Showing defaults — pick one or type an id.`)
    monitor('models:fetch:error', { provider, error: String(e?.message || e) })
  }
}

export function cfgLoad() {
  try {
    // One-time migration from the legacy Noesis key → eveglyph_cfg (lossless).
    if (localStorage.getItem(CFG_KEY) === null) {
      const legacy = localStorage.getItem('noesis_cfg')
      if (legacy !== null) {
        localStorage.setItem(CFG_KEY, legacy)
        localStorage.removeItem('noesis_cfg')
      }
    }
    const saved = localStorage.getItem(CFG_KEY)
    if (saved) Object.assign(S.cfg, JSON.parse(saved))
  } catch (_) {}

  $('s-provider').value = S.cfg.provider
  $('s-url').value = S.cfg.url
  $('s-key').value = S.cfg.key
  $('s-model').value = S.cfg.model
  $('s-workspace').value = S.cfg.workspace || ''
  $('s-agentcmd').value = S.cfg.agentCmd || ''

  const encSel = $('s-default-encoding')
  if (encSel) {
    if (!encSel.options.length) {
      for (const e of ENCODINGS) {
        const o = document.createElement('option')
        o.value = e; o.textContent = e
        encSel.appendChild(o)
      }
    }
    encSel.value = S.cfg.defaultEncoding || 'UTF-8'
  }

  const modeSel = $('ai-mode')
  if (modeSel) modeSel.value = S.cfg.agentMode || 'patch'

  const themeSel = $('s-theme')
  if (themeSel) themeSel.value = S.cfg.theme || 'dark'

  const fsEl = $('s-font-size')
  if (fsEl) fsEl.value = S.cfg.editorFontSize ?? 13.5

  const ffEl = $('s-font-family')
  if (ffEl) ffEl.value = S.cfg.editorFontFamily || ''
  const permEl = $('s-agent-permission')
  if (permEl) permEl.value = S.cfg.agentPermission || 'standard'
  const toEl = $('s-agent-timeout')
  if (toEl) toEl.value = Math.round((S.cfg.agentTimeoutMs ?? 180000) / 1000)
  const quietEl = $('s-agent-quiet')
  if (quietEl) quietEl.checked = S.cfg.agentQuiet === false

  const memChk = $('s-memory-enabled')
  if (memChk) memChk.checked = S.cfg.memory?.enabled !== false
  for (const k of ['rules', 'glossary', 'pitfalls', 'recent']) {
    const el = $('s-mem-' + k)
    if (el) el.checked = S.cfg.memory?.[k] !== false
  }

  // EveGlyph-MD frontmatter schema. Enum option lists come from the config contract;
  // the checkboxes/defaults reflect the persisted user overrides.
  const nm = S.cfg.eveglyphMd || {}
  const fillSel = (id, list, val) => {
    const sel = $(id)
    if (!sel) return
    if (!sel.options.length) for (const v of list) {
      const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o)
    }
    sel.value = val
  }
  fillSel('s-eveglyph-type', CONFIG.eveglyphMd.types, nm.defaultType || CONFIG.eveglyphMd.defaultType)
  fillSel('s-eveglyph-status', CONFIG.eveglyphMd.statuses, nm.defaultStatus || CONFIG.eveglyphMd.defaultStatus)
  const nEn = $('s-eveglyph-enabled'); if (nEn) nEn.checked = nm.enabled !== false
  const nSt = $('s-eveglyph-stamp');   if (nSt) nSt.checked = nm.stampNewFiles !== false
  const nIn = $('s-eveglyph-inject');  if (nIn) nIn.checked = nm.injectIntoContext !== false

  toggleProviderFields(S.cfg.provider)
  populateModels()   // seed the model picker (and auto-fetch if a key is already saved)
  if (S.cfg.provider === 'local-agent') {
    populateAgents().then(() => {
      if (S.cfg.workspace) loadWorkspacePath(S.cfg.workspace)
      const selected = S.agentBridge?.agents?.[S.cfg.agent]
      S.agentConnected = Boolean(S.cfg.workspace && (selected?.runnable || S.cfg.agentCmd))
      statusUpdate()
    })
  }
}

export function cfgSave(showMessage = true) {
  S.cfg = {
    provider: $('s-provider').value,
    url: $('s-url').value.trim(),
    key: $('s-key').value.trim(),
    model: $('s-model').value.trim(),
    agent: $('s-agent').value || S.cfg.agent || 'claude',
    workspace: $('s-workspace').value.trim(),
    agentCmd: $('s-agentcmd').value.trim(),
    defaultEncoding: $('s-default-encoding')?.value || S.cfg.defaultEncoding || 'UTF-8',
    agentMode: S.cfg.agentMode || 'patch',  // set via the AI-panel selector, not a Settings field — preserve it
    theme: $('s-theme')?.value || S.cfg.theme || 'dark',
    editorFontSize: parseFloat($('s-font-size')?.value) || S.cfg.editorFontSize || 13.5,
    editorFontFamily: ($('s-font-family')?.value.trim()) || S.cfg.editorFontFamily || undefined,
    agentPermission: $('s-agent-permission')?.value || S.cfg.agentPermission || 'standard',
    agentTimeoutMs: ($('s-agent-timeout')?.value ? parseInt($('s-agent-timeout').value, 10) * 1000 : 0) || S.cfg.agentTimeoutMs || 180000,
    agentQuiet: $('s-agent-quiet') ? !$('s-agent-quiet').checked : (S.cfg.agentQuiet !== false),
    memory: {
      enabled:  $('s-memory-enabled') ? $('s-memory-enabled').checked : (S.cfg.memory?.enabled  !== false),
      rules:    $('s-mem-rules')      ? $('s-mem-rules').checked      : (S.cfg.memory?.rules     !== false),
      glossary: $('s-mem-glossary')   ? $('s-mem-glossary').checked   : (S.cfg.memory?.glossary  !== false),
      pitfalls: $('s-mem-pitfalls')   ? $('s-mem-pitfalls').checked   : (S.cfg.memory?.pitfalls  !== false),
      recent:   $('s-mem-recent')     ? $('s-mem-recent').checked     : (S.cfg.memory?.recent    !== false),
    },
    contextPackWrite: S.cfg.contextPackWrite !== false,
    eveglyphMd: {
      enabled:           $('s-eveglyph-enabled') ? $('s-eveglyph-enabled').checked : (S.cfg.eveglyphMd?.enabled !== false),
      stampNewFiles:     $('s-eveglyph-stamp')   ? $('s-eveglyph-stamp').checked   : (S.cfg.eveglyphMd?.stampNewFiles !== false),
      injectIntoContext: $('s-eveglyph-inject')  ? $('s-eveglyph-inject').checked  : (S.cfg.eveglyphMd?.injectIntoContext !== false),
      defaultType:       $('s-eveglyph-type')?.value   || S.cfg.eveglyphMd?.defaultType   || CONFIG.eveglyphMd.defaultType,
      defaultStatus:     $('s-eveglyph-status')?.value || S.cfg.eveglyphMd?.defaultStatus || CONFIG.eveglyphMd.defaultStatus,
    }
  }

  localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg))
  if (showMessage) {
    setMsg('Saved', 'ok')
    setTimeout(() => setMsg(''), 1800)
  }
  statusUpdate()
}

export async function useBridgeCwd() {
  const info = S.agentBridge || await detectAgents()
  S.agentBridge = info

  if (!info?.cwd) {
    setMsg('Bridge offline - no app folder available', 'err')
    return
  }

  $('s-workspace').value = info.cwd
  S.cfg.workspace = info.cwd
  localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg))
  setMsg(`Workspace set to ${info.cwd}`, 'ok')
  await loadWorkspacePath(info.cwd)
}

export async function connectAgent() {
  cfgSave(false)

  if (S.cfg.provider !== 'local-agent') {
    S.agentConnected = false
    setMsg('Choose Local Agent (CLI) first', 'err')
    statusUpdate()
    return
  }

  if (!S.cfg.workspace) {
    await useBridgeCwd()
    cfgSave(false)
  }

  if (!S.cfg.workspace) {
    S.agentConnected = false
    setMsg('Set a workspace path first', 'err')
    statusUpdate()
    return
  }

  const loaded = await loadWorkspacePath(S.cfg.workspace)
  if (!loaded) {
    S.agentConnected = false
    setMsg(`Cannot load workspace: ${S.cfg.workspace}`, 'err')
    statusUpdate()
    return
  }

  const info = S.agentBridge || await detectAgents()
  S.agentBridge = info

  if (!info) {
    S.agentConnected = false
    setMsg('Bridge offline - run the dev server', 'err')
    statusUpdate()
    return
  }

  const selected = info.agents?.[S.cfg.agent]
  if (!selected?.runnable && !S.cfg.agentCmd) {
    S.agentConnected = false
    setMsg(selected?.path
      ? `Workspace loaded, but ${S.cfg.agent} cannot run: ${selected.error || 'unknown error'}. Add a command override or install a runnable CLI.`
      : `Workspace loaded, but ${S.cfg.agent} is not on PATH. Add a command override or install the CLI.`,
    'err')
    statusUpdate()
    return
  }

  S.agentConnected = true
  setMsg(`Connected ${S.cfg.agent} to ${S.cfg.workspace}`, 'ok')
  statusUpdate()
}

export function disconnectAgent() {
  S.agentConnected = false
  setMsg('Agent disconnected')
  statusUpdate()
}

export async function cfgTest() {
  cfgSave(false)
  const msg = $('settings-msg')
  msg.innerHTML = '<span class="spinner"></span> Testing...'
  msg.className = ''

  // Local agent: check the bridge and whether the selected agent resolves on PATH.
  if (S.cfg.provider === 'local-agent') {
    const info = await detectAgents(true)   // explicit test → bypass server cache
    S.agentBridge = info

    if (!info) {
      setMsg('Bridge offline - run start-eveglyph.bat', 'err')
      return
    }

    const agent = info.agents[S.cfg.agent]
    if (agent?.runnable) {
      setMsg(`${agent.label} ready: ${agent.path || agent.resolvedCmd}`, 'ok')
    } else if (agent?.path) {
      setMsg(`${agent.label} found but cannot run: ${agent.error || 'unknown error'}`, 'err')
    } else if (S.cfg.agentCmd) {
      setMsg(`Using override: ${S.cfg.agentCmd}`, 'ok')
    } else {
      setMsg(`${S.cfg.agent} not on PATH`, 'err')
    }
    return
  }

  try {
    await aiCall('Reply with only the word "ok".')
    setMsg('Connected', 'ok')
  } catch (_) {
    setMsg('Failed - check key and provider', 'err')
  }
}
