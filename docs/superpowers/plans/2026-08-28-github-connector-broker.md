# EveGlyph GitHub Connector + Credential Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local GitHub App user-OAuth connector whose credentials stay server-side and whose repository reads require an explicit EveGlyph capability grant.

**Architecture:** A Node-only credential/OAuth subsystem owns GitHub secrets and token lifecycle. A GitHub connector service binds GitHub identity to the PR-A actor/grant/session model and exposes only repository-scoped text-file reads. The Vite bridge exposes redacted localhost endpoints; Settings provides Connect/Disconnect, explicit repository read grant, and read-only file preview controls.

**Tech Stack:** Node.js 18+ ES modules, Node `crypto`, Node built-in test runner, native `fetch`, existing Vite dev bridge, existing EveGlyph capability core, GitHub App user access token OAuth + PKCE.

**Spec:** `docs/superpowers/specs/2026-08-28-github-connector-broker-design.md`

## Global Constraints

- This is a stacked branch from PR #7 head `34acbcc37325b4349e9758d0542c4c9250540bc8`; do not merge or rewrite PR #7.
- OAuth authentication MUST NOT automatically grant repository read authority.
- GitHub client secret, access token, refresh token, OAuth code, and PKCE verifier MUST remain Node-side only.
- GitHub credentials MUST NOT be stored in browser storage, workspace files, `.eveglyph/`, Monitor payloads, MCP payloads, or Git.
- GitHub repository content reads require `connector.github.repository.contents.read` on `github:repository:<owner>/<repo>:contents:<path>`.
- Explicit read grants are session-only and repository-scoped.
- No GitHub write API or write UI is added in this PR.
- The first credential broker is process-scoped; server restart requires re-authentication.
- MCP processes do not receive or share this credential broker in PR-B.
- OAuth pending state is one-time and expires after 10 minutes.
- Expiring access tokens refresh when within 30 seconds of expiry; refresh failure fails closed.
- GitHub Contents text decode is capped at 1 MiB.
- New behavior follows observed RED → GREEN → full regression verification.

---

### Task 1: Add RED GitHub connector contract tests and stacked-branch CI

**Files:**
- Create: `test/github-credential-broker.test.mjs`
- Create: `test/github-connector.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- Consumes: PR-A `createActorContext`, `createGrant`, `createCapabilitySession`, capability registry.
- Produces: executable contracts for `server/credentials/memory-broker.js`, `server/connectors/github-app.js`, and `server/connectors/github-service.js`.

- [ ] **Step 1: Write `test/github-credential-broker.test.mjs` before production modules exist**

The test imports the future modules through an explicit helper so missing modules are the expected RED cause:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function requireModule(path, label) {
  try { return await import(path) }
  catch (error) { assert.fail(`${label} is not implemented: ${error?.message || error}`) }
}
```

Cover these behaviors as separate tests:

```text
broker public description never exposes accessToken/refreshToken
broker remove makes the handle inaccessible
PKCE authorization URL contains client_id, redirect_uri, state, S256 challenge
OAuth state can be consumed once only
OAuth state expires after 10 minutes
successful OAuth exchange fetches /user and binds account metadata
status serialization contains no token values
```

Use deterministic `now`, `idFactory`, and `randomBytes`/PKCE inputs where needed.

- [ ] **Step 2: Write `test/github-connector.test.mjs` before production modules exist**

Cover:

```text
OAuth connection alone leaves repository grants empty
repo A grant permits repo A contents read
repo A grant denies repo B
path traversal / empty path fails before fetch
GitHub request Authorization header is visible only to injected fake fetch
access token near expiry refreshes before the contents call
disconnect removes credential and grants
>1 MiB decoded file is rejected
service public API contains no write method
```

The fake GitHub fetch must return fixture JSON by URL/method and record requests for assertions. It must never call the network.

- [ ] **Step 3: Add a dedicated script to `package.json`**

Add exactly:

```json
"test:github-connector": "node --test test/github-credential-broker.test.mjs test/github-connector.test.mjs"
```

Keep existing scripts unchanged.

