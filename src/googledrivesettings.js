const $ = id => document.getElementById(id)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const METADATA_CAPABILITY = 'connector.google.drive.metadata.list'
const FILE_READ_CAPABILITY = 'connector.google.drive.file.read'
let lastStatus = null
let listedFiles = []

function publicError(data, fallback = 'Google Drive connector request failed') { return data?.error?.message || fallback }

async function googleRequest(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`/api/connectors/google/${path}`, options)
  const text = await response.text()
  let data = {}
  if (text) {
    try { data = JSON.parse(text) }
    catch { data = { error: { message: 'Google Drive connector returned an invalid response.' } } }
  }
  if (!response.ok) {
    const error = new Error(publicError(data, `Google Drive connector request failed (HTTP ${response.status})`))
    error.code = data?.error?.code || 'google_drive_connector_error'
    throw error
  }
  return data
}

function setStatusText(text) { const el = $('s-google-status'); if (el) el.textContent = text }
function setResultText(text) { const el = $('s-google-read-result'); if (el) el.textContent = text }
function setDelegationText(text) { const el = $('s-google-delegation-result'); if (el) el.textContent = text }

function hasGrant(status, capability, resource = null) {
  return (status?.grants || []).some(grant => grant.capability === capability && (resource == null || grant.resource === resource))
}

function selectedFileId() { return $('s-google-file-select')?.value || '' }

function setControlState(status) {
  lastStatus = status
  const connected = Boolean(status?.connected)
  const configured = Boolean(status?.configured)
  const metadataGranted = hasGrant(status, METADATA_CAPABILITY)
  const fileId = selectedFileId()
  const fileGranted = fileId ? hasGrant(status, FILE_READ_CAPABILITY, `google:drive:file:${fileId}`) : false

  const states = [
    ['btn-google-connect', !configured || connected],
    ['btn-google-disconnect', !connected],
    ['btn-google-grant-metadata', !connected || metadataGranted],
    ['btn-google-list-files', !connected || !metadataGranted],
    ['btn-google-issue-mcp-list', !connected || !metadataGranted],
    ['btn-google-grant-file-read', !connected || !fileId || fileGranted],
    ['btn-google-read', !connected || !fileId || !fileGranted],
    ['btn-google-issue-mcp-file-read', !connected || !fileId || !fileGranted],
  ]
  for (const [id, disabled] of states) { const el = $(id); if (el) el.disabled = disabled }
  const select = $('s-google-file-select')
  if (select) select.disabled = !connected || listedFiles.length === 0
}

function statusLabel(status) {
  if (!status?.configured) return 'Not configured — set EVEGLYPH_GOOGLE_CLIENT_ID and EVEGLYPH_GOOGLE_CLIENT_SECRET, then restart the dev server.'
  if (!status.connected) return 'Disconnected'
  const account = status.account || {}
  const label = account.email || account.name || account.sub || 'Google account'
  const metadata = hasGrant(status, METADATA_CAPABILITY) ? 'metadata browse granted' : 'metadata browse not granted'
  const fileReads = (status.grants || []).filter(grant => grant.capability === FILE_READ_CAPABILITY).length
  return `Connected as ${label} · ${metadata} · ${fileReads} file read grant${fileReads === 1 ? '' : 's'}`
}

function renderFiles(files) {
  listedFiles = Array.isArray(files) ? files : []
  const select = $('s-google-file-select')
  if (!select) return
  const options = []
  if (!listedFiles.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'No Drive files returned'; options.push(option)
  } else {
    for (const file of listedFiles) {
      const option = document.createElement('option')
      option.value = file.id
      const size = file.size == null ? '' : ` · ${file.size} B`
      option.textContent = `${file.name} · ${file.mime_type}${size}`
      options.push(option)
    }
  }
  select.replaceChildren(...options)
  setControlState(lastStatus || { configured: true, connected: true, grants: [] })
}

export async function googleRefreshStatus() {
  try { const status = await googleRequest('status'); setStatusText(statusLabel(status)); setControlState(status); return status }
  catch (error) {
    const status = { configured: false, connected: false, grants: [] }
    setStatusText(error.message || 'Google Drive connector unavailable'); setControlState(status)
    return { ...status, error: error.code || 'google_drive_connector_error' }
  }
}

export async function googleConnect() {
  const popup = window.open('', 'eveglyph-google-oauth', 'popup,width=720,height=760')
  setStatusText('Starting Google authentication…')
  try {
    const started = await googleRequest('auth/start', { method: 'POST' })
    if (!started.authorize_url) throw new Error('Google authorization URL was not returned.')
    if (popup && !popup.closed) popup.location.href = started.authorize_url
    else window.location.href = started.authorize_url
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(1000)
      const status = await googleRefreshStatus()
      if (status.connected) return status
      if (popup?.closed && attempt > 2) break
    }
    const error = new Error('Google authentication did not complete in this session.'); error.code = 'google_auth_incomplete'; throw error
  } catch (error) { try { popup?.close() } catch {}; setStatusText(error.message || 'Google authentication failed'); throw error }
}

