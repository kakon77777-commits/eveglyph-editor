# MCP Delegated Connector Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow stdio and remote EveGlyph MCP servers to invoke the existing read-only GitHub and Google Drive connector operations through short-lived one-use delegation tickets, without exposing provider credentials or the persistent credential broker to MCP.

**Architecture:** One pure delegated-operation contract defines tool/provider/operation/capability/resource normalization. The credential-owning Vite process owns one delegation broker and local IPC server, issues tickets only after current connector grants authorize the exact resource, and re-runs live connector authorization when a ticket is consumed. MCP receives only a configured local IPC endpoint plus a raw one-use ticket supplied as the tool argument; it never imports keyring, persistent-broker, OAuth, or provider credential code.

**Tech Stack:** Node.js 20+, ESM, `node:net`, `node:crypto`, `node:test`, MCP SDK 1.29+, Zod 4, Vite 6.

**Spec:** `docs/superpowers/specs/2026-08-28-mcp-delegated-connector-operations-design.md`

## Global Constraints

- Stacked base is PR-D exact head `e94c54f297d319e03f729c9931f7768c08e198f4`.
- Only three read-only delegated tools are in scope: `github_read_file_delegated`, `google_drive_list_files_delegated`, `google_drive_read_file_delegated`.
- A delegated execution requires both a valid delegation ticket and the matching live connector-session grant.
- Restored provider identity continues to restore zero connector-session grants.
- Raw provider credentials, credential ids, keyring objects, persistent broker objects, OAuth refresh helpers, and serialized credential envelopes must never enter MCP.
- Raw delegation tickets are one-use / 60 seconds by default and are not persisted or logged by EveGlyph.
- IPC input/resource substitution must be defeated by server-side canonical normalization and resource recomputation.
- Without `EVEGLYPH_DELEGATION_ENDPOINT`, delegated connector MCP tools are not registered; existing MCP tools remain unchanged.
- PR-E does not add connector writes, long-lived MCP broker sessions, remote TCP delegation, remote MCP OAuth hardening, or Wasmtime/WASI.

---

### Task 1: Canonical delegated-operation contracts and MCP mapping

**Files:**
- Create: `server/connectors/delegated-contracts.js`
- Modify: `server/connectors/github-service.js`
- Modify: `server/connectors/google-drive-service.js`
- Modify: `src/capabilities/mcp-map.js`
- Create: `test/mcp-delegated-contracts.test.mjs`

**Interfaces:**
- Produces `DELEGATED_TOOL_NAMES: readonly string[]`.
- Produces `resolveDelegatedOperation(toolName, input) -> { tool, provider, operation, capability, resource, input }`.
- Produces provider-safe normalization helpers reused by GitHub/Google services.
- `resolveMcpToolCapabilityRequests()` uses the canonical delegated contract for the three new MCP tool names.

- [ ] **Step 1: Write the failing contract/mapping tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDelegatedOperation } from '../server/connectors/delegated-contracts.js'
import { resolveMcpToolCapabilityRequests } from '../src/capabilities/mcp-map.js'

test('GitHub delegated read canonicalizes exact file authority', () => {
  const op = resolveDelegatedOperation('github_read_file_delegated', {
    repository: 'owner/repo', path: 'docs/readme.md', ref: 'main',
  })
  assert.equal(op.provider, 'github')
  assert.equal(op.operation, 'read-file')
  assert.equal(op.capability, 'connector.github.repository.contents.read')
  assert.equal(op.resource, 'github:repository:owner/repo:contents:docs/readme.md')
  assert.deepEqual(op.input, { repository: 'owner/repo', path: 'docs/readme.md', ref: 'main' })
})

test('Google delegated operations use list and exact-file resources', () => {
  assert.equal(
    resolveDelegatedOperation('google_drive_list_files_delegated', {}).resource,
    'google:drive:files:list',
  )
  assert.equal(
    resolveDelegatedOperation('google_drive_read_file_delegated', { file_id: '1AbCdEfGhIjK' }).resource,
    'google:drive:file:1AbCdEfGhIjK',
  )
})

