import test from 'node:test'
import assert from 'node:assert/strict'

async function requireModule(path, label) {
  try {
    return await import(path)
  } catch (error) {
    assert.fail(`${label} is not implemented: ${error?.message || error}`)
  }
}

const CAPABILITY_MODULE = '../src/capabilities/index.js'
const DOCUMENT_RUNTIME_MODULE = '../src/capabilities/document-runtime.js'
const MCP_MAP_MODULE = '../src/capabilities/mcp-map.js'

test('document-only contains exactly the three default capability scopes', async () => {
  const { getSandboxProfile } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  assert.deepEqual(getSandboxProfile('document-only').grants, [
    { capability: 'document.read.self', resource: 'document:self' },
    { capability: 'document.compute', resource: 'document:self' },
    { capability: 'ephemeral.output', resource: 'execution:*' },
  ])
})

test('document-only denies workspace network process env and provider access with audit evidence', async () => {
  const { createCapabilitySession, createActorContext } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const session = createCapabilitySession({
    actor: createActorContext({ humanPrincipal: 'user:neo', client: 'test-client', document: 'paper.md' }),
    now: () => new Date('2026-08-28T04:00:00.000Z'),
    idFactory: (() => { let i = 0; return () => `evt-${++i}` })(),
  })

  for (const [capability, resource] of [
    ['workspace.read', 'workspace:/secret.txt'],
    ['network.connect', 'https://example.com'],
    ['process.spawn', 'process:/bin/sh'],
    ['host.env.read', 'env:HOME'],
    ['connector.github.repository.contents.read', 'github:repo:owner/repo'],
    ['connector.google.drive.file.read', 'google:drive:file:123'],
  ]) {
    const decision = session.authorize({ capability, resource, lifetime: 'once', reason: 'negative test' })
    assert.equal(decision.decision, 'deny')
  }

  const audit = session.getAuditLedger()
  assert.equal(audit.length, 6)
  assert.equal(audit[0].actor.humanPrincipal, 'user:neo')
  assert.equal(audit[0].actor.client, 'test-client')
  assert.equal(audit[0].actor.document, 'paper.md')
})

test('unknown capabilities fail closed', async () => {
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const session = createCapabilitySession()
  assert.throws(
    () => session.authorize({ capability: 'unknown.superpower', resource: 'x:y', lifetime: 'once' }),
    error => error?.code === 'unknown_capability'
  )
})

test('exact read grant does not authorize another resource or write', async () => {
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const session = createCapabilitySession({ grants: [{
    capability: 'connector.github.repository.contents.read',
    resource: 'github:repo:kakon77777-commits/eveglyph-editor',
    lifetime: 'session',
    source: 'user-explicit',
    grantedBy: 'user:neo',
  }] })

  assert.equal(session.authorize({
    capability: 'connector.github.repository.contents.read',
    resource: 'github:repo:kakon77777-commits/eveglyph-editor',
    lifetime: 'once',
  }).decision, 'allow')

  assert.equal(session.authorize({
    capability: 'connector.github.repository.contents.read',
    resource: 'github:repo:someone/else',
    lifetime: 'once',
  }).decision, 'deny')

  assert.equal(session.authorize({
    capability: 'connector.github.repository.contents.write',
    resource: 'github:repo:kakon77777-commits/eveglyph-editor',
    lifetime: 'once',
  }).decision, 'deny')
})

test('trailing wildcard grant matches only its resource prefix', async () => {
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const session = createCapabilitySession({ grants: [{
    capability: 'workspace.read',
    resource: 'workspace:/docs/*',
    lifetime: 'session',
    source: 'user-explicit',
    grantedBy: 'user:neo',
  }] })

  assert.equal(session.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'allow')
  assert.equal(session.authorize({ capability: 'workspace.read', resource: 'workspace:/other/a.md', lifetime: 'once' }).decision, 'deny')
})

test('expired until grant denies and once grant is consumed', async () => {
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const now = () => new Date('2026-08-28T04:00:00.000Z')

  const expired = createCapabilitySession({ now, grants: [{
    capability: 'workspace.read',
    resource: 'workspace:/docs/*',
    lifetime: 'until',
    source: 'user-explicit',
    grantedBy: 'user:neo',
    expiresAt: '2026-08-28T03:59:59.000Z',
  }] })
  assert.equal(expired.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'deny')

  const once = createCapabilitySession({ now, grants: [{
    capability: 'workspace.read',
    resource: 'workspace:/docs/a.md',
    lifetime: 'once',
    source: 'user-explicit',
    grantedBy: 'user:neo',
  }] })
  assert.equal(once.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'allow')
  assert.equal(once.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'deny')
})