- [ ] **Step 4: Ensure CI runs on the stacked branch before a PR to non-main base**

Modify `.github/workflows/publication-runtime.yml` push branches to include:

```yaml
push:
  branches:
    - feat/mcp-publication-runtime-mvp
    - feat/github-connector-broker
```

Add before capability tests:

```yaml
- name: GitHub connector tests
  run: npm run test:github-connector
```

Do not add the final source artifact rename yet; RED should fail before production modules exist.

- [ ] **Step 5: Commit the RED contract only**

Commit message:

```text
test: define GitHub connector security contract
```

- [ ] **Step 6: Observe a real RED workflow run**

Expected:

```text
npm ci: PASS
GitHub connector tests: FAIL because server/credentials or server/connectors modules do not exist
later steps: skipped
```

Do not create production modules before this failure is observed.

---

### Task 2: Implement the in-memory credential broker and GitHub App OAuth/PKCE client

**Files:**
- Create: `server/credentials/memory-broker.js`
- Create: `server/connectors/github-app.js`
- Test: `test/github-credential-broker.test.mjs`

**Interfaces:**
- Produces `createMemoryCredentialBroker(options)`.
- Produces `createGitHubAppOAuth(options)`.
- Later Task 3 consumes both.

#### Credential broker interface

```js
const broker = createMemoryCredentialBroker({ now, idFactory })

const credentialId = broker.store({
  provider: 'github',
  account: { id, login, avatar_url, html_url },
  accessToken,
  accessExpiresAt,
  refreshToken,
  refreshExpiresAt,
})

broker.describe(credentialId)
broker.withCredential(credentialId, credential => valueOrPromise)
broker.replaceSecrets(credentialId, {
  accessToken,
  accessExpiresAt,
  refreshToken,
  refreshExpiresAt,
})
broker.remove(credentialId)
```

`describe()` returns only:

```js
{
  credential_id,
  provider,
  account,
  expires_at,
  refresh_expires_at,
  created_at,
  updated_at,
}
```

`withCredential()` throws `{ code: 'credential_not_found' }` for an unknown/removed handle.

- [ ] **Step 1: Implement the minimal broker**

Use a closure-scoped `Map`, freeze public metadata, and never implement a `listSecrets()` / `getToken()` public method.

Validate required provider and access token strings. Normalize timestamps to ISO or `null`.

- [ ] **Step 2: Implement OAuth pending-state + PKCE generation**

`createGitHubAppOAuth` constructor:

```js
createGitHubAppOAuth({
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  stateIdFactory,
  verifierFactory,
  stateTtlMs = 10 * 60 * 1000,
})
```

Public methods:

```js
oauth.configured()
oauth.start({ redirectUri })
oauth.complete({ code, state, broker })
oauth.refreshCredential({ credentialId, broker })
```

`start()` returns:

```js
{
  authorizeUrl,
  state,
  createdAt,
  expiresAt,
}
```

Pending state stores the verifier internally and is deleted on first `complete()` attempt before exchange.

- [ ] **Step 3: Implement authorization URL**

Use:

```text
https://github.com/login/oauth/authorize
```

with `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`.

Generate challenge as:

```js
createHash('sha256').update(verifier).digest('base64url')
```

- [ ] **Step 4: Implement code exchange and authenticated identity lookup**

POST `https://github.com/login/oauth/access_token` using URL-encoded body:

```text
client_id
client_secret
code
redirect_uri
code_verifier
```

Headers:

```text
Accept: application/json
Content-Type: application/x-www-form-urlencoded
```

Then GET `https://api.github.com/user` with the returned access token.

Normalize token expiry:

```text
accessExpiresAt = now + expires_in seconds, else null
refreshExpiresAt = now + refresh_token_expires_in seconds, else null
```

Store in broker and return only `{ credentialId, account }`.

- [ ] **Step 5: Implement refresh exchange**

POST the same token endpoint with:

```text
client_id
client_secret
grant_type=refresh_token
refresh_token=<stored refresh token>
```

