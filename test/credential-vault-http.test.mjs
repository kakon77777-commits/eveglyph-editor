import test from 'node:test'
import assert from 'node:assert/strict'

import { createGitHubConnectorHttpController } from '../server/connectors/github-http.js'
import { createGoogleDriveConnectorHttpController } from '../server/connectors/google-drive-http.js'

function vaultError() {
  const error = new Error('backend-secret-failure access-token-value refresh-token-value')
  error.code = 'credential_vault_unavailable'
  return error
}

function assertVaultUnavailable(response) {
  assert.equal(response.status, 503)
  const serialized = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
  assert.match(serialized, /credential_vault_unavailable/)
  for (const secret of ['backend-secret-failure', 'access-token-value', 'refresh-token-value']) {
    assert.equal(serialized.includes(secret), false, `vault response leaked ${secret}`)
  }
}

test('GitHub controller exposes keyring outage as stable redacted 503 on OAuth callback', async () => {
  const controller = createGitHubConnectorHttpController({
    service: { async completeAuth() { throw vaultError() } },
  })
  assertVaultUnavailable(await controller.callback({ code: 'code', state: 'state' }))
})

test('Google controller exposes keyring outage as stable redacted 503 on OAuth callback', async () => {
  const controller = createGoogleDriveConnectorHttpController({
    service: { async completeAuth() { throw vaultError() } },
  })
  assertVaultUnavailable(await controller.callback({ code: 'code', state: 'state' }))
})