test('MCP mapping derives the same exact delegated resources', () => {
  const [request] = resolveMcpToolCapabilityRequests('github_read_file_delegated', {
    repository: 'owner/repo', path: 'README.md', delegation_ticket: 'opaque',
  })
  assert.equal(request.capability, 'connector.github.repository.contents.read')
  assert.equal(request.resource, 'github:repository:owner/repo:contents:README.md')
})
```

Also assert invalid repository/path/file id, unknown delegated tool, and a `delegation_ticket` value do not affect resource construction.

- [ ] **Step 2: Run RED**

Run:
```sh
node --test test/mcp-delegated-contracts.test.mjs
```
Expected: FAIL because `delegated-contracts.js` and mappings do not exist.

- [ ] **Step 3: Implement the pure canonical contract**

```js
const SPECS = Object.freeze({
  github_read_file_delegated: Object.freeze({
    provider: 'github',
    operation: 'read-file',
    capability: 'connector.github.repository.contents.read',
    normalize(input = {}) {
      const repository = normalizeGitHubRepository(input.repository)
      const path = normalizeGitHubPath(input.path)
      const ref = normalizeGitHubRef(input.ref)
      return Object.freeze({
        input: Object.freeze({ repository, path, ...(ref ? { ref } : {}) }),
        resource: `github:repository:${repository}:contents:${path}`,
      })
    },
  }),
  google_drive_list_files_delegated: Object.freeze({
    provider: 'google',
    operation: 'list-files',
    capability: 'connector.google.drive.metadata.list',
    normalize(input = {}) {
      const pageToken = normalizeGooglePageToken(input.page_token)
      return Object.freeze({
        input: Object.freeze(pageToken ? { page_token: pageToken } : {}),
        resource: 'google:drive:files:list',
      })
    },
  }),
  google_drive_read_file_delegated: Object.freeze({
    provider: 'google',
    operation: 'read-file',
    capability: 'connector.google.drive.file.read',
    normalize(input = {}) {
      const fileId = normalizeGoogleFileId(input.file_id)
      return Object.freeze({
        input: Object.freeze({ file_id: fileId }),
        resource: `google:drive:file:${fileId}`,
      })
    },
  }),
})
```

Move the current GitHub repository/path/ref and Google file-id/page-token normalization semantics into this pure module, then import those helpers from the provider services so one source defines the resource vocabulary.

- [ ] **Step 4: Extend `mcp-map.js` minimally**

For each delegated tool, call `resolveDelegatedOperation(toolName, args)` and return one `createCapabilityRequest()` using its canonical capability/resource, lifetime `once`, and `context: { tool: toolName, delegated: true }`.

- [ ] **Step 5: Run GREEN and existing capability regression**

Run:
```sh
node --test test/mcp-delegated-contracts.test.mjs
npm run test:capabilities
npm run test:github-connector
npm run test:google-connector
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```sh
git add server/connectors/delegated-contracts.js server/connectors/github-service.js server/connectors/google-drive-service.js src/capabilities/mcp-map.js test/mcp-delegated-contracts.test.mjs
git commit -m "feat: add canonical MCP delegated connector contracts"
```

### Task 2: Grant-gated delegation issuance and local HTTP issuance routes

**Files:**
- Modify: `server/connectors/github-service.js`
- Modify: `server/connectors/google-drive-service.js`
- Modify: `server/connectors/github-http.js`
- Modify: `server/connectors/google-drive-http.js`
- Modify: `vite-github-connector.js`
- Modify: `vite-google-drive-connector.js`
- Create: `test/connector-delegation-issuance.test.mjs`

**Interfaces:**
- Services accept optional `delegationBroker`.
- GitHub adds `issueRepositoryFileDelegation({ repository, path, ref? })`.
- Google adds `issueMetadataListDelegation({ pageToken? })` and `issueFileReadDelegation({ fileId })`.
- Successful issuance returns `{ ticket, delegation }` from the existing PR-D broker; raw provider credentials are absent.
- Bridges accept optional `delegationBroker` and expose three local-only issuance routes.

- [ ] **Step 1: Write issuance RED tests**

```js
await assert.rejects(
  () => github.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'README.md' }),
  { code: 'capability_denied' },
)

github.grantRepositoryRead({ repository: 'owner/repo' })
const issued = github.issueRepositoryFileDelegation({ repository: 'owner/repo', path: 'README.md' })
assert.match(issued.ticket, /^[A-Za-z0-9_-]{40,}$/)
assert.equal(issued.delegation.resource, 'github:repository:owner/repo:contents:README.md')
assert.equal(JSON.stringify(issued.delegation).includes(issued.ticket), false)
```

