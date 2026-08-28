# Persistent Credential Vault & Delegation Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist GitHub/Google connector credentials in the OS keyring while keeping connector grants session-only, and add short-lived hash-stored delegation tickets plus a local IPC operation boundary that never exposes raw provider tokens.

**Architecture:** Keep the existing memory broker as the in-process hot cache. Add an OS-keyring vault adapter and a persistent broker wrapper with exact-id restoration. Inject one shared broker into GitHub and Google connector bridges. Add a separate delegation-ticket broker and local `net` IPC operation broker; PR-D does not register MCP connector operations yet.

**Tech Stack:** Node.js 20+, ESM, `@napi-rs/keyring`, Node `crypto`, Node `net`, `node:test`, Vite 6.

**Spec:** `docs/superpowers/specs/2026-08-28-persistent-credential-delegation-broker-design.md`

## Global Constraints

- `system` is the default credential store; `memory` requires explicit operator configuration.
- Never persist EveGlyph session grants.
- Never return access tokens, refresh tokens, client secrets or serialized credential envelopes to browser/MCP/document/public APIs.
- System-keyring errors fail closed; no implicit plaintext or memory downgrade.
- Delegation ticket hard TTL is 300 seconds; default 60 seconds.
- Delegation default use count is 1; hard maximum is 10.
- IPC is local only and has a 16 KiB request limit.
- PR-D does not wire Google/GitHub delegated operations into MCP.

---

### Task 1: Keyring vault and exact-id memory restore

**Files:**
- Modify: `server/credentials/memory-broker.js`
- Create: `server/credentials/system-keyring-vault.js`
- Test: `test/persistent-credential-broker.test.mjs`

**Interfaces:**
- `memory.store({ credentialId?, provider, account, accessToken, accessExpiresAt?, refreshToken?, refreshExpiresAt? }) -> credentialId`
- `createSystemKeyringVault({ EntryClass?, service? }) -> { putCredential, getCredential, deleteCredential, setActiveCredential, getActiveCredential, clearActiveCredential }`

- [ ] **Step 1: Write RED tests**

```js
const id = broker.store({ credentialId: 'cred-fixed', provider: 'github', account: { id: 1 }, accessToken: 'secret' })
assert.equal(id, 'cred-fixed')

vault.putCredential({ id: 'cred-1', provider: 'google', account: { sub: 'u' }, accessToken: 'a' })
assert.equal(vault.getCredential('cred-1').accessToken, 'a')
vault.setActiveCredential('google', 'cred-1')
assert.equal(vault.getActiveCredential('google'), 'cred-1')
```

- [ ] **Step 2: Run RED**

Run: `node --test test/persistent-credential-broker.test.mjs`
Expected: FAIL because exact-id restore and system keyring vault do not exist.

- [ ] **Step 3: Implement minimal vault**

Store JSON only through injected/system `Entry(service, account)` objects. Normalize backend exceptions to `credential_vault_unavailable`; malformed stored JSON becomes `credential_vault_corrupt` without including stored secret text in the message.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/persistent-credential-broker.test.mjs`
Expected: vault tests PASS.

- [ ] **Step 5: Commit**

```sh
git add server/credentials/memory-broker.js server/credentials/system-keyring-vault.js test/persistent-credential-broker.test.mjs
git commit -m "feat: add system keyring credential vault"
```

### Task 2: Persistent broker and storage-mode runtime

**Files:**
- Create: `server/credentials/persistent-broker.js`
- Create: `server/credentials/runtime.js`
- Test: `test/persistent-credential-broker.test.mjs`

**Interfaces:**
- `createPersistentCredentialBroker({ vault, memoryBroker? })`
- adds `restoreActive(provider)` while preserving existing broker API.
- `createCredentialRuntime({ mode?, EntryClass? }) -> { mode, broker, persistent }`

- [ ] **Step 1: Add RED tests**

```js
const id = broker.store({ provider: 'google', account: { sub: 'u' }, accessToken: 'a', refreshToken: 'r' })
assert.equal(vault.getActiveCredential('google'), id)

const restarted = createPersistentCredentialBroker({ vault, memoryBroker: createMemoryCredentialBroker() })
const restored = restarted.restoreActive('google')
assert.equal(restored.credential_id, id)
assert.equal(await restarted.withCredential(id, c => c.refreshToken), 'r')
```

Also assert `createCredentialRuntime({ mode: 'unknown' })` fails and system-vault failure never returns a memory broker silently.

- [ ] **Step 2: Run RED**

Run: `node --test test/persistent-credential-broker.test.mjs`
Expected: FAIL because persistent wrapper/runtime do not exist.

- [ ] **Step 3: Implement minimal broker/runtime**

Persist after every successful store/replace; delete persisted material on remove; clear stale active pointer on missing credential; do not expose an enumeration API.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/persistent-credential-broker.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add server/credentials/persistent-broker.js server/credentials/runtime.js test/persistent-credential-broker.test.mjs
git commit -m "feat: add persistent credential broker runtime"
```

### Task 3: Restore GitHub and Google identity with zero grants

**Files:**
- Modify: `server/connectors/github-service.js`
- Modify: `server/connectors/google-drive-service.js`
- Modify: `vite-github-connector.js`
- Modify: `vite-google-drive-connector.js`
- Modify: `vite.config.js`
- Test: `test/connector-persistent-restore.test.mjs`

**Interfaces:**
- services add `restoreAuth({ credentialId }) -> status`
- bridges accept injected `{ broker }`
- Vite config creates one shared credential runtime and passes the broker to both bridges.

