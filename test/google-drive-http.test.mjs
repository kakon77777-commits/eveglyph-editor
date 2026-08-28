import test from 'node:test'
import assert from 'node:assert/strict'

async function requireController() {
  try { return await import('../server/connectors/google-drive-http.js') }
  catch (error) { assert.fail(`Google Drive HTTP controller is not implemented: ${error?.message || error}`) }
}

function secretFree(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of [
    'ya29.google-access-secret',
    '1//google-refresh-secret',
    'google-client-secret-value',
    'google-oauth-code-secret',
    'google-pkce-verifier-secret',
  ]) {
    assert.equal(text.includes(secret), false, `serialized response leaked ${secret}`)
  }
}

test('Google Drive HTTP controller serializes status/auth/grants/list/read/disconnect without credentials', async () => {
  const { createGoogleDriveConnectorHttpController } = await requireController()
  const calls = []
  const service = {
    getStatus() {
      calls.push('status')
      return {
        configured: true,
        connected: true,
        credential_id: 'google-cred-opaque',
        account: { sub: '123', email: 'neo@example.com', email_verified: true, name: 'Neo', picture: null },
        expires_at: '2026-08-28T08:00:00.000Z',
        grants: [],
      }
    },
    startAuth({ redirectUri }) {
      calls.push(['start', redirectUri])
      return { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=public-state' }
    },
    async completeAuth(input) { calls.push(['callback', input]); return this.getStatus() },
    disconnect() { calls.push('disconnect'); return true },
    grantMetadataList() {
      calls.push('grant-metadata')
      return { capability: 'connector.google.drive.metadata.list', resource: 'google:drive:files:*', lifetime: 'session' }
    },
    async listDriveFiles({ pageToken }) {
      calls.push(['list', pageToken])
      return {
        files: [{ id: 'file_1234567890', name: 'Notes.md', mime_type: 'text/markdown', size: 10, modified_time: null, web_view_link: null }],
        next_page_token: null,
        capability_evidence: { decision: 'allow', profile: 'connector-session' },
      }
    },
    grantFileRead({ fileId }) {
      calls.push(['grant-file', fileId])
      return { capability: 'connector.google.drive.file.read', resource: `google:drive:file:${fileId}`, lifetime: 'session' }
    },
    async readDriveFile({ fileId }) {
      calls.push(['read', fileId])
      return {
        file: { id: fileId, name: 'Notes.md', mime_type: 'text/markdown', size: 10, modified_time: null, web_view_link: null },
        export_mime_type: null,
        content: '# hello',
        encoding: 'utf-8',
        size: 7,
        capability_evidence: { decision: 'allow', profile: 'connector-session' },
      }
    },
  }
  const controller = createGoogleDriveConnectorHttpController({ service })

  const responses = [
    await controller.status(),
    await controller.startAuth({ redirectUri: 'http://localhost:5173/api/connectors/google/callback' }),
    await controller.callback({ code: 'google-oauth-code-secret', state: 'state-public' }),
    await controller.grantMetadata(),
    await controller.listFiles({ pageToken: null }),
    await controller.grantFileRead({ fileId: 'file_1234567890' }),
    await controller.readFile({ fileId: 'file_1234567890' }),
    await controller.disconnect(),
  ]

  for (const response of responses) {
    assert.equal(response.status >= 200 && response.status < 300, true)
    secretFree(response.body)
  }
  assert.deepEqual(calls, [
    'status',
    ['start', 'http://localhost:5173/api/connectors/google/callback'],
    ['callback', { code: 'google-oauth-code-secret', state: 'state-public' }],
    'status',
    'grant-metadata',
    ['list', null],
    ['grant-file', 'file_1234567890'],
    ['read', 'file_1234567890'],
    'disconnect',
  ])
})

test('Google OAuth callback returns a small credential-free HTML page', async () => {
  const { createGoogleDriveConnectorHttpController } = await requireController()
  let received
  const controller = createGoogleDriveConnectorHttpController({
    service: {
      async completeAuth(input) {
        received = input
        return { connected: true, account: { sub: '123' }, grants: [] }
      },
    },
  })
  const response = await controller.callback({ code: 'google-oauth-code-secret', state: 'state-public' })

  assert.equal(response.status, 200)
  assert.equal(response.contentType, 'text/html; charset=utf-8')
  assert.match(response.body, /Google Drive connected/i)
  secretFree(response.body)
  assert.deepEqual(received, { code: 'google-oauth-code-secret', state: 'state-public' })
})

test('Google controller maps connector failures to stable redacted public errors', async () => {
  const { createGoogleDriveConnectorHttpController } = await requireController()
  const secretError = code => {
    const error = new Error('internal ya29.google-access-secret 1//google-refresh-secret google-client-secret-value google-pkce-verifier-secret')
    error.code = code
    return error
  }
  const controller = createGoogleDriveConnectorHttpController({
    service: {
      getStatus() { throw secretError('google_drive_api_error') },
      startAuth() { throw secretError('google_not_configured') },
      async completeAuth() { throw secretError('google_invalid_oauth_state') },
      disconnect() { throw secretError('google_drive_not_connected') },
      grantMetadataList() { throw secretError('capability_denied') },
      async listDriveFiles() { throw secretError('google_drive_invalid_page_token') },
      grantFileRead() { throw secretError('google_drive_invalid_file_id') },
      async readDriveFile() { throw secretError('google_drive_file_too_large') },
    },
  })

  const cases = [
    [await controller.status(), 502, 'google_drive_api_error'],
    [await controller.startAuth({ redirectUri: 'http://localhost/callback' }), 503, 'google_not_configured'],
    [await controller.callback({ code: 'google-oauth-code-secret', state: 'bad' }), 400, 'google_invalid_oauth_state'],
    [await controller.disconnect(), 401, 'google_drive_not_connected'],
    [await controller.grantMetadata(), 403, 'capability_denied'],
    [await controller.listFiles({ pageToken: 'bad' }), 400, 'google_drive_invalid_page_token'],
    [await controller.grantFileRead({ fileId: 'bad' }), 400, 'google_drive_invalid_file_id'],
    [await controller.readFile({ fileId: 'huge' }), 413, 'google_drive_file_too_large'],
  ]

  for (const [response, status, code] of cases) {
    assert.equal(response.status, status)
    assert.match(JSON.stringify(response.body), new RegExp(code))
    secretFree(response.body)
  }
})