If refresh is absent/expired when needed, throw `github_reauthentication_required`.

Never include a token value in error messages.

- [ ] **Step 6: Run the credential/OAuth test file GREEN**

Run through CI on the branch. Expected the credential test file to pass; connector service tests may remain RED until Task 3.

- [ ] **Step 7: Commit**

Commit message:

```text
feat: add server-side GitHub OAuth credential broker
```

---

### Task 3: Implement repository-scoped GitHub read service behind capability authorization

**Files:**
- Create: `server/connectors/github-service.js`
- Test: `test/github-connector.test.mjs`

**Interfaces:**
- Consumes `createMemoryCredentialBroker`, `createGitHubAppOAuth`, PR-A `createActorContext`, `createGrant`, `createCapabilitySession`.
- Produces `createGitHubConnectorService(options)`.

Public API:

```js
service.getStatus()
service.startAuth({ redirectUri })
service.completeAuth({ code, state })
service.disconnect()
service.grantRepositoryRead({ repository })
service.readRepositoryFile({ repository, path, ref })
```

There MUST NOT be `writeFile`, `createFile`, `deleteFile`, `commit`, or generic `request` in the public object.

- [ ] **Step 1: Normalize repository and path inputs**

Repository:

```text
owner/repo
```

with each component matching:

```text
^[A-Za-z0-9_.-]+$
```

Path rules:

```text
non-empty
no leading '/'
no NUL
no empty segment
no '.' segment
no '..' segment
```

Create resources:

```js
function repositoryGrantResource(repository) {
  return `github:repository:${repository}:contents:*`
}

function repositoryFileResource(repository, path) {
  return `github:repository:${repository}:contents:${path}`
}
```

- [ ] **Step 2: Bind authenticated identity without granting repository access**

After `completeAuth`, set current credential handle and actor:

```js
createActorContext({
  humanPrincipal: `github:user:${account.id}`,
  client: 'eveglyph-editor',
  session: `github:${credentialId}`,
})
```

Initialize `grants = []`.

`getStatus()` immediately after OAuth MUST report `grants: []`.

- [ ] **Step 3: Implement explicit session grant**

`grantRepositoryRead({ repository })` stores exactly:

```js
createGrant({
  capability: 'connector.github.repository.contents.read',
  resource: `github:repository:${repository}:contents:*`,
  lifetime: 'session',
  source: 'user-explicit-session',
  grantedBy: actor.humanPrincipal,
})
```

Deduplicate identical repository grants.

- [ ] **Step 4: Gate every read before token use**

`readRepositoryFile` creates a capability session with current actor and explicit grants, then requires:

```js
{
  capability: 'connector.github.repository.contents.read',
  resource: `github:repository:${repository}:contents:${path}`,
  lifetime: 'once',
  reason: 'Read GitHub repository file',
  context: { provider: 'github', repository, path, ref: ref || null },
}
```

If denied, do not call broker `withCredential` and do not call `fetchImpl`.

- [ ] **Step 5: Refresh token before external read when needed**

If credential expiry is within 30 seconds, call OAuth refresh first. Then obtain the current access token only inside `broker.withCredential`.

- [ ] **Step 6: Perform the GitHub Contents read**

Construct URL:

```text
https://api.github.com/repos/<owner>/<repo>/contents/<segment-encoded-path>[?ref=<ref>]
```

Headers:

```text
Accept: application/vnd.github+json
Authorization: Bearer <server-only token>
X-GitHub-Api-Version: 2022-11-28
User-Agent: EveGlyph-Editor
```

Accept only a single regular file response with `encoding: "base64"` and inline `content`.

Strip GitHub's embedded newlines from base64 before decoding.

If decoded bytes exceed `1024 * 1024`, throw `github_file_too_large`.

Decode UTF-8 and return:

```js
{
  repository,
  path: response.path,
  ref: ref || null,
  sha: response.sha,
  size: decoded.length,
  encoding: 'utf-8',
  content,
  capability_evidence: decision,
}
```

- [ ] **Step 7: Implement disconnect**