- [ ] **Step 1: Write RED tests**

```js
const status = service.restoreAuth({ credentialId })
assert.equal(status.connected, true)
assert.deepEqual(status.grants, [])
await assert.rejects(() => service.readRepositoryFile(...), { code: 'capability_denied' })
```

Repeat for Google and assert metadata listing is denied until a fresh session grant is made.

- [ ] **Step 2: Run RED**

Run: `node --test test/connector-persistent-restore.test.mjs`
Expected: FAIL because restoration entry points/injection do not exist.

- [ ] **Step 3: Implement restoration and shared broker injection**

Provider mismatch must fail closed. Restoration recreates actor identity from persisted public account metadata and always resets grants to `[]`.

- [ ] **Step 4: Run connector regression**

Run:
```sh
npm run test:github-connector
npm run test:google-connector
node --test test/connector-persistent-restore.test.mjs
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```sh
git add server/connectors vite-github-connector.js vite-google-drive-connector.js vite.config.js test/connector-persistent-restore.test.mjs
git commit -m "feat: restore connector identity from persistent vault"
```

### Task 4: Delegation ticket broker

**Files:**
- Create: `server/credentials/delegation-broker.js`
- Test: `test/delegation-broker.test.mjs`

**Interfaces:**
- `createDelegationBroker({ now?, randomBytesImpl? })`
- `issue({ provider, operation, capability, resource, actor, ttlMs?, maxUses? }) -> { ticket, delegation }`
- `consume({ ticket, provider, operation, capability, resource }) -> delegation`
- `revoke(ticket) -> boolean`
- `listPublic() -> delegation[]` with no raw ticket.

- [ ] **Step 1: Write RED tests**

```js
const issued = broker.issue({ provider: 'github', operation: 'read-file', capability: 'connector.github.repository.contents.read', resource: 'github:repository:o/r:contents:a.md', actor: 'github:user:1' })
assert.equal(issued.ticket.length > 20, true)
assert.equal(JSON.stringify(broker.listPublic()).includes(issued.ticket), false)
assert.throws(() => broker.consume({ ...request, resource: 'other' }), { code: 'delegation_mismatch' })
```

Add expiry, revoke, max-use and exhausted-ticket cases.

- [ ] **Step 2: Run RED**

Run: `node --test test/delegation-broker.test.mjs`
Expected: FAIL because broker does not exist.

- [ ] **Step 3: Implement hash-only ticket store**

Generate 32 random bytes as base64url; hash ticket using SHA-256 before Map lookup/storage; never store the raw ticket inside the delegation record.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/delegation-broker.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add server/credentials/delegation-broker.js test/delegation-broker.test.mjs
git commit -m "feat: add short-lived delegation tickets"
```

### Task 5: Local delegation IPC operation broker

**Files:**
- Create: `server/credentials/delegation-ipc.js`
- Test: `test/delegation-ipc.test.mjs`

**Interfaces:**
- `createDelegationIpcServer({ delegationBroker, handlers, endpoint?, maxRequestBytes? })`
- `start() -> endpoint`
- `stop()`
- handler key: `${provider}:${operation}`
- each handler receives `{ delegation, input }` after successful ticket consumption.

- [ ] **Step 1: Write RED integration tests**

Start the server on a temporary Unix socket in CI, issue a one-use ticket, send one newline-delimited JSON `invoke`, and assert the fake handler executes once. A second invoke must fail as exhausted. Assert oversized and malformed requests fail without handler execution.

- [ ] **Step 2: Run RED**

Run: `node --test test/delegation-ipc.test.mjs`
Expected: FAIL because IPC server does not exist.

- [ ] **Step 3: Implement minimal local IPC**

Use `node:net`. Buffer at most 16 KiB. Support only `method: "invoke"`. Consume the ticket before looking up/executing the registered operation handler. Map internal errors to stable public codes and never serialize error stacks or credential objects.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/delegation-ipc.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add server/credentials/delegation-ipc.js test/delegation-ipc.test.mjs
git commit -m "feat: add local delegated operation IPC"
```

### Task 6: Dependency, CI, documentation and final artifact

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/publication-runtime.yml`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Create: `docs/CREDENTIAL-VAULT-AND-DELEGATION.md`
- Create: `scripts/verify_credential_boundary.mjs`

- [ ] **Step 1: Add `@napi-rs/keyring` and update lockfile**

Use current maintained release line and verify `npm ci` on Node 20.

- [ ] **Step 2: Add CI gates**

Add:
```sh
npm run test:credential-broker
node scripts/verify_credential_boundary.mjs
```

The verifier must fail if browser/MCP/document source imports system-keyring internals, if raw credential property names appear in public Settings code, or if package build leaks credential envelopes.

- [ ] **Step 3: Document operator behavior**

Document `EVEGLYPH_CREDENTIAL_STORE=system|memory`, OS-keyring default, restored identity with zero grants, delegation ticket bounds, and the explicit statement that PR-D does not yet give MCP a connector operation.

- [ ] **Step 4: Run exact-head verification**

Run all of:
```sh
npm ci
npm run test:credential-broker
npm run test:google-connector
npm run test:github-connector
npm run test:capabilities
npm run test:publication
npm run build
node scripts/verify_github_connector_build.mjs
node scripts/verify_google_drive_connector_build.mjs
node scripts/verify_credential_boundary.mjs
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```
Expected: all exit 0.

- [ ] **Step 5: Package exact head**

```sh
git archive --format=zip --output=eveglyph-persistent-credential-delegation-broker.zip HEAD
```

Upload via Actions only after every preceding gate passes.
