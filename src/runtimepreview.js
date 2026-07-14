// Read-only CompilableWorld Runtime connector.
// The Runtime owns validation and evaluation; EveGlyph only supplies inputs and
// renders the returned catalog/preview contract.

export const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:8765'

export function normalizeRuntimeUrl(value = DEFAULT_RUNTIME_URL) {
  return String(value || DEFAULT_RUNTIME_URL).trim().replace(/\/+$/, '')
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  let payload = null
  try { payload = await response.json() } catch (_) {}
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Runtime request failed (${response.status})`
    throw new Error(message)
  }
  return payload
}

export function fetchFunctionCatalog(baseUrl = DEFAULT_RUNTIME_URL) {
  return requestJson(`${normalizeRuntimeUrl(baseUrl)}/api/studio/functions`)
}

export function previewRuntimeFunction(baseUrl, functionId, inputs) {
  return requestJson(`${normalizeRuntimeUrl(baseUrl)}/api/studio/function-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ function_id: functionId, inputs })
  })
}
