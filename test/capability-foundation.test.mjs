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

test('an Object.prototype member name is not a known capability (prototype-chain bypass)', async () => {
  // Regression test for a real, demonstrated exploit: getCapabilityDefinition
  // used to do `CAPABILITY_REGISTRY[key]` and check truthiness. Since
  // CAPABILITY_REGISTRY is a plain (frozen, but still prototype-linked)
  // object, `CAPABILITY_REGISTRY['constructor']` resolved to
  // Object.prototype.constructor — the real Object function, a truthy
  // value — so a capability id of 'constructor' (or '__proto__', 'toString',
  // 'hasOwnProperty', 'valueOf') silently passed the "is this registered"
  // check despite never being registered, falsifying the "unknown
  // capabilities fail closed" invariant. Nothing currently maps one of
  // these names to real authority, so this wasn't independently
  // exploitable today, but it's exactly the kind of check that becomes
  // dangerous the moment a capability id is ever derived from
  // caller-controlled input elsewhere. Fixed with Object.hasOwn.
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.throws(
      () => createCapabilitySession({ grants: [{
        capability: name,
        resource: 'anything:*',
        lifetime: 'session',
        source: 'user-explicit',
        grantedBy: 'user:neo',
      }] }),
      error => error?.code === 'unknown_capability',
      `capability id '${name}' must be rejected at grant creation, not silently accepted`
    )
  }
  // Same check must hold for the request side, not just the grant side —
  // an empty-grants session still must not resolve these names as "known."
  const session = createCapabilitySession()
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.throws(
      () => session.authorize({ capability: name, resource: 'anything:goes', lifetime: 'once' }),
      error => error?.code === 'unknown_capability',
      `authorize() must reject capability id '${name}' as unknown, not resolve it via the prototype chain`
    )
  }
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

test('resourceMatches refuses a wildcard whose prefix has no segment-boundary delimiter', async () => {
  // Regression test for a demonstrated exploit: resourceMatches() did a bare
  // startsWith after stripping the trailing '*', with no requirement that
  // the remaining prefix end at a real segment boundary. A grant resource
  // like 'owner/repo*' (no ':' or '/' immediately before the star) would
  // then also match 'owner/repo-evil...', purely because 'repo' is a string
  // prefix of 'repo-evil' — the same class of bug as an unanchored regex or
  // a path check that forgets to require a trailing separator. Every grant
  // resource this codebase actually constructs already ends its wildcard
  // prefix in ':' or '/' (github:...:contents:*, google:drive:files:*,
  // execution:*, workspace:/docs/*), so this was latent, not independently
  // exploitable through any shipped grant — but the primitive itself must
  // be safe regardless of caller discipline.
  const { resourceMatches } = await requireModule(CAPABILITY_MODULE, 'capability foundation')

  // The exact exploit shape demonstrated during review.
  assert.equal(resourceMatches('github:repo:owner/repo*', 'github:repo:owner/repo-evil:contents:x'), false)
  assert.equal(resourceMatches('workspace:/docs*', 'workspace:/docs-secret/x.md'), false)

  // A wildcard ending in an unsafe boundary must never match anything —
  // not even what looks like "the same resource" absent the suffix, since
  // there is no way to tell whether that similarity was intended.
  assert.equal(resourceMatches('github:repo:owner/repo*', 'github:repo:owner/repo'), false)

  // Every real, already-safe wildcard shape in this codebase must be
  // unaffected — this fix must not become a new false-negative source.
  assert.equal(resourceMatches('github:repository:owner/repo:contents:*', 'github:repository:owner/repo:contents:README.md'), true)
  assert.equal(resourceMatches('google:drive:files:*', 'google:drive:files:list'), true)
  assert.equal(resourceMatches('execution:*', 'execution:aimdc'), true)
  assert.equal(resourceMatches('workspace:/docs/*', 'workspace:/docs/a.md'), true)
  assert.equal(resourceMatches('workspace:/docs/*', 'workspace:/other/a.md'), false)
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
