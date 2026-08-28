# EveGlyph GitHub Connector + Credential Broker — Design

**Date:** 2026-08-28  
**Branch:** `feat/github-connector-broker`  
**Stacked base:** `feat/capability-sandbox-foundation` @ `34acbcc37325b4349e9758d0542c4c9250540bc8`  
**Status:** Approved by continuation; implementation pending

## 1. Goal

Implement the first real external-service vertical slice on top of EveGlyph's capability foundation:

```text
GitHub App user OAuth + PKCE
→ server-side in-memory credential broker
→ authenticated GitHub identity
→ explicit repository-scoped read grant
→ capability authorization
→ GitHub Contents read
→ redacted result + audit evidence
```

This PR proves that authentication, credential custody, capability authorization, and connector I/O remain separate layers.

## 2. Why this is a stacked PR

PR #7 (`feat/capability-sandbox-foundation`) is open and intentionally not merged automatically. PR-B therefore branches from the exact PR #7 head and targets that branch. It does not merge or rewrite PR #7.

Once PR #7 lands in `main`, this PR can be retargeted to `main` without changing its implementation semantics.

## 3. Core security invariants

### 3.1 Authentication is not authorization

A successful GitHub OAuth callback establishes identity and credential custody only:

```text
OAuth success
!=
repository read grant
```

The callback MUST NOT silently grant `connector.github.repository.contents.read` for any repository.

### 3.2 Credentials never enter the document sandbox

The browser, AIMD-C runtime, document source, Dynamic Logic runtime, MCP tool payloads, and publication runtime MUST NOT receive GitHub access or refresh tokens.

Raw tokens exist only inside the Node-side credential broker and GitHub connector service.

### 3.3 No browser persistence of GitHub credentials

GitHub OAuth credentials MUST NOT be written to:

- `localStorage`;
- `sessionStorage`;
- workspace files;
- `.eveglyph/` files;
- Monitor payloads;
- MCP artifacts;
- Git history.

The first implementation is intentionally process-scoped. Restarting the Vite dev server disconnects GitHub and requires re-authentication.

### 3.4 Explicit repository grant

A repository read is permitted only when EveGlyph has an explicit matching grant:

```text
capability = connector.github.repository.contents.read
resource   = github:repository:<owner>/<repo>:contents:*
lifetime   = session
source     = user-explicit-session
```

A grant for repository A MUST NOT authorize repository B.

Read never implies write.

### 3.5 GitHub write is absent

This PR exposes no GitHub write endpoint and calls no GitHub write API. The existing registry may contain a future write capability id, but it remains unused here.

### 3.6 Unknown / expired / disconnected state fails closed

Invalid OAuth state, replayed state, expired state, missing credentials, expired refresh credentials, unknown repository/path input, absent grant, and GitHub API errors all fail closed with stable error categories.

## 4. GitHub authentication model

Use a **GitHub App user access token** flow rather than a legacy OAuth App.

Reasons:

- GitHub recommends GitHub Apps for fine-grained permissions and repository selection;
- user access tokens preserve end-user attribution;
- the token's effective authority is bounded by both the user and GitHub App permissions;
- expiring user tokens can be refreshed without exposing credentials to the browser.

