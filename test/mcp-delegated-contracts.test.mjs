import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DELEGATED_TOOL_NAMES,
  resolveDelegatedOperation,
} from '../server/connectors/delegated-contracts.js'
import {
  MCP_TOOL_CAPABILITY_NAMES,
  resolveMcpToolCapabilityRequests,
} from '../src/capabilities/mcp-map.js'

test('delegated tool registry exposes exactly the three PR-E read-only tools', () => {
  assert.deepEqual([...DELEGATED_TOOL_NAMES].sort(), [
    'github_read_file_delegated',
    'google_drive_list_files_delegated',
    'google_drive_read_file_delegated',
  ].sort())
  for (const name of DELEGATED_TOOL_NAMES) assert.equal(MCP_TOOL_CAPABILITY_NAMES.includes(name), true)
})

test('GitHub delegated read canonicalizes exact repository file authority', () => {
  const operation = resolveDelegatedOperation('github_read_file_delegated', {
    repository: 'owner/repo',
    path: 'docs/readme.md',
    ref: 'main',
    delegation_ticket: 'ticket-does-not-affect-resource',
  })

  assert.equal(operation.provider, 'github')
  assert.equal(operation.operation, 'read-file')
  assert.equal(operation.capability, 'connector.github.repository.contents.read')
  assert.equal(operation.resource, 'github:repository:owner/repo:contents:docs/readme.md')
  assert.deepEqual(operation.input, {
    repository: 'owner/repo',
    path: 'docs/readme.md',
    ref: 'main',
  })
})

test('Google delegated list and exact-file read use canonical authority resources', () => {
  const list = resolveDelegatedOperation('google_drive_list_files_delegated', { page_token: 'page-1' })
  assert.equal(list.provider, 'google')
  assert.equal(list.operation, 'list-files')
  assert.equal(list.capability, 'connector.google.drive.metadata.list')
  assert.equal(list.resource, 'google:drive:files:list')
  assert.deepEqual(list.input, { page_token: 'page-1' })

  const read = resolveDelegatedOperation('google_drive_read_file_delegated', {
    file_id: '1AbCdEfGhIjK',
    delegation_ticket: 'ignored-for-resource',
  })
  assert.equal(read.operation, 'read-file')
  assert.equal(read.capability, 'connector.google.drive.file.read')
  assert.equal(read.resource, 'google:drive:file:1AbCdEfGhIjK')
  assert.deepEqual(read.input, { file_id: '1AbCdEfGhIjK' })
})

test('MCP capability mapping derives exactly the delegated contract capability and resource', () => {
  const cases = [
    ['github_read_file_delegated', { repository: 'owner/repo', path: 'README.md', delegation_ticket: 'opaque' }],
    ['google_drive_list_files_delegated', { page_token: 'next-page', delegation_ticket: 'opaque' }],
    ['google_drive_read_file_delegated', { file_id: '1AbCdEfGhIjK', delegation_ticket: 'opaque' }],
  ]

  for (const [toolName, input] of cases) {
    const operation = resolveDelegatedOperation(toolName, input)
    const requests = resolveMcpToolCapabilityRequests(toolName, input)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].capability, operation.capability)
    assert.equal(requests[0].resource, operation.resource)
    assert.equal(requests[0].context.tool, toolName)
    assert.equal(requests[0].context.delegated, true)
  }
})

test('delegated normalization rejects traversal, invalid repository/file ids, and unknown tools', () => {
  assert.throws(
    () => resolveDelegatedOperation('github_read_file_delegated', { repository: 'owner/repo', path: '../secret.md' }),
    { code: 'github_invalid_path' },
  )
  assert.throws(
    () => resolveDelegatedOperation('github_read_file_delegated', { repository: 'not-a-repository', path: 'README.md' }),
    { code: 'github_invalid_repository' },
  )
  assert.throws(
    () => resolveDelegatedOperation('google_drive_read_file_delegated', { file_id: 'short' }),
    { code: 'google_drive_invalid_file_id' },
  )
  assert.throws(
    () => resolveDelegatedOperation('unknown_delegated_tool', {}),
    { code: 'unknown_delegated_tool' },
  )
})
