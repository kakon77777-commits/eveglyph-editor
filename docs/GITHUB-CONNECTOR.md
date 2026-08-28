# EveGlyph GitHub Connector

This document describes the first GitHub external-service connector in EveGlyph.

The connector is intentionally narrow:

```text
GitHub App user OAuth + PKCE
→ server-side process-memory credential broker
→ GitHub user identity
→ explicit repository-scoped read grant
→ EveGlyph capability authorization
→ GitHub Contents API read
→ UTF-8 text result + audit evidence
```

It is a local-development connector for the EveGlyph Vite runtime. It is not a general GitHub SDK, a repository clone engine, a write API, or a credential-sharing service for MCP.

## Core rule: authentication is not authorization

Connecting GitHub proves which GitHub user authorized the connection. It does **not** grant EveGlyph permission to read arbitrary repositories.

After OAuth succeeds, Settings reports the connected account with an empty repository-grant list. A user must separately enter an `owner/repo` identifier and choose **Grant read for this session**.

The resulting EveGlyph grant is:

```text
capability = connector.github.repository.contents.read
resource   = github:repository:<owner>/<repo>:contents:*
lifetime   = session
source     = user-explicit-session
```

A grant for repository A does not authorize repository B. Read authority does not imply write authority.

The connector uses the empty-baseline `connector-session` capability profile, so external-service sessions have no ambient authority before explicit grants are supplied.

## GitHub App configuration

Use a **GitHub App** for this connector, not a legacy OAuth App.

For this read-only MVP, configure the GitHub App with the minimum repository permission required by the connector:

```text
Repository permissions
  Contents: Read-only
```

Do not grant write permissions to the GitHub App for this PR-B implementation.

The normal local callback URL is:

```text
http://localhost:5173/api/connectors/github/callback
```

Register that callback URL in the GitHub App. If your local EveGlyph origin differs, register the actual callback URI you will use and set the redirect override described below.

## Server-side environment variables

Set these before starting EveGlyph:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
```

Optional callback override:

```text
EVEGLYPH_GITHUB_REDIRECT_URI
```

If the override is absent, the local connector derives the callback from the current localhost request origin and appends:

```text
/api/connectors/github/callback
```

Restart `npm run dev` after changing these environment variables.

The client secret is read only by the Node/Vite connector plugin. There is no Settings field for it.

## OAuth security properties

Authentication start creates:

- a cryptographically generated OAuth `state`;
- a PKCE verifier;
- a SHA-256 `S256` code challenge;
- a 10-minute pending-state lifetime.

OAuth state is one-time. It is removed before token exchange, so even a failed exchange does not leave a replayable state entry.

The callback exchanges the authorization code server-side and then calls GitHub's authenticated-user endpoint to bind the connection to public account metadata.

The browser never receives:

```text
GitHub client secret
OAuth authorization code after callback handling
PKCE verifier
access token
refresh token
Authorization header
```

## Credential custody

GitHub access and refresh credentials live in a process-scoped in-memory broker on the Node side.

Public broker descriptions contain only:

```text
opaque credential id
provider
public account metadata
access expiry
refresh expiry
created_at
updated_at
```

There is no public `getToken()` interface. Trusted connector code accesses a credential only through a server-side callback.

Credentials are deliberately not persisted to:

- browser `localStorage`;
- browser `sessionStorage`;
- the EveGlyph workspace;
- `.eveglyph/` files;
- Git;
- publication artifacts;
- MCP payloads.

Stopping or restarting the Vite development process destroys the in-memory GitHub connection and requires authentication again.

## Token refresh

When GitHub returns expiring user access tokens, EveGlyph checks the access expiry before each repository read.

If the access token is within 30 seconds of expiry, the connector attempts a server-side refresh before the GitHub Contents request.

If refresh is required but no valid refresh credential is available, the connector fails closed with:

```text
github_reauthentication_required
```

Token values are not included in public errors.

## Repository read flow

The current external operation is intentionally limited to:

```text
readRepositoryFile({ repository, path, ref? })
```

The flow is:

```text
validate repository and path
→ require connected GitHub identity
→ create connector-session capability session
→ require explicit repository contents.read grant
→ refresh credential if needed
→ access credential inside server broker callback
→ GET GitHub Contents API
→ validate regular-file/base64 response
→ enforce 1 MiB decoded limit
→ decode strict UTF-8
→ return text + metadata + capability evidence
```

The capability check occurs before credential access and before network fetch. A denied repository read therefore cannot use the credential merely to discover whether the target exists.

## Path and result restrictions

Repository identifiers use:

```text
owner/repo
```

with a conservative character set of letters, digits, `_`, `.`, and `-`.

Repository paths reject:

- an empty path;
- a leading `/`;
- empty path segments;
- `.` segments;
- `..` segments;
- NUL characters.

Path segments are URL encoded individually.

The MVP accepts only regular files returned inline by the GitHub Contents API with `encoding: "base64"`.

The following fail explicitly rather than switching transports silently:

- directory responses;
- non-file resources;
- unavailable inline content;
- unsupported encoding;
- invalid UTF-8;
- decoded files larger than 1 MiB.

## Settings workflow

Settings exposes a separate **GitHub Connector** section with:

```text
connection status
Connect GitHub
Disconnect
repository owner/repo
Grant read for this session
file path
optional ref
Read file
read-only result preview
```

There are no GitHub token or client-secret inputs.

**Connect GitHub** opens the GitHub authorization page. While authorization is in progress, the browser polls only the public connector status endpoint. OAuth state, verifier, authorization code, and tokens never enter the Settings module.

The file result is rendered with `textContent`, not HTML injection.

## Local connector endpoints

The Node/Vite connector plugin exposes these local endpoints:

```text
GET  /api/connectors/github/status
POST /api/connectors/github/auth/start
GET  /api/connectors/github/callback
POST /api/connectors/github/disconnect
POST /api/connectors/github/grant-read
POST /api/connectors/github/read-file
```

These routes are localhost-gated. JSON request bodies are bounded to 64 KiB.

Controller errors are mapped to stable public codes/messages; raw downstream exception text is not serialized to the browser.

## MCP boundary

This PR does **not** share the GitHub credential broker with `mcp-server.js` or `mcp-server-remote.js`.

Those MCP servers run as separate processes, while the first GitHub broker is intentionally process-scoped to the Vite connector runtime. Copying raw tokens into MCP merely to cross that process boundary would defeat the new custody model.

A future version can add a deliberate credential-broker IPC/keychain service or place remote MCP behind the same authenticated gateway. Until that design exists, MCP and this GitHub connection remain separate trust domains.

## No write surface

PR-B has no public GitHub connector methods for:

```text
create file
update file
delete file
commit
pull request mutation
issue mutation
generic authenticated request
```

The GitHub App should therefore remain Contents: Read-only for this implementation.

## Stable public error classes

The connector uses stable public categories including:

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

Public errors do not echo access tokens, refresh tokens, client secrets, PKCE verifiers, or raw GitHub response bodies.

## Current limitations

This first connector deliberately does not implement:

- GitHub writes;
- installation access tokens / app-private-key JWT flow;
- webhooks;
- repository cloning;
- repository search/list UI;
- persistent encrypted credential storage;
- OS keychain integration;
- multiple simultaneous GitHub accounts;
- MCP sharing of connector credentials;
- Google OAuth/Drive;
- remote MCP OAuth hardening;
- Wasmtime/WASI or OS-level sandbox backends.

Those are follow-up layers; they do not widen this PR's read-only authority boundary.