Repeat for Google metadata and exact-file issuance; assert repo A cannot issue repo B and file A cannot issue file B. Assert restored identity without new grants cannot issue tickets.

- [ ] **Step 2: Run RED**

Run:
```sh
node --test test/connector-delegation-issuance.test.mjs
```
Expected: FAIL because issuance methods and broker injection do not exist.

- [ ] **Step 3: Implement issuance after a live capability decision**

Use a `connector-session` capability session with the current actor/grants and call `.require(...)` for the canonical delegated operation resource. Only after the allow decision call:

```js
return delegationBroker.issue({
  provider: operation.provider,
  operation: operation.operation,
  capability: operation.capability,
  resource: operation.resource,
  actor: actor.humanPrincipal,
  ttlMs: 60_000,
  maxUses: 1,
})
```

If no delegation broker was injected, throw stable `delegation_unavailable` rather than creating a private broker.

- [ ] **Step 4: Add stable HTTP controller methods and route wiring**

Controller methods:
```js
issueDelegatedRead({ repository, path, ref })
issueDelegatedList({ pageToken })
issueDelegatedFileRead({ fileId })
```

Routes:
```text
POST /api/connectors/github/delegation/read-file
POST /api/connectors/google/delegation/list-files
POST /api/connectors/google/delegation/read-file
```

Extend public error maps with `delegation_unavailable` (503) and existing capability/input error codes only. Do not log ticket values.

- [ ] **Step 5: Run GREEN and HTTP regressions**

Run:
```sh
node --test test/connector-delegation-issuance.test.mjs
npm run test:github-connector
npm run test:google-connector
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```sh
git add server/connectors/github-service.js server/connectors/google-drive-service.js server/connectors/github-http.js server/connectors/google-drive-http.js vite-github-connector.js vite-google-drive-connector.js test/connector-delegation-issuance.test.mjs
git commit -m "feat: issue grant-scoped connector delegations"
```

### Task 3: Credential-owning delegated-operation runtime and live re-authorization

**Files:**
- Create: `server/connectors/delegation-runtime.js`
- Modify: `server/credentials/delegation-ipc.js`
- Modify: `vite-github-connector.js`
- Modify: `vite-google-drive-connector.js`
- Modify: `vite.config.js`
- Create: `test/connector-delegation-runtime.test.mjs`

**Interfaces:**
- `createConnectorDelegationRuntime({ endpoint?, now?, randomBytesImpl? })` returns `{ broker, endpoint, attachGitHubService(service), attachGoogleService(service), start(), stop() }`.
- One runtime owns exactly one `createDelegationBroker()` and one `createDelegationIpcServer()`.
- Provider bridges receive `delegationRuntime`, attach their live services, and use `delegationRuntime.broker` for issuance.
- Handler execution recomputes canonical operation/resource from `input` and exact-matches the consumed delegation record before calling the live service.

- [ ] **Step 1: Write substitution/live-grant RED tests**

```js
const ticketA = issueFor('github_read_file_delegated', { repository: 'o/r', path: 'a.md' })
const response = await invokeIpc({
  ticket: ticketA,
  provider: 'github',
  operation: 'read-file',
  capability: 'connector.github.repository.contents.read',
  resource: 'github:repository:o/r:contents:a.md',
  input: { repository: 'o/r', path: 'b.md' },
})
assert.equal(response.ok, false)
assert.equal(response.error.code, 'delegation_mismatch')
assert.equal(githubFetchCount, 0)
```

Also mint a valid ticket, disconnect/remove the live grant before invocation, and assert invocation fails with a stable authorization/not-connected error and no provider fetch.

- [ ] **Step 2: Run RED**

Run:
```sh
node --test test/connector-delegation-runtime.test.mjs
```
Expected: FAIL because the connector delegation runtime does not exist.

- [ ] **Step 3: Extend IPC handler contract to preserve safe handler errors**

`delegation-ipc.js` currently maps unknown handler errors to `ipc_internal_error`. Extend its stable allow-list/messages with connector-safe codes required by live re-authorization (`capability_denied`, `github_not_connected`, `google_drive_not_connected`, `github_reauthentication_required`, `google_reauthentication_required`, `github_api_error`, `google_drive_api_error`, input/size/encoding errors). Continue redacting unknown errors.

- [ ] **Step 4: Implement runtime handlers**

For each `${provider}:${operation}` handler:

```js
const operation = resolveDelegatedOperation(toolName, input)
if (
  delegation.provider !== operation.provider ||
  delegation.operation !== operation.operation ||
  delegation.capability !== operation.capability ||
  delegation.resource !== operation.resource
) {
  throw codedError('delegation_mismatch', 'delegation input does not match ticket authority')
}
return service.readRepositoryFile(operation.input)
```

Use the corresponding Google methods. Do not expose service/broker references on public JSON responses.

- [ ] **Step 5: Wire Vite lifecycle**

In `vite.config.js` create one `delegationRuntime`. Inject it into GitHub/Google bridges. Add a tiny Vite lifecycle plugin from the runtime (or an exported `vitePlugin()`) that starts the IPC server in `configureServer` and stops it on `server.httpServer.close`.

- [ ] **Step 6: Run GREEN and credential broker regression**

Run:
```sh
node --test test/connector-delegation-runtime.test.mjs
npm run test:credential-broker
npm run test:github-connector
npm run test:google-connector
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```sh
git add server/connectors/delegation-runtime.js server/credentials/delegation-ipc.js vite-github-connector.js vite-google-drive-connector.js vite.config.js test/connector-delegation-runtime.test.mjs
git commit -m "feat: execute delegated connector operations locally"
```

