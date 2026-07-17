import { S, CFG_KEY } from './state.js'
import { fetchFunctionCatalog, previewRuntimeFunction } from './runtimepreview.js'
import { t } from './i18n/index.js'

const esc = (value) => String(value).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

let records = []

function saveRuntimeUrl(value) {
  S.cfg.compilableWorldRuntimeUrl = value.trim()
  try { localStorage.setItem(CFG_KEY, JSON.stringify(S.cfg)) } catch (_) {}
}

function setStatus(text, kind = '') {
  const node = document.getElementById('cw-runtime-status')
  if (!node) return
  node.textContent = text
  node.className = `cw-runtime-status ${kind}`
}

function renderInputs(record) {
  const body = document.getElementById('cw-function-inputs')
  if (!body) return
  body.innerHTML = Object.entries(record?.inputs || {}).map(([name, type]) => `
    <label class="cw-input-row">
      <span>${esc(name)} <small>${esc(type)}</small></span>
      <input type="number" step="any" data-cw-input="${esc(name)}" value="0">
    </label>
  `).join('') || `<span class="cw-dim">${t('runtimeDynamic.noInputs')}</span>`
}

function selectedRecord() {
  const id = document.getElementById('cw-function-select')?.value
  return records.find(item => item.function_id === id) || null
}

function renderCatalog(catalog) {
  records = Array.isArray(catalog?.functions) ? catalog.functions : []
  const select = document.getElementById('cw-function-select')
  if (!select) return
  select.innerHTML = records.map(record =>
    `<option value="${esc(record.function_id)}">${esc(record.function_id)} · ${esc(record.version || '')}</option>`
  ).join('')
  select.disabled = records.length === 0
  document.getElementById('cw-preview-function').disabled = records.length === 0
  renderInputs(records[0])
  setStatus(t('runtimeDynamic.recordsLoaded', { count: records.length }), 'ok')
}

export function initRuntimeView() {
  const panel = document.getElementById('t-runtime')
  if (!panel) return
  const urlInput = document.getElementById('cw-runtime-url')
  const select = document.getElementById('cw-function-select')
  const loadButton = document.getElementById('cw-load-functions')
  const previewButton = document.getElementById('cw-preview-function')
  const result = document.getElementById('cw-function-result')
  if (!urlInput || !select || !loadButton || !previewButton || !result) return

  urlInput.value = S.cfg.compilableWorldRuntimeUrl || 'http://127.0.0.1:8765'
  urlInput.addEventListener('change', () => saveRuntimeUrl(urlInput.value))
  select.addEventListener('change', () => renderInputs(selectedRecord()))

  loadButton.addEventListener('click', async () => {
    saveRuntimeUrl(urlInput.value)
    loadButton.disabled = true
    setStatus(t('runtimeDynamic.loadingCatalog'))
    try {
      renderCatalog(await fetchFunctionCatalog(urlInput.value))
    } catch (error) {
      records = []
      select.innerHTML = ''
      previewButton.disabled = true
      setStatus(error?.message || String(error), 'error')
    } finally {
      loadButton.disabled = false
    }
  })

  previewButton.addEventListener('click', async () => {
    const record = selectedRecord()
    if (!record) return
    const inputs = {}
    for (const input of panel.querySelectorAll('[data-cw-input]')) {
      if (input.value.trim() === '') {
        setStatus(t('runtimeDynamic.inputRequired', { name: input.dataset.cwInput }), 'error')
        return
      }
      inputs[input.dataset.cwInput] = Number(input.value)
    }
    previewButton.disabled = true
    setStatus(t('runtimeDynamic.previewing'))
    try {
      const preview = await previewRuntimeFunction(urlInput.value, record.function_id, inputs)
      result.textContent = JSON.stringify(preview, null, 2)
      setStatus(t('runtimeDynamic.previewComplete', { id: record.function_id }), 'ok')
    } catch (error) {
      setStatus(error?.message || String(error), 'error')
    } finally {
      previewButton.disabled = false
    }
  })
}
