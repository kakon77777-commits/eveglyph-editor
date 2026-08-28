import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'
import { createGitHubConnectorService } from '../server/connectors/github-service.js'
import { createConnectorDelegationRuntime } from '../server/connectors/delegation-runtime.js'
import { resolveDelegatedOperation } from '../server/connectors/delegated-contracts.js'

function response(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body },
  }
}

function githubOAuth() {
  return {
    configured: () => true,
    start: () => ({ authorizeUrl: 'https://github.example/auth' }),
    async complete({ broker }) {
      const credentialId = broker.store({
        provider: 'github',
        account: { id: 42, login: 'neo' },
        accessToken: 'provider-secret',
      })
      return { credentialId, account: broker.describe(credentialId).account }
    },
  }
}

function invokeRaw(endpoint, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    let text = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.end(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => { text += chunk })
    socket.on('error', reject)
    socket.on('close', () => {
      try { resolve(JSON.parse(text.trim())) }
      catch (error) { reject(error) }
    })
  })
}

function endpoint() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\eveglyph-pre-test-${process.pid}-${randomUUID()}`
  return path.join(os.tmpdir(), `eveglyph-pre-test-${process.pid}-${randomUUID()}.sock`)
}

async function setupGitHubRuntime() {
  let fetchCount = 0
  const runtime = createConnectorDelegationRuntime({ endpoint: endpoint() })
  const broker = createMemoryCredentialBroker()
  const service = createGitHubConnectorService({
    broker,
    delegationBroker: runtime.broker,
    oauth: githubOAuth(),
    fetchImpl: async () => {
      fetchCount += 1
      return response({
        type: 'file',
        path: 'a.md',
        sha: 'sha-a',
        size: 5,
        encoding: 'base64',
        content: Buffer.from('hello', 'utf8').toString('base64'),
      })
    },
  })
  await service.completeAuth({ code: 'code', state: 'state' })
  service.grantRepositoryRead({ repository: 'owner/repo' })
  runtime.attachGitHubService(service)
  await runtime.start()
  return { runtime, service, fetchCount: () => fetchCount }
}

test('delegation runtime rejects input/resource substitution before live provider execution', async () => {
  const { runtime, service, fetchCount } = await setupGitHubRuntime()
  try {
    const issued = service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'a.md' })
    const authorized = resolveDelegatedOperation('github_read_file_delegated', { repository: 'owner/repo', path: 'a.md' })
    const result = await invokeRaw(runtime.endpoint, {
      method: 'invoke',
      ticket: issued.ticket,
      provider: authorized.provider,
      operation: authorized.operation,
      capability: authorized.capability,
      resource: authorized.resource,
      input: { repository: 'owner/repo', path: 'b.md' },
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'delegation_mismatch')
    assert.equal(fetchCount(), 0)
  } finally {
    await runtime.stop()
  }
})

test('delegated execution re-checks live connector authority after ticket consumption', async () => {
  const { runtime, service, fetchCount } = await setupGitHubRuntime()
  try {
    const first = service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'a.md' })
    const operation = resolveDelegatedOperation('github_read_file_delegated', { repository: 'owner/repo', path: 'a.md' })
    const request = {
      method: 'invoke',
      ticket: first.ticket,
      provider: operation.provider,
      operation: operation.operation,
      capability: operation.capability,
      resource: operation.resource,
      input: operation.input,
    }
    const allowed = await invokeRaw(runtime.endpoint, request)
    assert.equal(allowed.ok, true)
    assert.equal(allowed.result.content, 'hello')
    assert.equal(fetchCount(), 1)

    const second = service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'a.md' })
    service.disconnect()
    const denied = await invokeRaw(runtime.endpoint, { ...request, ticket: second.ticket })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'github_not_connected')
    assert.equal(fetchCount(), 1, 'disconnect must fail before another provider request')
  } finally {
    await runtime.stop()
  }
})

test('one-use delegated ticket cannot be replayed through the runtime', async () => {
  const { runtime, service, fetchCount } = await setupGitHubRuntime()
  try {
    const issued = service.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'a.md' })
    const operation = resolveDelegatedOperation('github_read_file_delegated', { repository: 'owner/repo', path: 'a.md' })
    const request = {
      method: 'invoke',
      ticket: issued.ticket,
      provider: operation.provider,
      operation: operation.operation,
      capability: operation.capability,
      resource: operation.resource,
      input: operation.input,
    }
    assert.equal((await invokeRaw(runtime.endpoint, request)).ok, true)
    const replay = await invokeRaw(runtime.endpoint, request)
    assert.equal(replay.ok, false)
    assert.equal(replay.error.code, 'delegation_not_found')
    assert.equal(fetchCount(), 1)
  } finally {
    await runtime.stop()
  }
})
