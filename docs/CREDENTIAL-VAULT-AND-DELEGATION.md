# EveGlyph Credential Vault & Delegation Boundary

Status: PR-D engineering contract / operator guide  
Scope: persistent external-service credential custody + delegation primitive  
Providers currently attached: GitHub, Google Drive

## 1. Purpose

PR-D changes EveGlyph's connector credential model from process-only memory to a provider-neutral credential runtime that can persist GitHub and Google OAuth credentials in the operating system credential store.

The security goal is not merely persistence. It is to preserve the separation between:

```text
provider credential
!=
EveGlyph session capability grant
!=
delegation ticket
```

A restored credential can recreate provider identity after EveGlyph restarts. It does **not** restore GitHub repository grants, Google Drive metadata-list grants, or Google Drive exact-file grants. Those remain session-only and must be explicitly granted again.

PR-D also adds a short-lived delegation-ticket broker and a local IPC operation boundary. These are foundations for future cross-process connector use. PR-D deliberately does **not** connect them to `mcp-server.js` or `mcp-server-remote.js` yet.

## 2. Credential storage modes

EveGlyph reads:

```text
EVEGLYPH_CREDENTIAL_STORE
```

Allowed values:

```text
system   # default
memory   # explicit non-persistent fallback
```

If the variable is omitted, EveGlyph uses `system`.

### `system`

`system` uses `@napi-rs/keyring` through `server/credentials/system-keyring-vault.js`. The Vite/Node process supplies the native keyring `Entry` implementation; credential envelopes are written only through the operating-system credential backend.

The service name is:

```text
EveGlyph Editor
```

Credential entries use opaque credential ids. Separate active-provider pointers record which credential id should be restored for a provider.

There is no credential enumeration API.

### `memory`

To deliberately disable persistence:

```sh
EVEGLYPH_CREDENTIAL_STORE=memory npm run dev
```

`memory` preserves the earlier PR-B/PR-C behavior: credentials exist only in the EveGlyph Node process and disappear on restart.

This mode is **not** selected automatically when the system keyring fails.

### No silent plaintext fallback

EveGlyph does not fall back from `system` to:

- plaintext JSON;
- `.env` credential files;
- workspace files;
- `.eveglyph/`;
- browser `localStorage` or `sessionStorage`;
- an implicit process-memory store.

An unavailable OS credential store fails closed as:

```text
credential_vault_unavailable
```

Connector HTTP/OAuth surfaces expose that condition as a stable redacted HTTP 503. Backend/keyring exception text is not returned to the browser.

## 3. What is persisted

A credential envelope can contain:

```text
credential id
provider id
public provider account metadata
access token
access-token expiry
refresh token, if issued
refresh-token expiry, if applicable
```

The vault stores the complete envelope in the OS keyring because refresh requires the provider secret material.

Public broker descriptions remain redacted and do not expose the token values.

## 4. What is never persisted by PR-D

EveGlyph capability grants remain runtime/session state.

Examples that are intentionally **not** persisted:

```text
connector.github.repository.contents.read
  github:repository:<owner>/<repo>:contents:*

connector.google.drive.metadata.list
  google:drive:files:*

connector.google.drive.file.read
  google:drive:file:<fileId>
```

Therefore restart behavior is:

```text
persisted provider credential
        ↓
restore provider identity
        ↓
zero connector-session grants
        ↓
user explicitly re-grants resource authority
```

A restored GitHub identity cannot immediately read a repository. A restored Google identity cannot immediately list Drive metadata or read a file.

## 5. Provider restoration

`github-service.js` and `google-drive-service.js` support restoration from a known credential id supplied by the shared broker.

Restoration verifies provider identity. A Google credential cannot be restored as GitHub, or vice versa.

Restoration creates a new actor/session context and resets grants to an empty list.

The Vite configuration creates one provider-neutral credential runtime and injects the same broker into both connector bridges:

```text
OS keyring
   ↓
persistent credential broker
   ↓
shared in-process hot cache
   ├── GitHub connector
   └── Google Drive connector
```

The browser never receives the credential envelope.

## 6. Delegation tickets

`server/credentials/delegation-broker.js` implements opaque operation delegation.

A delegation binds exactly:

```text
provider
operation
capability
resource
actor
expiry
remaining use count
```

A ticket for one provider/operation/resource cannot authorize another.

### Ticket construction