### Task 4: MCP local IPC client and delegated tool registration

**Files:**
- Create: `server/credentials/delegation-ipc-client.js`
- Create: `mcp-connectors.js`
- Modify: `mcp-server-factory.js`
- Modify: `mcp-server.js`
- Modify: `mcp-server-remote.js`
- Create: `test/mcp-delegated-connectors.test.mjs`

**Interfaces:**
- `invokeDelegatedOperation({ endpoint, operation, ticket, maxResponseBytes? }) -> result`.
- `registerDelegatedConnectorMcp(server, { delegationEndpoint })` registers exactly three tools.
- `createMcpServer(workspaceRoot, { delegationEndpoint = null } = {})` registers connector tools only for a non-empty endpoint.
- Both MCP entrypoints use `process.env.EVEGLYPH_DELEGATION_ENDPOINT || null`.

- [ ] **Step 1: Write MCP RED integration tests**

Start a real local PR-D IPC server with fake handlers, then start the stdio MCP server with `EVEGLYPH_DELEGATION_ENDPOINT` set and call `github_read_file_delegated`. Assert one successful result, then a second use of the same ticket fails. Also assert no endpoint means the tool is absent while `read_file`/publication tools remain present.

The fake IPC handler response should include normal file content but never a token.

- [ ] **Step 2: Run RED**

Run:
```sh
node --test test/mcp-delegated-connectors.test.mjs
```
Expected: FAIL because IPC client/tool registration does not exist.

- [ ] **Step 3: Implement bounded local IPC client**

Use `node:net` only. Send one JSON object followed by `socket.end()`. Bound response bytes (default 2 MiB, hard reject beyond it). Parse one JSON response. On `ok:false`, throw an Error using only returned stable `error.code` / `error.message`. Normalize connect failures to `delegation_endpoint_unavailable`. Do not log request/ticket.

- [ ] **Step 4: Register three MCP tools**

Each Zod schema includes `delegation_ticket` plus the provider inputs. Resolve the canonical operation first, then call the IPC client with:

```js
{
  ticket: delegation_ticket,
  provider: operation.provider,
  operation: operation.operation,
  capability: operation.capability,
  resource: operation.resource,
  input: operation.input,
}
```

The MCP result returns only the delegated operation result. Never echo `delegation_ticket`.

- [ ] **Step 5: Compose both transports**

`mcp-server-factory.js` keeps base/publication composition and conditionally calls `registerDelegatedConnectorMcp`. `mcp-server.js` and `mcp-server-remote.js` pass the environment endpoint to the factory.

- [ ] **Step 6: Run GREEN plus existing MCP tests**

