# EveGlyph Capability Foundation + Document-Only Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EveGlyph's provider-neutral capability authority core and route AIMD-C through an explicit `document-only` execution boundary without adding OAuth, provider credentials, or arbitrary-code sandbox backends.

**Architecture:** New focused modules under `src/capabilities/` define registry/profile/request/grant/session/document-runtime behavior. Existing AIMD-C `evaluateDocument()` remains the low-level pure evaluator; preview and MCP use the authority-aware wrapper. A separate MCP mapping module makes every current base/publication tool's authority requirement explicit without changing the legacy bearer-token transport contract in this PR.

**Tech Stack:** Node.js 18+ ES modules, Node built-in test runner, existing MCP SDK, existing AIMD-C evaluator, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-capability-foundation-document-sandbox-design.md`

## Global Constraints

- Default sandbox profile is exactly `document-only`.
- `document-only` grants only `document.read.self`, `document.compute`, and `ephemeral.output` with document/execution resource scopes.
- Unknown capability/profile/tool requests fail closed.
- Read never implies write.
- OAuth tokens, provider credentials, filesystem handles, network clients, environment objects, and process handles must not enter the document runtime.
- Dynamic Logic read-only refs remain compatible as same-document runtime projections.
- Do not implement Google/GitHub provider I/O, OAuth, credential vault, Wasmtime, Deno, Bubblewrap, gVisor, or Firecracker in this PR.
- Do not change legacy remote MCP bearer-token behavior in this PR.
- New behavior follows RED → GREEN → regression verification.

---

### Task 1: Add RED capability-foundation tests and CI entrypoint

**Files:**
- Create: `test/capability-foundation.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- Consumes: existing `src/aimdc/parser.js`, `src/aimdc/graph.js`, `mcp-tools.js` behavior.
- Produces: executable behavioral contract for Tasks 2–4.

- [ ] **Step 1: Write the failing test suite before production modules exist**

Create `test/capability-foundation.test.mjs` with Node `node:test` + `node:assert/strict`. Load new modules through a helper that turns a missing module into an assertion failure rather than an uncaught loader error:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function requireModule(path, label) {
  try { return await import(path) }
  catch (error) {
    assert.fail(`${label} is not implemented: ${error?.message || error}`)
  }
}

const CAPABILITY_MODULE = '../src/capabilities/index.js'
const DOCUMENT_RUNTIME_MODULE = '../src/capabilities/document-runtime.js'
const MCP_MAP_MODULE = '../src/capabilities/mcp-map.js'
```

Cover these behaviors as separate tests:

```js
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
  assert.equal(session.getAuditLedger().length, 6)
  assert.equal(session.getAuditLedger()[0].actor.humanPrincipal, 'user:neo')
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

test('expired until grant denies and once grant is consumed', async () => {
  const { createCapabilitySession } = await requireModule(CAPABILITY_MODULE, 'capability foundation')
  const now = () => new Date('2026-08-28T04:00:00.000Z')
  const expired = createCapabilitySession({ now, grants: [{
    capability: 'workspace.read', resource: 'workspace:/docs/*', lifetime: 'until',
    source: 'user-explicit', grantedBy: 'user:neo', expiresAt: '2026-08-28T03:59:59.000Z',
  }] })
  assert.equal(expired.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'deny')

  const once = createCapabilitySession({ now, grants: [{
    capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once',
    source: 'user-explicit', grantedBy: 'user:neo',
  }] })
  assert.equal(once.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'allow')
  assert.equal(once.authorize({ capability: 'workspace.read', resource: 'workspace:/docs/a.md', lifetime: 'once' }).decision, 'deny')
})
```

Also add tests for document runtime and MCP mapping:

```js
test('AIMD-C runs through document-only and preserves same-document external refs', async () => {
  const { evaluateDocumentInSandbox } = await requireModule(DOCUMENT_RUNTIME_MODULE, 'document runtime')
  const { parseAimdcBlock } = await import('../src/aimdc/parser.js')
  const value = parseAimdcBlock('aimd-value', '{id="local" type="number"}', 'value: 2')
  const result = evaluateDocumentInSandbox([value], { externalRefs: { 'judge.support': 0.8 } })
  assert.equal(result.sandbox.profile, 'document-only')
  assert.equal(result.externalRefs['judge.support'], 0.8)
  assert.equal(result.sandbox.audit.every(entry => entry.decision === 'allow'), true)
})

test('document runtime rejects explicitly requested non-document authority', async () => {
  const { evaluateDocumentInSandbox } = await requireModule(DOCUMENT_RUNTIME_MODULE, 'document runtime')
  assert.throws(
    () => evaluateDocumentInSandbox([], { requestedCapabilities: [{ capability: 'network.connect', resource: 'https://example.com', lifetime: 'once' }] }),
    error => error?.code === 'capability_denied' && error?.decision?.request?.capability === 'network.connect'
  )
})