Remove current broker credential, clear actor and all grants. `getStatus()` returns disconnected immediately.

- [ ] **Step 8: Run both GitHub test files GREEN**

Expected both test files to pass with fake fetch and no network/CI secrets.

- [ ] **Step 9: Commit**

Commit message:

```text
feat: gate GitHub repository reads by capability
```

---

### Task 4: Expose the GitHub connector through the localhost Vite bridge

**Files:**
- Create: `server/connectors/github-http.js`
- Modify: `vite-agent-bridge.js`
- Create: `test/github-connector-http.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes `createGitHubConnectorService`.
- Produces bridge handlers for status/auth/callback/disconnect/grant/read.

- [ ] **Step 1: Add controller tests before bridge production integration**

Test a future `createGitHubConnectorHttpController({ service })` with method calls:

```js
controller.status()
controller.startAuth({ redirectUri })
controller.callback({ code, state })
controller.disconnect()
controller.grantRead({ repository })
controller.readFile({ repository, path, ref })
```

Serialize every returned JSON object and assert it does not contain known fake access/refresh tokens or `client_secret`.

- [ ] **Step 2: Implement the HTTP controller**

Controller translates service errors into:

```js
{ status, body }
```

with stable public code/message. It never includes raw external response bodies.

Callback returns a small HTML document with either:

```text
GitHub connected. You can close this window.
```

or a redacted error code/message.

- [ ] **Step 3: Instantiate connector service once in `vite-agent-bridge.js`**

Create it from environment:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
```

Do not surface env values in `_debug`, Monitor, or route responses.

- [ ] **Step 4: Register bridge endpoints under the existing `/api` local-origin gate**

Implement exactly:

```text
GET  /api/connectors/github/status
POST /api/connectors/github/auth/start
GET  /api/connectors/github/callback
POST /api/connectors/github/disconnect
POST /api/connectors/github/grant-read
POST /api/connectors/github/read-file
```

Derive default callback URI from the current localhost request origin/Host unless `EVEGLYPH_GITHUB_REDIRECT_URI` is set.

- [ ] **Step 5: Add safe Monitor events**

Allowed:

```text
github:auth:start { configured }
github:auth:connected { accountId, login }
github:disconnect {}
github:grant { repository }
github:read { repository, path, decision, status }
```

Never log query `code`, `state`, verifier, tokens, Authorization header, or client secret.

- [ ] **Step 6: Add HTTP/controller test to script**

Change:

```json
"test:github-connector": "node --test test/github-credential-broker.test.mjs test/github-connector.test.mjs test/github-connector-http.test.mjs"
```

- [ ] **Step 7: Run connector tests + Vite build**

Expected connector tests GREEN and `npm run build` GREEN.

- [ ] **Step 8: Commit**

Commit message:

```text
feat: expose GitHub connector on local bridge
```

---

### Task 5: Add Settings UI for authentication, explicit grant, and read-only file preview

