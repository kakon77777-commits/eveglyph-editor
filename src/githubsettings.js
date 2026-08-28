const $ = id => document.getElementById(id)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function publicError(data, fallback = 'GitHub connector request failed') { return data?.error?.message || fallback }

async function githubRequest(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`/api/connectors/github/${path}`, options)
  const text = await response.text()
  let data = {}
  if (text) {
    try { data = JSON.parse(text) }
    catch { data = { error: { message: 'GitHub connector returned an invalid response.' } } }
  }
  if (!response.ok) {
    const error = new Error(publicError(data, `GitHub connector request failed (HTTP ${response.status})`))
    error.code = data?.error?.code || 'github_connector_error'
    throw error
  }
  return data
}

function setStatusText(text) { const el = $('s-github-status'); if (el) el.textContent = text }
function setResultText(text) { const el = $('s-github-read-result'); if (el) el.textContent = text }
function setDelegationText(text) { const el = $('s-github-delegation-result'); if (el) el.textContent = text }

function setControlState(status) {
  const connected = Boolean(status?.connected)
  const configured = Boolean(status?.configured)
  for (const [id, disabled] of [
    ['btn-github-connect', !configured || connected],
    ['btn-github-disconnect', !connected],
    ['btn-github-grant-read', !connected],
    ['btn-github-read', !connected],
    ['btn-github-issue-mcp-read', !connected],
  ]) {
    const el = $(id); if (el) el.disabled = disabled
  }
}

function statusLabel(status) {
  if (!status?.configured) return 'Not configured — set EVEGLYPH_GITHUB_CLIENT_ID and EVEGLYPH_GITHUB_CLIENT_SECRET, then restart the dev server.'
  if (!status.connected) return 'Disconnected'
  const login = status.account?.login ? `@${status.account.login}` : 'GitHub account'
  const repositories = (status.grants || []).map(grant => grant.repository).filter(Boolean)
  return repositories.length ? `Connected as ${login} · session read grants: ${repositories.join(', ')}` : `Connected as ${login} · no repository read grants`
}

export async function githubRefreshStatus() {
  try {
    const status = await githubRequest('status')
    setStatusText(statusLabel(status)); setControlState(status); return status
  } catch (error) {
    setStatusText(error.message || 'GitHub connector unavailable')
    setControlState({ configured: false, connected: false })
    return { configured: false, connected: false, error: error.code || 'github_connector_error' }
  }
}

export async function githubConnect() {
  const popup = window.open('', 'eveglyph-github-oauth', 'popup,width=720,height=760')
  setStatusText('Starting GitHub authentication…')
  try {
    const started = await githubRequest('auth/start', { method: 'POST' })
    if (!started.authorize_url) throw new Error('GitHub authorization URL was not returned.')
    if (popup && !popup.closed) popup.location.href = started.authorize_url
    else window.location.href = started.authorize_url
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(1000)
      const status = await githubRefreshStatus()
      if (status.connected) return status
      if (popup?.closed && attempt > 2) break
    }
    const error = new Error('GitHub authentication did not complete in this session.'); error.code = 'github_auth_incomplete'; throw error
  } catch (error) {
    try { popup?.close() } catch {}
    setStatusText(error.message || 'GitHub authentication failed'); throw error
  }
}

export async function githubDisconnect() {
  try {
    await githubRequest('disconnect', { method: 'POST' })
    setResultText(''); setDelegationText('')
    return await githubRefreshStatus()
  } catch (error) { setStatusText(error.message || 'GitHub disconnect failed'); throw error }
}

export async function githubGrantRead() {
  const repository = $('s-github-repository')?.value.trim() || ''
  if (!repository) { const error = new Error('Enter a repository as owner/repo first.'); error.code = 'github_invalid_repository'; setStatusText(error.message); throw error }
  try {
    const grant = await githubRequest('grant-read', { method: 'POST', body: { repository } })
    await githubRefreshStatus(); return grant
  } catch (error) { setStatusText(error.message || 'GitHub repository grant failed'); throw error }
}

function currentFileInput() {
  const repository = $('s-github-repository')?.value.trim() || ''
  const path = $('s-github-path')?.value.trim() || ''
  const ref = $('s-github-ref')?.value.trim() || ''
  if (!repository || !path) {
    const error = new Error('Enter both repository and file path first.')
    error.code = !repository ? 'github_invalid_repository' : 'github_invalid_path'
    throw error
  }
  return { repository, path, ...(ref ? { ref } : {}) }
}

export async function githubReadFile() {
  let input
  try { input = currentFileInput() }
  catch (error) { setResultText(error.message); throw error }
  setResultText('Reading…')
  try {
    const result = await githubRequest('read-file', { method: 'POST', body: input })
    const header = `${result.repository}:${result.path}${result.ref ? ` @ ${result.ref}` : ''}\nsha: ${result.sha || 'n/a'} · ${result.size ?? 0} bytes\n\n`
    setResultText(header + String(result.content ?? '')); return result
  } catch (error) { setResultText(error.message || 'GitHub file read failed'); throw error }
}

export async function githubIssueMcpReadTicket() {
  let input
  try { input = currentFileInput() }
  catch (error) { setDelegationText(error.message); throw error }
  setDelegationText('Issuing one-use MCP delegation…')
  try {
    const issued = await githubRequest('delegation/read-file', { method: 'POST', body: input })
    const delegation = issued.delegation || {}
    setDelegationText([
      'ONE-USE MCP DELEGATION — do not store as a reusable credential',
      `ticket: ${String(issued.ticket || '')}`,
      `expires: ${delegation.expires_at || 'unknown'}`,
      `resource: ${delegation.resource || 'unknown'}`,
      'This value exists only in the live page. A third-party MCP host may log tool arguments.',
    ].join('\n'))
    return issued
  } catch (error) { setDelegationText(error.message || 'MCP delegation issuance failed'); throw error }
}

function bindGitHubSettings() {
  const connect = $('btn-github-connect')
  const disconnect = $('btn-github-disconnect')
  const grant = $('btn-github-grant-read')
  const read = $('btn-github-read')
  const issue = $('btn-github-issue-mcp-read')
  if (!connect || !disconnect || !grant || !read || !issue) return false
  connect.onclick = () => { githubConnect().catch(() => {}) }
  disconnect.onclick = () => { githubDisconnect().catch(() => {}) }
  grant.onclick = () => { githubGrantRead().catch(() => {}) }
  read.onclick = () => { githubReadFile().catch(() => {}) }
  issue.onclick = () => { githubIssueMcpReadTicket().catch(() => {}) }
  githubRefreshStatus().catch(() => {})
  return true
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindGitHubSettings, { once: true })
else bindGitHubSettings()
