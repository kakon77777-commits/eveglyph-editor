import test from 'node:test'
import assert from 'node:assert/strict'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'
import { createDelegationBroker } from '../server/credentials/delegation-broker.js'
import { createGitHubConnectorService } from '../server/connectors/github-service.js'
import { createGoogleDriveConnectorService } from '../server/connectors/google-drive-service.js'

const NOW = () => new Date('2026-08-28T08:40:00.000Z')

function githubOAuth() {
  return {
    configured: () => true,
    start: () => ({ authorizeUrl: 'https://github.example/auth' }),
    async complete({ broker }) {
      const credentialId = broker.store({
        provider: 'github',
        account: { id: 42, login: 'neo' },
        accessToken: 'github-secret',
      })
      return { credentialId, account: broker.describe(credentialId).account }
    },
  }
}

function googleOAuth() {
  return {
    configured: () => true,
    start: () => ({ authorizeUrl: 'https://google.example/auth' }),
    async complete({ broker }) {
      const credentialId = broker.store({
        provider: 'google',
        account: { sub: 'google-user-1', email: 'neo@example.test' },
        accessToken: 'google-secret',
      })
      return { credentialId, account: broker.describe(credentialId).account }
    },
  }
}

function githubService() {
  const broker = createMemoryCredentialBroker({ now: NOW })
  const delegationBroker = createDelegationBroker({ now: NOW })
  const service = createGitHubConnectorService({
    broker,
    delegationBroker,
    oauth: githubOAuth(),
    fetchImpl: async () => { throw new Error('delegation issuance must not fetch provider data') },
    now: NOW,
  })
  return { service, broker, delegationBroker }
}

function googleService() {
  const broker = createMemoryCredentialBroker({ now: NOW })
  const delegationBroker = createDelegationBroker({ now: NOW })
  const service = createGoogleDriveConnectorService({
    broker,
    delegationBroker,
    oauth: googleOAuth(),
    fetchImpl: async () => { throw new Error('delegation issuance must not fetch provider data') },
    now: NOW,
  })
  return { service, broker, delegationBroker }
}

test('GitHub cannot issue delegated read before matching repository grant', async () => {
  const { service } = githubService()
  await service.completeAuth({ code: 'c', state: 's' })

  assert.throws(
    () => service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'README.md' }),
    { code: 'capability_denied' },
  )
})

test('GitHub issues exact one-use delegation only inside granted repository scope', async () => {
  const { service } = githubService()
  await service.completeAuth({ code: 'c', state: 's' })
  service.grantRepositoryRead({ repository: 'owner/repo' })

  const issued = service.issueRepositoryFileDelegation({
    repository: 'owner/repo',
    path: 'docs/a.md',
    ref: 'main',
  })

  assert.match(issued.ticket, /^[A-Za-z0-9_-]{40,}$/)
  assert.equal(issued.delegation.provider, 'github')
  assert.equal(issued.delegation.operation, 'read-file')
  assert.equal(issued.delegation.capability, 'connector.github.repository.contents.read')
  assert.equal(issued.delegation.resource, 'github:repository:owner/repo:contents:docs/a.md')
  assert.equal(issued.delegation.actor, 'github:user:42')
  assert.equal(issued.delegation.max_uses, 1)
  assert.equal(JSON.stringify(issued.delegation).includes(issued.ticket), false)

  assert.throws(
    () => service.issueRepositoryFileDelegation({ repository: 'other/repo', path: 'docs/a.md' }),
    { code: 'capability_denied' },
  )
})

test('Google metadata and file delegation issuance require their independent live grants', async () => {
  const { service } = googleService()
  await service.completeAuth({ code: 'c', state: 's' })

  assert.throws(() => service.issueMetadataListDelegation(), { code: 'capability_denied' })
  assert.throws(
    () => service.issueFileReadDelegation({ fileId: '1AbCdEfGhIjK' }),
    { code: 'capability_denied' },
  )

  service.grantMetadataList()
  const metadata = service.issueMetadataListDelegation({ pageToken: 'next-page' })
  assert.equal(metadata.delegation.provider, 'google')
  assert.equal(metadata.delegation.operation, 'list-files')
  assert.equal(metadata.delegation.resource, 'google:drive:files:list')
  assert.equal(metadata.delegation.actor, 'google:account:google-user-1')

  service.grantFileRead({ fileId: '1AbCdEfGhIjK' })
  const file = service.issueFileReadDelegation({ fileId: '1AbCdEfGhIjK' })
  assert.equal(file.delegation.operation, 'read-file')
  assert.equal(file.delegation.resource, 'google:drive:file:1AbCdEfGhIjK')

  assert.throws(
    () => service.issueFileReadDelegation({ fileId: '9ZyXwVuTsRqP' }),
    { code: 'capability_denied' },
  )
})

test('restored provider identity has zero authority to mint delegations until user grants again', () => {
  const github = githubService()
  const githubCredentialId = github.broker.store({
    provider: 'github',
    account: { id: 99, login: 'restored' },
    accessToken: 'restored-github-secret',
  })
  github.service.restoreAuth({ credentialId: githubCredentialId })
  assert.throws(
    () => github.service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'README.md' }),
    { code: 'capability_denied' },
  )

  const google = googleService()
  const googleCredentialId = google.broker.store({
    provider: 'google',
    account: { sub: 'restored-google' },
    accessToken: 'restored-google-secret',
  })
  google.service.restoreAuth({ credentialId: googleCredentialId })
  assert.throws(() => google.service.issueMetadataListDelegation(), { code: 'capability_denied' })
  assert.throws(
    () => google.service.issueFileReadDelegation({ fileId: '1AbCdEfGhIjK' }),
    { code: 'capability_denied' },
  )
})