**Files:**
- Modify: `index.html`
- Modify: `src/settings.js`
- Modify: `src/main.js`
- Optional only if needed for layout: `src/styles.css`
- Test: `test/github-connector-ui-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes localhost bridge endpoints from Task 4.
- Produces browser functions `githubRefreshStatus`, `githubConnect`, `githubDisconnect`, `githubGrantRead`, `githubReadFile`.

- [ ] **Step 1: Add a static UI contract test before modifying HTML/JS**

Read `index.html`, `src/settings.js`, and `src/main.js` as text and assert:

```text
GitHub Connector section exists
Connect and Disconnect controls exist
repository/path/ref fields exist
Grant read for this session exists
Read file control exists
no GitHub access-token/client-secret input exists
settings.js exports the five connector functions
main.js wires the controls
```

This is a structural regression test, not a DOM behavior substitute.

- [ ] **Step 2: Add Settings HTML after AI/local-agent fields and before MCP**

Use ids:

```text
s-github-status
btn-github-connect
btn-github-disconnect
s-github-repository
btn-github-grant-read
s-github-path
s-github-ref
btn-github-read
s-github-read-result
```

No token/secret input elements.

Copy must state that OAuth only connects identity and repository access still requires a session read grant.

- [ ] **Step 3: Implement `githubRefreshStatus()`**

GET status and render:

```text
Not configured
Disconnected
Connected as @login
Session grants: owner/repo, ...
```

Connect is enabled only when configured and disconnected. Disconnect/grant/read are enabled only when connected.

- [ ] **Step 4: Implement `githubConnect()`**

POST `/api/connectors/github/auth/start`, open returned `authorize_url` with `window.open`, then poll `githubRefreshStatus()` once per second for at most 120 attempts or until connected.

Do not persist auth URL, state, or callback data.

- [ ] **Step 5: Implement disconnect/grant/read**

Grant body:

```js
{ repository: repoField.value.trim() }
```

Read body:

```js
{
  repository: repoField.value.trim(),
  path: pathField.value.trim(),
  ref: refField.value.trim() || undefined,
}
```

Render returned text into `textContent` of a `<pre>` or textarea, never `innerHTML`.

- [ ] **Step 6: Wire controls from `main.js`**

Import the five functions and assign click handlers. Call `githubRefreshStatus()` during `cfgLoad()` or immediately after boot.

- [ ] **Step 7: Add UI contract test to connector script**

Final script:

```json
"test:github-connector": "node --test test/github-credential-broker.test.mjs test/github-connector.test.mjs test/github-connector-http.test.mjs test/github-connector-ui-contract.test.mjs"
```

- [ ] **Step 8: Run connector tests + build**

Expected all connector tests and Vite build GREEN.

- [ ] **Step 9: Commit**

Commit message:

```text
feat: add GitHub connector settings flow
```

---

### Task 6: Document the trust boundary, run full verification, and package exact HEAD

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- Consumes final implementation.
- Produces operator setup, security documentation, full CI evidence, exact-head source ZIP.

- [ ] **Step 1: Document local GitHub App setup in README**

Include:

```text
GitHub App, not OAuth App
Contents permission: Read-only for PR-B
callback default: http://localhost:5173/api/connectors/github/callback
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
optional EVEGLYPH_GITHUB_REDIRECT_URI
restart dev server after env changes
OAuth authenticates only; repository grant remains a separate Settings action
```

- [ ] **Step 2: Document credential custody in SECURITY.md**

State explicitly:

```text
tokens process-memory only
browser never receives tokens
no persistence across dev-server restart
no MCP sharing
OAuth state one-time + TTL
PKCE + state
repository grant is explicit and session-scoped
no GitHub write surface in PR-B
```

- [ ] **Step 3: Change final CI artifact name for PR-B**

After all verification steps, package:

```yaml
- name: Package verified PR source
  run: git archive --format=zip --output=eveglyph-github-connector-broker.zip HEAD

- name: Upload verified PR source
  uses: actions/upload-artifact@v4
  with:
    name: eveglyph-github-connector-broker
    path: eveglyph-github-connector-broker.zip
    if-no-files-found: error
    retention-days: 14
```

- [ ] **Step 4: Run fresh full CI on exact final head**

Required all PASS:

```text
npm ci
npm run test:github-connector
npm run test:capabilities
npm run test:publication
npm run build
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
Package verified PR source
Upload verified PR source
```

- [ ] **Step 5: Base-to-head review**

Compare against stacked base `34acbcc37325b4349e9758d0542c4c9250540bc8` and verify:

```text
no GitHub write API
no access/refresh token in frontend or docs fixtures
no client secret in browser code
no credential passed to document-runtime or MCP
no OAuth callback code/state in logs
all external reads pass capability service first
```

- [ ] **Step 6: Create/update stacked PR**

Base:

```text
feat/capability-sandbox-foundation
```

Head:

```text
feat/github-connector-broker
```

PR body records RED run, final GREEN run, exact head SHA, artifact id, and SHA-256.

- [ ] **Step 7: Download Actions artifact and extract inner exact-head source ZIP**

Verify its SHA-256 locally in the conversation runtime before providing the user a sandbox link.