The server-side configuration is environment-only:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
EVEGLYPH_GITHUB_REDIRECT_URI   (optional override)
```

The client secret MUST NOT appear in `src/config.js`, Settings fields, HTML, or browser state.

For local development, when `EVEGLYPH_GITHUB_REDIRECT_URI` is not set, the bridge derives:

```text
<current local origin>/api/connectors/github/callback
```

The GitHub App must register the matching callback URL. The normal Vite default is expected to be:

```text
http://localhost:5173/api/connectors/github/callback
```

The GitHub App should be configured with **Contents: Read-only** for this MVP as defense in depth.

## 5. OAuth state + PKCE

`auth/start` generates:

- cryptographically random `state`;
- PKCE `code_verifier`;
- SHA-256 `code_challenge`;
- redirect URI;
- creation timestamp.

The authorization URL uses:

```text
https://github.com/login/oauth/authorize
```

with:

```text
client_id
redirect_uri
state
code_challenge
code_challenge_method=S256
```

The OAuth state store is process-scoped, one-time, and expires after 10 minutes.

The callback consumes the state before exchanging the code. A second callback with the same state MUST fail even if the authorization code is repeated.

The code exchange uses:

```text
https://github.com/login/oauth/access_token
```

with JSON response negotiation. The request includes the server-side client secret and PKCE verifier.

## 6. Credential broker

Add a Node-only in-memory credential broker.

The broker stores:

```text
credential id (opaque)
provider
account metadata
access token
access expiry
refresh token (if returned)
refresh expiry (if returned)
created_at
updated_at
```

Public description APIs return only redacted metadata:

```text
credential_id
provider
account
expires_at
refresh_expires_at
created_at
updated_at
```

They MUST NOT return fields named or containing:

```text
token
access_token
refresh_token
client_secret
```

Only trusted server-side connector code can execute work with a credential record.

Disconnect removes the credential record and every connector grant associated with that connection.

## 7. Expiring token refresh

If the GitHub access token has no expiry, use it as returned.

If it expires within 30 seconds, the GitHub connector attempts a refresh before making the external API call.

Refresh uses the stored refresh token and server-side client credentials. On success the broker atomically replaces the access/refresh token metadata.

If refresh is required but no valid refresh token is available, fail closed as `github_reauthentication_required`.

No token values may appear in thrown errors, Monitor events, or browser responses.

## 8. Authenticated actor binding

After token exchange, the connector calls GitHub's authenticated-user endpoint and binds the connection to:

```text
humanPrincipal = github:user:<numeric-id>
client         = eveglyph-editor
document       = null
agent          = null
session        = <opaque connector session id>
```

Public account metadata may include:

```text
id
login
avatar_url
html_url
```

The OAuth token itself is not identity metadata.

## 9. Repository resource model

Repository identifiers are normalized as:

```text
<owner>/<repo>
```

Allowed owner/repository characters are the GitHub-compatible conservative subset:

```text
[A-Za-z0-9_.-]
```

A repository contents resource is:

```text
github:repository:<owner>/<repo>:contents:<path>
```

A whole-repository read grant is:

```text
github:repository:<owner>/<repo>:contents:*
```

Paths reject empty segments, `.` and `..` traversal segments, leading `/`, and NUL characters. URL encoding is performed segment-by-segment so `/` retains path hierarchy.

## 10. GitHub read operation

The first connector operation is intentionally narrow:

```text
readRepositoryFile({ repository, path, ref? })
```

Flow:

```text
normalize repository/path
→ require connected identity
→ create capability session with actor + explicit grants
→ require connector.github.repository.contents.read
→ resolve/refresh credential internally
→ GET GitHub Contents API
→ validate file response
→ decode bounded base64 text
→ return file metadata/content + authorization evidence
```

The MVP supports regular text files returned inline by the GitHub Contents API and caps decoded bytes at **1 MiB**. Directories, symlinks/submodules, omitted content, unsupported encodings, and larger files fail with explicit errors instead of silently changing transport.

The returned object contains no token or Authorization header.

## 11. Connector service state

The local development bridge owns one GitHub connector service instance.

Process-scoped state:

```text
current credential handle: 0 or 1
OAuth pending states: many, TTL-bounded
repository read grants: set, cleared on disconnect
```

This is deliberately single-user/local-runtime state, matching the current EveGlyph prototype.

Persistent multi-account storage, OS keychain integration, tenant isolation, and distributed credential services are future layers.

## 12. Local bridge API

Add the following localhost-gated bridge endpoints.

### `GET /api/connectors/github/status`

Returns:

```json
{
  "configured": true,
  "connected": true,
  "account": {
    "id": 123,
    "login": "example",
    "avatar_url": "...",
    "html_url": "..."
  },
  "expires_at": "...",
  "grants": [
    {
      "capability": "connector.github.repository.contents.read",
      "repository": "owner/repo",
      "lifetime": "session"
    }
  ]
}
```

No secret fields.

### `POST /api/connectors/github/auth/start`

Creates OAuth state + PKCE and returns:

```json
{
  "authorize_url": "https://github.com/login/oauth/authorize?..."
}
```

If client configuration is absent, return `github_not_configured` without fabricating a URL.

### `GET /api/connectors/github/callback?code=...&state=...`

Consumes one-time state, exchanges the code, fetches authenticated GitHub identity, stores credentials server-side, and returns a small local HTML success/failure page.

The page MUST NOT include token material.

### `POST /api/connectors/github/disconnect`

Deletes the credential and repository grants.

### `POST /api/connectors/github/grant-read`

Input:

```json
{ "repository": "owner/repo" }
```

Requires an authenticated connection and stores an explicit session read grant.

It does not perform the repository read itself.

### `POST /api/connectors/github/read-file`

Input:

```json
{
  "repository": "owner/repo",
  "path": "README.md",
  "ref": "main"
}
```

Requires the exact repository grant and returns decoded text + metadata + capability evidence.

## 13. Settings UI

Add a separate **GitHub Connector** block to Settings, not inside the AI-provider API-key fields.

Controls:

```text
status
Connect GitHub / Disconnect
repository owner/name
Grant read for this session
file path
optional ref
Read file
read-only result preview
```

The UI MUST NOT contain fields for GitHub client secret or access token.

The Connect action opens the GitHub authorization URL in a popup/new tab and polls the local status endpoint until connected or a bounded timeout occurs.

The UI may remember non-secret convenience values such as repository/path/ref, but this PR does not require persistence for them.

## 14. Monitor / evidence rules

Monitor events may record:

```text
configured / connected boolean
GitHub numeric user id or login
repository
path
capability decision
HTTP status
```

Monitor events MUST NOT record:

```text
access token
refresh token
OAuth code
PKCE verifier
client secret
Authorization header
full OAuth callback query
```

Capability evidence from the existing session model remains the canonical allow/deny evidence for repository reads.

## 15. MCP boundary

This PR does not expose GitHub credentials to `mcp-server.js` or `mcp-server-remote.js`.

Reason: those MCP servers are separate Node processes, while this first credential broker is process-scoped to the Vite bridge. Copying tokens across processes just to make MCP work would violate the new custody boundary.

A later PR may add a deliberate broker IPC/persistent keychain service or move remote MCP behind the same authenticated gateway. Until then, GitHub connector UI/bridge and MCP credentials remain separate.

## 16. Error model

Stable connector error codes include:

```text
github_not_configured
github_invalid_oauth_state
github_oauth_state_expired
github_oauth_exchange_failed
github_identity_failed
github_not_connected
github_reauthentication_required
github_invalid_repository
github_invalid_path
capability_denied
github_api_error
github_resource_not_file
github_file_too_large
github_file_encoding_unsupported
```

External error bodies are summarized without echoing secrets.

## 17. Testing strategy

Follow RED → GREEN.

### Unit tests

Cover:

- credential broker public descriptions redact tokens;
- broker disconnect destroys credential access;
- PKCE challenge and authorization URL fields;
- OAuth state one-time consumption and 10-minute expiry;
- successful code exchange binds GitHub user identity;
- OAuth status never returns tokens;
- OAuth alone gives no repository grant;
- explicit repo A read grant authorizes repo A only;
- repository B remains denied;
- read path normalization rejects traversal;
- GitHub API request receives token only inside connector fetch;
- token refresh occurs before an expiring request;
- disconnect clears grants;
- 1 MiB file cap;
- no GitHub write method exists in the public service contract.

### Bridge/controller integration tests

Use injected fake GitHub fetch responses. Do not call real GitHub or require CI secrets.

Exercise controller-level start/status/callback/grant/read/disconnect behavior and assert that serialized responses contain no token values.

### Regression

Run:

```text
npm run test:github-connector
npm run test:capabilities
npm run test:publication
npm run build
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```

## 18. CI and verified artifact

Because this is a stacked PR whose base is not `main`, add this branch to the workflow's `push` trigger so RED/GREEN evidence runs even before PR #7 merges.

After final green verification, package exact HEAD with `git archive` and upload a GitHub Actions source artifact.

## 19. Explicit non-goals

Not in PR-B:

- GitHub write/create/update/delete;
- installation access-token JWT/private-key flow;
- GitHub webhook handling;
- GitHub repository cloning;
- repository search/list UI;
- persistent encrypted credential database;
- OS keychain integration;
- multi-account switching;
- Google OAuth/Drive;
- remote MCP OAuth hardening;
- MCP access to the bridge credential broker;
- Wasmtime/WASI or OS/process sandbox backends;
- public SaaS tenancy/rate limits/billing.

## 20. Acceptance criteria

PR-B is complete only when:

1. GitHub App user OAuth start uses state + PKCE.
2. OAuth callback state is one-time and TTL-bounded.
3. GitHub client secret exists only server-side via environment configuration.
4. Access/refresh tokens remain in the Node-side broker and never serialize to the browser.
5. Successful OAuth binds a GitHub user actor but grants no repository capability.
6. A user-explicit session grant is required before repository contents read.
7. A grant for one repository cannot authorize another.
8. The connector performs a real GitHub Contents-compatible read flow behind the capability check.
9. Expiring user tokens refresh internally when possible.
10. Disconnect clears credentials and grants.
11. No GitHub write surface is introduced.
12. Settings exposes connection, grant, and read controls without token/secret fields.
13. New tests pass with fake GitHub responses and no CI secrets.
14. Existing capability/publication/build/dynamic regressions pass.
15. A verified exact-HEAD source ZIP is produced after green verification.