test('AIMD-C runs through document-only and preserves same-document external refs', async () => {
  const { evaluateDocumentInSandbox } = await requireModule(DOCUMENT_RUNTIME_MODULE, 'document runtime')
  const { parseAimdcBlock } = await import('../src/aimdc/parser.js')
  const value = parseAimdcBlock('aimd-value', '{id="local" type="Number"}', '2')

  const result = evaluateDocumentInSandbox([value], {
    externalRefs: { 'judge.support': 0.8 },
    actor: { client: 'test-client', document: 'paper.md' },
  })

  assert.equal(result.sandbox.profile, 'document-only')
  assert.equal(result.externalRefs['judge.support'], 0.8)
  assert.deepEqual(result.sandbox.audit.map(entry => entry.request.capability), [
    'document.read.self',
    'document.compute',
    'ephemeral.output',
  ])
  assert.equal(result.sandbox.audit.every(entry => entry.decision === 'allow'), true)
})

test('document runtime rejects explicitly requested non-document authority', async () => {
  const { evaluateDocumentInSandbox } = await requireModule(DOCUMENT_RUNTIME_MODULE, 'document runtime')
  assert.throws(
    () => evaluateDocumentInSandbox([], {
      requestedCapabilities: [{ capability: 'network.connect', resource: 'https://example.com', lifetime: 'once' }],
    }),
    error => error?.code === 'capability_denied' && error?.decision?.request?.capability === 'network.connect'
  )
})

test('markdownToTypst (render_document/validate_document\'s AIMD-C path) is capability-gated, not a direct evaluator call', async () => {
  // Regression test for a real finding: render_document/validate_document
  // (mcp-publication.js, reachable over remote MCP with only the bearer
  // token) used to import evaluateDocument from aimdc/graph.js directly,
  // bypassing the capability sandbox entirely — zero authority check, zero
  // audit evidence, unlike evaluate_aimdc which was already correctly
  // routed. Fixed by switching to evaluateDocumentInSandbox (same function
  // the test above exercises directly). This test proves the fix from the
  // public markdownToTypst() surface those two MCP tools actually call
  // through — not just that the right function is imported, but that an
  // out-of-baseline capability request made through that exact surface is
  // genuinely denied before evaluation, the same behavioral proof as the
  // test above.
  const { markdownToTypst } = await requireModule('../src/typstconvert.js', 'typst converter')
  const source = '::: aimd-value {id="x" type="Number"}\n2\n:::\n'
  assert.throws(
    () => markdownToTypst(source, {
      requestedCapabilities: [{ capability: 'network.connect', resource: 'https://example.com', lifetime: 'once' }],
    }),
    error => error?.code === 'capability_denied' && error?.decision?.request?.capability === 'network.connect'
  )
  // Baseline-only evaluation (what render_document/validate_document
  // actually do today) still succeeds — this isn't a new restriction on
  // normal use, only a real gate against authority the caller never had.
  assert.doesNotThrow(() => markdownToTypst(source))
})

test('MCP map covers current base and publication tools and rejects unknown tools', async () => {
  const { resolveMcpToolCapabilityRequests } = await requireModule(MCP_MAP_MODULE, 'MCP capability map')

  assert.deepEqual(
    resolveMcpToolCapabilityRequests('write_file', { path: 'notes/a.md' }).map(x => x.capability),
    ['workspace.write']
  )
  assert.deepEqual(
    resolveMcpToolCapabilityRequests('render_document', {}).map(x => x.capability),
    ['document.read.self', 'document.compute', 'ephemeral.output']
  )
  assert.deepEqual(
    resolveMcpToolCapabilityRequests('get_render_report', { artifact_id: 'abc' }).map(x => x.resource),
    ['artifact:abc']
  )
  assert.throws(
    () => resolveMcpToolCapabilityRequests('not_a_tool', {}),
    error => error?.code === 'unknown_mcp_tool'
  )
})