test('MCP map covers current base/publication tools and rejects unknown tools', async () => {
  const { resolveMcpToolCapabilityRequests } = await requireModule(MCP_MAP_MODULE, 'MCP capability map')
  assert.deepEqual(resolveMcpToolCapabilityRequests('write_file', { path: 'notes/a.md' }).map(x => x.capability), ['workspace.write'])
  assert.deepEqual(resolveMcpToolCapabilityRequests('render_document', {}).map(x => x.capability), ['document.read.self', 'document.compute', 'ephemeral.output'])
  assert.throws(() => resolveMcpToolCapabilityRequests('not_a_tool', {}), error => error?.code === 'unknown_mcp_tool')
})
```

- [ ] **Step 2: Add the capability test command**

Add to `package.json` scripts:

```json
"test:capabilities": "node --test test/capability-foundation.test.mjs"
```

- [ ] **Step 3: Wire capability tests into PR CI before existing regressions**

Insert into `.github/workflows/publication-runtime.yml` after `npm ci`:

```yaml
      - name: Capability sandbox tests
        run: npm run test:capabilities
```

- [ ] **Step 4: Commit RED state and open a draft PR**

Commit only test/harness changes. The PR workflow must execute and `Capability sandbox tests` must fail because `src/capabilities/*` is not implemented yet. Record the failing run in the PR body before Task 2.

---

### Task 2: Implement registry, profiles, actor context, grants, policy session, and audit ledger

**Files:**
- Create: `src/capabilities/registry.js`
- Create: `src/capabilities/profiles.js`
- Create: `src/capabilities/model.js`
- Create: `src/capabilities/session.js`
- Create: `src/capabilities/index.js`
- Test: `test/capability-foundation.test.mjs`

**Interfaces:**
- Produces: `getCapabilityDefinition(id)`, `getSandboxProfile(name)`, `createActorContext(input)`, `createCapabilityRequest(input)`, `createGrant(input)`, `createCapabilitySession(options)`, `CapabilityDeniedError`.
- Consumed by: Task 3 document runtime and Task 4 MCP mapping.

- [ ] **Step 1: Implement the fixed registry with fail-closed lookup**

`registry.js` exports a frozen registry and:

```js
export function getCapabilityDefinition(id) {
  const entry = CAPABILITY_REGISTRY[id]
  if (!entry) {
    const error = new Error(`unknown capability: ${id}`)
    error.code = 'unknown_capability'
    throw error
  }
  return entry
}
```

Registry IDs must match the design exactly; no prefix inheritance helper is added.

- [ ] **Step 2: Implement `document-only` profile**

`profiles.js` exposes exactly:

```js
{
  name: 'document-only',
  grants: [
    { capability: 'document.read.self', resource: 'document:self' },
    { capability: 'document.compute', resource: 'document:self' },
    { capability: 'ephemeral.output', resource: 'execution:*' },
  ]
}
```

Unknown profiles throw an error with `code = 'unknown_profile'`.

- [ ] **Step 3: Implement request/grant/actor normalization**

`model.js` validates non-empty strings, supported lifetime values, `until` expiry requirements, and capability IDs through the registry. Keep context data inert. Freeze normalized top-level objects.

- [ ] **Step 4: Implement exact/trailing-wildcard resource matching**

Use only exact equality or one trailing `*` prefix:

```js
function resourceMatches(grantResource, requestedResource) {
  if (grantResource === requestedResource) return true
  if (!grantResource.endsWith('*')) return false
  return requestedResource.startsWith(grantResource.slice(0, -1))
}
```

No regex/glob expansion is introduced.

- [ ] **Step 5: Implement the capability session**

`createCapabilitySession({ profile = 'document-only', actor, grants = [], now, idFactory } = {})` must:

- merge profile grants with explicit grants without broadening them;
- `authorize(requestInput)` → allow/deny decision and ledger append;
- `require(requestInput)` → same decision, throwing `CapabilityDeniedError` on deny;
- consume only an explicit matching `once` grant after an allow;
- ignore expired `until` grants;
- expose `getAuditLedger()` as cloned/frozen evidence;
- expose `snapshot()` with profile, actor, and audit.

`CapabilityDeniedError` must set `code = 'capability_denied'` and retain `decision`.

- [ ] **Step 6: Run capability tests**

Expected: foundation/profile/grant/audit tests pass; document-runtime/MCP-map tests still fail because Tasks 3–4 are not implemented.

- [ ] **Step 7: Commit the authority core**

Commit registry/profile/model/session/index files only after the corresponding tests are green.

---

### Task 3: Add the canonical document-only AIMD-C runtime and route current callers through it

**Files:**
- Create: `src/capabilities/document-runtime.js`
- Modify: `src/preview.js`
- Modify: `mcp-tools.js`
- Test: `test/capability-foundation.test.mjs`

**Interfaces:**
- Consumes: `createCapabilitySession()` from Task 2 and existing `evaluateDocument(blocks, externalRefs)`.
- Produces: `evaluateDocumentInSandbox(blocks, options)`.

- [ ] **Step 1: Implement the wrapper with no host objects**

`evaluateDocumentInSandbox(blocks, options = {})` accepts only:

```js
{
  externalRefs = {},
  session,
  profile = 'document-only',
  grants = [],
  actor,
  requestedCapabilities = []
}
```

It requires these baseline requests before evaluation:

```text
document.read.self / document:self
document.compute / document:self
ephemeral.output / execution:aimdc
```

Then it requires every `requestedCapabilities` entry. Only after all required decisions allow does it call the existing low-level `evaluateDocument(blocks, externalRefs)`.

Return:

```js
{
  ...evaluateDocumentResult,
  sandbox: session.snapshot()
}
```

Do not add `fs`, `fetch`, `process`, `env`, OAuth, or connector arguments.

- [ ] **Step 2: Route browser preview through the wrapper**

Change only the import/call site:

```js
import { evaluateDocumentInSandbox } from './capabilities/document-runtime.js'
...
const aimdcDoc = evaluateDocumentInSandbox(pendingAimdcBlocks, { externalRefs: dynamicDoc.refs })
```

Keep Dynamic Logic transition handling unchanged.

- [ ] **Step 3: Route MCP `evaluate_aimdc` through the wrapper**

Replace direct `evaluateDocument(blocks)` use with the wrapper and add `sandbox` to the JSON result while preserving existing `blocks`, `results`, `issues`, and `ledger` fields.

- [ ] **Step 4: Run capability tests**

Expected: document-runtime tests pass; only MCP-map tests may remain red until Task 4.

- [ ] **Step 5: Commit document-only enforcement**

Commit wrapper + the two call-site changes after green tests.

---

### Task 4: Add transport-neutral MCP tool capability mapping

**Files:**
- Create: `src/capabilities/mcp-map.js`
- Test: `test/capability-foundation.test.mjs`

**Interfaces:**
- Consumes: `createCapabilityRequest()` from Task 2.
- Produces: `resolveMcpToolCapabilityRequests(toolName, args = {})`.

- [ ] **Step 1: Implement current tool mappings**

Map all current base/publication tools from the spec. Resource derivation:

```text
list_files     -> workspace:*
read_file      -> workspace:<path>
write_file     -> workspace:<path>
evaluate_aimdc -> document:self / execution:aimdc
validate_world_ir -> document:self
publication source tools -> document:self
render_document -> execution:publication
artifact/report -> artifact:<artifact_id or *>
```

Use `createCapabilityRequest()` for every returned request.

- [ ] **Step 2: Fail closed on unknown tool names**

Throw an error with `code = 'unknown_mcp_tool'`; never return `[]` for an unknown tool.

- [ ] **Step 3: Run capability tests**

Expected: `npm run test:capabilities` fully green.

- [ ] **Step 4: Commit MCP mapping**

No MCP transport enforcement is added in this task.

---

### Task 5: Document the security boundary and run full verification

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`
- Modify: `PROGRESS.md`

**Interfaces:**
- Documents the APIs and non-goals implemented by Tasks 2–4.

- [ ] **Step 1: Document `document-only` behavior**

README/Security text must state:

```text
AIMD-C document computation runs through the document-only capability profile.
The profile contains no workspace, network, process, host-environment, Google,
GitHub, OAuth-token, or other connector authority. External capabilities require
explicit grants through the capability core; provider credential brokerage is a
later layer and credentials are not passed into document computation.
```

Also state that current remote MCP bearer-token behavior is unchanged by PR-A; the new MCP mapping is metadata/control-plane groundwork for later authorization middleware.

- [ ] **Step 2: Record the implementation in changelog/progress**

Mention registry, actor/grant/audit model, document wrapper, MCP mapping, tests, and explicit non-goals.

- [ ] **Step 3: Run the PR workflow**

GitHub Actions must observe all of:

```text
npm run test:capabilities
npm run test:publication
npm run build
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```

All must be green. Do not claim completion from static inspection alone.

- [ ] **Step 4: Review the PR diff**

Check that no OAuth/provider credential code, arbitrary execution backend, transport-specific duplicate capability logic, or implicit read→write inheritance slipped into the branch.

- [ ] **Step 5: Mark the PR ready and prepare a downloadable branch archive**

Only after CI is green, update the PR body with verification evidence and create the user-facing ZIP from the exact PR head.