export async function googleDisconnect() {
  try {
    await googleRequest('disconnect', { method: 'POST' })
    listedFiles = []; renderFiles([]); setResultText(''); setDelegationText('')
    return await googleRefreshStatus()
  } catch (error) { setStatusText(error.message || 'Google disconnect failed'); throw error }
}

export async function googleGrantMetadata() {
  try { const grant = await googleRequest('grant-metadata', { method: 'POST' }); await googleRefreshStatus(); return grant }
  catch (error) { setStatusText(error.message || 'Google Drive metadata grant failed'); throw error }
}

export async function googleListFiles() {
  setResultText('Listing Drive files…')
  try {
    const result = await googleRequest('list-files')
    renderFiles(result.files || [])
    setResultText(`${result.files?.length || 0} Drive file(s) listed. Select one, grant read, then read it.`)
    return result
  } catch (error) { setResultText(error.message || 'Google Drive file listing failed'); throw error }
}

export async function googleIssueMcpListTicket() {
  setDelegationText('Issuing one-use MCP metadata-list delegation…')
  try {
    const issued = await googleRequest('delegation/list-files', { method: 'POST', body: {} })
    const delegation = issued.delegation || {}
    setDelegationText([
      'ONE-USE MCP DELEGATION — do not store as a reusable credential',
      `ticket: ${String(issued.ticket || '')}`,
      `expires: ${delegation.expires_at || 'unknown'}`,
      `resource: ${delegation.resource || 'unknown'}`,
      'This value exists only in the live page. A third-party MCP host may log tool arguments.',
    ].join('\n'))
    return issued
  } catch (error) { setDelegationText(error.message || 'Google MCP list delegation failed'); throw error }
}

export async function googleGrantFileRead() {
  const fileId = selectedFileId()
  if (!fileId) { const error = new Error('Select a Drive file first.'); error.code = 'google_drive_invalid_file_id'; setStatusText(error.message); throw error }
  try {
    const grant = await googleRequest('grant-file-read', { method: 'POST', body: { file_id: fileId } })
    await googleRefreshStatus(); return grant
  } catch (error) { setStatusText(error.message || 'Google Drive file grant failed'); throw error }
}

export async function googleReadFile() {
  const fileId = selectedFileId()
  if (!fileId) { const error = new Error('Select a Drive file first.'); error.code = 'google_drive_invalid_file_id'; setResultText(error.message); throw error }
  setResultText('Reading Drive file…')
  try {
    const result = await googleRequest('read-file', { method: 'POST', body: { file_id: fileId } })
    const file = result.file || {}; const exported = result.export_mime_type ? ` · exported ${result.export_mime_type}` : ''
    const header = `${file.name || file.id || fileId} · ${file.mime_type || 'unknown'}${exported}\n${result.size ?? 0} bytes\n\n`
    setResultText(header + String(result.content ?? '')); return result
  } catch (error) { setResultText(error.message || 'Google Drive file read failed'); throw error }
}

export async function googleIssueMcpFileReadTicket() {
  const fileId = selectedFileId()
  if (!fileId) { const error = new Error('Select a Drive file first.'); error.code = 'google_drive_invalid_file_id'; setDelegationText(error.message); throw error }
  setDelegationText('Issuing one-use MCP file-read delegation…')
  try {
    const issued = await googleRequest('delegation/read-file', { method: 'POST', body: { file_id: fileId } })
    const delegation = issued.delegation || {}
    setDelegationText([
      'ONE-USE MCP DELEGATION — do not store as a reusable credential',
      `ticket: ${String(issued.ticket || '')}`,
      `expires: ${delegation.expires_at || 'unknown'}`,
      `resource: ${delegation.resource || 'unknown'}`,
      'This value exists only in the live page. A third-party MCP host may log tool arguments.',
    ].join('\n'))
    return issued
  } catch (error) { setDelegationText(error.message || 'Google MCP file delegation failed'); throw error }
}

function bindGoogleDriveSettings() {
  const ids = ['btn-google-connect','btn-google-disconnect','btn-google-grant-metadata','btn-google-list-files','btn-google-issue-mcp-list','s-google-file-select','btn-google-grant-file-read','btn-google-read','btn-google-issue-mcp-file-read']
  if (ids.some(id => !$(id))) return false
  $('btn-google-connect').onclick = () => { googleConnect().catch(() => {}) }
  $('btn-google-disconnect').onclick = () => { googleDisconnect().catch(() => {}) }
  $('btn-google-grant-metadata').onclick = () => { googleGrantMetadata().catch(() => {}) }
  $('btn-google-list-files').onclick = () => { googleListFiles().catch(() => {}) }
  $('btn-google-issue-mcp-list').onclick = () => { googleIssueMcpListTicket().catch(() => {}) }
  $('s-google-file-select').onchange = () => { setControlState(lastStatus || { configured: true, connected: false, grants: [] }) }
  $('btn-google-grant-file-read').onclick = () => { googleGrantFileRead().catch(() => {}) }
  $('btn-google-read').onclick = () => { googleReadFile().catch(() => {}) }
  $('btn-google-issue-mcp-file-read').onclick = () => { googleIssueMcpFileReadTicket().catch(() => {}) }
  googleRefreshStatus().catch(() => {})
  return true
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindGoogleDriveSettings, { once: true })
else bindGoogleDriveSettings()