A ticket is created from 32 cryptographically random bytes and encoded as base64url.

Only its SHA-256 hash is stored in the broker map. The raw ticket is returned once to the issuer and is not stored in the public delegation record.

Public listing exposes only metadata such as delegation id, provider, operation, capability, resource, actor, expiry and remaining uses.

### Lifetime limits

Defaults:

```text
TTL:       60 seconds
max uses:  1
```

Hard limits:

```text
TTL:       300 seconds maximum
max uses:  10 maximum
```

Expired tickets are removed. Exhausted one-use tickets cannot be replayed. Tickets can also be explicitly revoked.

## 7. Local delegation IPC

`server/credentials/delegation-ipc.js` provides a local operation broker built on `node:net`.

Endpoint form:

```text
Windows: \\.\pipe\eveglyph-credential-broker-<pid>
Unix:    <os-temp>/eveglyph-credential-broker-<pid>.sock
```

Unix sockets are reduced to mode `0600` when possible.

The protocol accepts one bounded JSON request with:

```text
method = invoke
provider
operation
capability
resource
ticket
input
```

Maximum request size:

```text
16 KiB
```

Processing order is deliberately:

```text
parse bounded local request
→ locate registered operation
→ consume exact delegation ticket
→ execute trusted server-side handler
→ reject credential-shaped result
→ return stable public result/error
```

The ticket is consumed before the delegated handler runs, so a one-use ticket cannot be replayed if the handler has already been entered.

IPC result serialization rejects objects containing sensitive credential keys including access tokens, refresh tokens, client secrets, Authorization material or credential envelopes.

## 8. Delegation is not token export

The intended future cross-process model is:

```text
child / MCP process
      ↓
short-lived delegation ticket
      ↓
local EveGlyph operation broker
      ↓
capability/resource match
      ↓
credential-owning connector executes operation
      ↓
redacted operation result
```

It is explicitly **not**:

```text
child process
      ↓
getAccessToken()
      ↓
provider API
```

Raw provider credentials remain on the credential-owning EveGlyph side of the boundary.

## 9. MCP status in PR-D

PR-D does not register GitHub or Google delegated operations with either MCP server.

The existing MCP processes therefore do not receive:

- the system keyring binding;
- the persistent credential broker;
- raw provider credentials;
- delegation-broker internals;
- delegation IPC wiring for connector operations.

A later PR may define a deliberate MCP-to-delegation flow. That future work must specify operation names, actor attribution, capability/resource binding, approval/grant acquisition, IPC lifecycle, and revocation semantics before enabling a connector operation.

## 10. Browser and document boundary

The browser Settings modules do not receive or persist:

```text
accessToken
refreshToken
clientSecret
credential envelope
```

The `document-only` AIMD-C runtime remains unchanged: it has no keyring, persistent-broker, credential or connector object.

PR-D therefore improves credential persistence without widening the authority of document computation.

## 11. Operator examples

Default persistent mode:

```sh
npm run dev
```

Explicit non-persistent mode:

```sh
EVEGLYPH_CREDENTIAL_STORE=memory npm run dev
```

On Windows PowerShell:

```powershell
$env:EVEGLYPH_CREDENTIAL_STORE = 'memory'
npm run dev
```

When using the default `system` mode, the operating-system keyring must be available to the user account running EveGlyph. If it is locked or unavailable, EveGlyph fails closed rather than silently moving credentials somewhere weaker.

## 12. Verification gates

PR-D CI runs:

```sh
npm ci
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
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```

The credential-boundary verifier checks that:

- browser sources do not import persistent/keyring internals;
- MCP sources do not import persistent/keyring internals;
- MCP is not prematurely wired to delegation broker/IPC;
- public Settings code has no raw credential properties;
- the browser production build contains no credential-envelope material.

Only after these gates pass should the exact PR head be archived and distributed.

## 13. Non-goals

PR-D does not implement:

- connector operations inside MCP;
- remote delegation over TCP/HTTP;
- SaaS multi-tenant credential custody;
- credential sharing between operating-system users;
- persistence of EveGlyph session grants;
- plaintext backup/export of provider tokens;
- token display/copy UI;
- automatic fallback from system keyring to memory;
- remote MCP OAuth hardening;
- Wasmtime/WASI or OS process sandbox enforcement.

Those remain separate security boundaries and require separate design/validation.