Run:
```sh
node --test test/mcp-delegated-connectors.test.mjs
npm run test:capabilities
npm run test:publication
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```sh
git add server/credentials/delegation-ipc-client.js mcp-connectors.js mcp-server-factory.js mcp-server.js mcp-server-remote.js test/mcp-delegated-connectors.test.mjs
git commit -m "feat: add delegated connector MCP tools"
```

### Task 5: Remote MCP endpoint injection and Settings ticket issuance UI

**Files:**
- Modify: `vite-agent-bridge.js`
- Modify: `src/githubsettings.js`
- Modify: `src/googledrivesettings.js`
- Modify: `vite-github-settings-ui.js`
- Modify: `vite-google-drive-settings-ui.js`
- Modify: `test/github-connector-ui-contract.test.mjs`
- Modify: `test/google-drive-ui-contract.test.mjs`
- Create: `test/mcp-delegation-endpoint-wiring.test.mjs`

**Interfaces:**
- `agentBridge({ delegationEndpoint = null } = {})` injects only `EVEGLYPH_DELEGATION_ENDPOINT` into the spawned remote MCP child when present.
- Browser exports `githubIssueMcpReadTicket()`, `googleIssueMcpListTicket()`, `googleIssueMcpFileReadTicket()`.
- Raw ticket is written only to a live DOM `<pre>`/text node and explicit clipboard action.

- [ ] **Step 1: Write endpoint/UI RED tests**

Assert remote MCP spawn environment contains the endpoint but no provider token/credential id/keyring data. Static UI contracts require three issue buttons, ticket display containers, no token/client-secret fields, and browser modules must not write ticket values to `localStorage` / `sessionStorage`.

- [ ] **Step 2: Run RED**

Run:
```sh
node --test test/mcp-delegation-endpoint-wiring.test.mjs
npm run test:github-connector
npm run test:google-connector
```
Expected: the new endpoint/UI contracts FAIL.

- [ ] **Step 3: Inject endpoint into remote child only**

When spawning `mcp-server-remote.js`, build:

```js
const childEnv = {
  ...process.env,
  EVEGLYPH_MCP_TOKEN: token,
  EVEGLYPH_MCP_PORT: String(port),
  ...(delegationEndpoint ? { EVEGLYPH_DELEGATION_ENDPOINT: delegationEndpoint } : {}),
}
```

Never inject access/refresh tokens or credential ids.

- [ ] **Step 4: Add GitHub ticket UI**

Add `Issue MCP read ticket` beside the existing read controls and a credential-warning `<pre id="s-github-delegation-result">`. Browser action POSTs the current repository/path/ref to `delegation/read-file` and renders ticket, expiry, and resource using `textContent`. Copy requires an explicit button click; do not persist the ticket.

- [ ] **Step 5: Add Google ticket UI**

Add `Issue MCP list ticket` after metadata grant/list controls and `Issue MCP file-read ticket` beside selected-file read. Render newly issued tickets in `s-google-delegation-result` using `textContent` only.

- [ ] **Step 6: Run GREEN and production build**

Run:
```sh
node --test test/mcp-delegation-endpoint-wiring.test.mjs
npm run test:github-connector
npm run test:google-connector
npm run build
node scripts/verify_github_connector_build.mjs
node scripts/verify_google_drive_connector_build.mjs
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```sh
git add vite-agent-bridge.js src/githubsettings.js src/googledrivesettings.js vite-github-settings-ui.js vite-google-drive-settings-ui.js test/github-connector-ui-contract.test.mjs test/google-drive-ui-contract.test.mjs test/mcp-delegation-endpoint-wiring.test.mjs
git commit -m "feat: expose one-use MCP delegation issuance"
```

### Task 6: Boundary verifier, CI, documentation and exact-head packaging

**Files:**
- Modify: `scripts/verify_credential_boundary.mjs`
- Create: `scripts/verify_mcp_delegation_boundary.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/publication-runtime.yml`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Create: `docs/MCP-DELEGATED-CONNECTORS.md`

**Interfaces:**
- `npm run test:mcp-delegation` runs all new PR-E suites.
- New verifier proves MCP does not import keyring/persistent-broker/provider OAuth/network connector code and does not echo delegation tickets.
- Final Actions artifact name: `eveglyph-mcp-delegated-connector-operations`.

- [ ] **Step 1: Add package script and CI branch**

Add:
```json
"test:mcp-delegation": "node --test test/mcp-delegated-contracts.test.mjs test/connector-delegation-issuance.test.mjs test/connector-delegation-runtime.test.mjs test/mcp-delegated-connectors.test.mjs test/mcp-delegation-endpoint-wiring.test.mjs"
```

Add `feat/mcp-delegated-connector-operations` to workflow push branches and run `npm run test:mcp-delegation` before provider regressions.

- [ ] **Step 2: Implement dedicated boundary verifier**

Scan MCP source files for forbidden imports/identifiers:
```text
@napi-rs/keyring
system-keyring-vault
persistent-broker
accessToken
refreshToken
clientSecret
Authorization: `Bearer
createGitHubAppOAuth
createGoogleOAuth
```

Allow only `delegation-ipc-client.js`, `delegated-contracts.js`, and MCP registration as connector-crossing modules. Scan browser modules for storage writes involving delegation ticket. Scan built assets to ensure `@napi-rs/keyring`, `credentialEnvelope`, `accessToken`, and `refreshToken` are absent.

- [ ] **Step 3: Document operator flow**

`docs/MCP-DELEGATED-CONNECTORS.md` must document:
```text
npm run dev
→ connect provider
→ explicit session grant
→ issue one-use MCP ticket
→ configure EVEGLYPH_DELEGATION_ENDPOINT for standalone stdio MCP, or use Vite-spawned remote MCP
→ call delegated MCP tool with the ticket
```

State plainly that MCP-host logs may record tool arguments, tickets expire/use once, no provider credential crosses IPC, and `npm run dev` must remain alive.

Update README/SECURITY to supersede PR-D's “not wired yet” statement with the exact PR-E bounded delegated-operation model.

- [ ] **Step 4: Run exact-head final verification**

Run all:
```sh
npm ci
npm run test:mcp-delegation
npm run test:credential-broker
node --test test/credential-vault-http.test.mjs
npm run test:google-connector
npm run test:github-connector
npm run test:capabilities
npm run test:publication
npm run build
node scripts/verify_github_connector_build.mjs
node scripts/verify_google_drive_connector_build.mjs
node scripts/verify_credential_boundary.mjs
node scripts/verify_mcp_delegation_boundary.mjs
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```
Expected: all exit 0.

- [ ] **Step 5: Package only after all gates pass**

```sh
git archive --format=zip --output=eveglyph-mcp-delegated-connector-operations.zip HEAD
```

Actions uploads only that exact-head archive, artifact name `eveglyph-mcp-delegated-connector-operations`.

- [ ] **Step 6: Commit**

```sh
git add scripts/verify_credential_boundary.mjs scripts/verify_mcp_delegation_boundary.mjs package.json .github/workflows/publication-runtime.yml README.md SECURITY.md docs/MCP-DELEGATED-CONNECTORS.md
git commit -m "docs: close MCP delegated connector boundary"
```

### Task 7: Final review, stacked PR and user artifact

**Files:** no production changes unless final verification reveals a blocker.

- [ ] **Step 1: Compare exact stacked base to final head**

Run/inspect equivalent of:
```sh
git diff --stat e94c54f297d319e03f729c9931f7768c08e198f4..HEAD
```

Review for connector writes, credential imports in MCP, persistent ticket storage, token logging, scope creep, and temporary scaffolding.

- [ ] **Step 2: Confirm final workflow is GREEN on exact HEAD**

Record workflow run id, exact head SHA, artifact id, Actions artifact digest, and inner `git archive` SHA-256 in PR metadata only. Do not create an exact-head validation file inside the source tree.

- [ ] **Step 3: Create stacked PR**

```text
head: feat/mcp-delegated-connector-operations
base: feat/persistent-credential-delegation-broker
```

PR body must explicitly state that PR-D remains open/unmerged and that PR-E does not include Wasmtime or write operations.

- [ ] **Step 4: Download and verify Actions artifact**

Verify outer Actions digest, inner ZIP integrity and SHA-256. Extract/copy the inner exact-head source ZIP to the user-visible artifact path without modifying its bytes.

- [ ] **Step 5: Deliver**

Provide PR link, exact head, test counts/gates, Actions artifact id/digest, exact source ZIP SHA-256, and sandbox download links.
