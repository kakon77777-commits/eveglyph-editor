# EveGlyph Google Drive Connector

Status: PR-C reference implementation  
Date: 2026-08-28  
Scope: local EveGlyph dev server, read-only Google Drive connector

## 1. Purpose

This connector lets the local EveGlyph dev server authenticate a Google account and read selected Google Drive text content without giving the document runtime, browser UI, or MCP processes possession of OAuth credentials.

The security invariant is:

```text
Google OAuth success
!=
Google Drive action authority inside EveGlyph
```

Google OAuth establishes provider identity and a provider credential. EveGlyph then requires separate explicit capability grants before it will list Drive metadata or read a concrete file.

## 2. Google Cloud configuration

Create a Google Cloud project, enable Google Drive API, configure an OAuth consent screen, and create a **Web application** OAuth client.

Set an authorized redirect URI matching the local EveGlyph callback exactly. The default is:

```text
http://localhost:5173/api/connectors/google/callback
```

If Vite uses a different localhost port or hostname, register that exact redirect URI and set `EVEGLYPH_GOOGLE_REDIRECT_URI` to the same value.

Configure the local Node process with:

```text
EVEGLYPH_GOOGLE_CLIENT_ID=<oauth client id>
EVEGLYPH_GOOGLE_CLIENT_SECRET=<oauth client secret>
EVEGLYPH_GOOGLE_REDIRECT_URI=<optional exact callback URI>
```

Never put these values in repository files, browser settings, workspace files, `.eveglyph/`, or documents.

## 3. OAuth scopes

PR-C requests exactly:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.readonly
```

`drive.readonly` allows the provider credential to see and download Drive files. Google currently classifies broad Drive scopes such as this as restricted access for production applications.

That provider-level scope is deliberately **not** treated as an EveGlyph authorization grant. EveGlyph starts each connector session with zero internal Drive grants.

For a public production application, review Google's current OAuth verification and restricted-scope requirements before release. Applications that access restricted data through a third-party server can require additional verification and a security assessment unless an exception applies.

Official references:

- <https://developers.google.com/identity/protocols/oauth2/web-server>
- <https://developers.google.com/identity/protocols/oauth2/scopes>
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>

## 4. OAuth flow

The local Node connector uses Google's web-server authorization flow with:

- state value;
- one-time state consumption;
- 10-minute state TTL;
- PKCE S256 as defense in depth;
- exact redirect URI;
- `access_type=offline`;
- `include_granted_scopes=true`;
- `prompt=consent` in this process-memory MVP so a refresh token can be obtained again after local process state is lost;
- explicit validation that the returned token scope contains `drive.readonly`;
- OpenID Connect UserInfo lookup;
- stable Google `sub` as the actor identifier rather than email.

The OAuth client secret is sent only from the Node process to Google's token endpoint. It is never part of the browser authorization URL.

## 5. Credential custody

The connector reuses EveGlyph's process-scoped in-memory credential broker.

Raw Google credentials are held only in Node process memory:

```text
access token
refresh token
access-token expiry
refresh-token expiry (when Google supplies one)
```

The browser receives only redacted state:

```text
credential_id (opaque handle)
public account metadata
token expiry timestamp
EveGlyph capability grant metadata
Drive file metadata/read results
```

Raw credentials are not placed in:

- browser persistence;
- Settings input fields;
- workspace files;
- `.eveglyph/`;
- documents;
- AIMD-C/document computation;
- publication artifacts;
- MCP request/response payloads;
- MCP child processes;
- Git history.

Restarting the Vite/Node process destroys this first-generation credential broker and requires Google authentication again.

## 6. Internal EveGlyph capability model

The connector uses the zero-authority `connector-session` profile. Authentication creates no ambient Drive capabilities.

### 6.1 Metadata browse

The user must explicitly click **Grant metadata browse for this session**.

The resulting grant is:

```text
capability = connector.google.drive.metadata.list
resource   = google:drive:files:*
lifetime   = session
source     = user-explicit-session
```

Only after that grant may EveGlyph call Drive `files.list`.

The current MVP lists up to 50 non-trashed files per request and returns only bounded public metadata fields:

```text
id
name
mime_type
size
modified_time
web_view_link
```

A provider credential being able to list files does not bypass this EveGlyph grant.

### 6.2 Exact file read

After a file is selected, the user must explicitly click **Grant read for selected file**.

The resulting grant is exact-resource scoped:

```text
capability = connector.google.drive.file.read
resource   = google:drive:file:<fileId>
lifetime   = session
source     = user-explicit-session
```

A grant for file A does not authorize file B.

Capability authorization occurs before:

1. access/refresh-token retrieval from the broker;
2. access-token refresh;
3. Google Drive network requests.

## 7. File reading behavior

### 7.1 Stored Drive text files

For normal stored Drive files the connector:

1. requests metadata with `files.get`;
2. checks the declared file size when present;
3. downloads content with `files.get?alt=media`;
4. enforces a 1 MiB connector limit on actual bytes;
5. decodes with fatal UTF-8 validation.

Invalid UTF-8 fails closed rather than silently replacing bytes.

### 7.2 Google Docs

Google Docs are Google Workspace objects rather than stored byte files, so EveGlyph does not use `alt=media` for them.

PR-C uses Drive `files.export` with:

```text
mimeType=text/markdown
```

Google's current Drive export-format table lists Markdown (`text/markdown`, `.md`) as a supported Google Docs export format:

<https://developers.google.com/workspace/drive/api/guides/ref-export-formats>

The same EveGlyph 1 MiB text limit and UTF-8 validation apply to the exported bytes.

### 7.3 Other Google Workspace object types

This MVP rejects other `application/vnd.google-apps.*` object types with `google_drive_export_unsupported` rather than guessing an export format.

Future support can add explicit typed mappings for Sheets, Slides, Drawings, Vids, and other Workspace objects without changing the authorization model.

## 8. Refresh behavior

When the access token is within 30 seconds of expiry, the service refreshes it before making a Drive request.

Refresh uses the broker-held refresh token. If Google returns only a new access token, the existing refresh token is preserved. Missing, expired, or rejected refresh credentials fail closed as `google_reauthentication_required`.

## 9. Browser and localhost boundary

The Google connector HTTP surface exists only under the Vite dev server and uses the same localhost Host/Origin posture as the GitHub connector.

Routes:

```text
GET  /api/connectors/google/status
POST /api/connectors/google/auth/start
GET  /api/connectors/google/callback
POST /api/connectors/google/disconnect
POST /api/connectors/google/grant-metadata
GET  /api/connectors/google/list-files
POST /api/connectors/google/grant-file-read
POST /api/connectors/google/read-file
```

Errors are mapped to stable public codes/messages before reaching browser JSON or callback HTML. Raw provider exceptions are not serialized.

## 10. Build boundary

The Settings UI is injected by a Vite `transformIndexHtml` hook with `order: 'pre'`. This is intentional: Vite must discover and bundle `/src/googledrivesettings.js` instead of leaving a raw source-module path in `dist/index.html`.

CI verifies:

```text
dist/index.html contains s-google-wrap
dist/index.html does not contain /src/googledrivesettings.js
a hashed JS asset contains /api/connectors/google/
```

## 11. MCP and document-runtime boundary

`mcp-server.js` and `mcp-server-remote.js` remain separate processes. PR-C does not share the Google credential broker with them.

The document-only runtime also does not receive Google credentials or a Drive client.

This is deliberate. Future MCP Google access must use an explicit identity/credential delegation design rather than copying raw refresh tokens across process boundaries.

## 12. Explicit non-goals

PR-C does not implement:

- Google Drive write/create/update/delete;
- Google Picker / `drive.file` narrow-file flow;
- shared-drive-specific UX;
- persistent encrypted credential storage or OS keychain integration;
- multi-account switching;
- OAuth token revocation UI;
- DPoP-bound Google tokens;
- MCP credential sharing;
- Google Calendar/Gmail/Contacts connectors;
- public SaaS tenancy, billing, quota management, or Google production verification automation.

## 13. Verification commands

```sh
npm ci
npm run test:google-connector
npm run test:github-connector
npm run test:capabilities
npm run test:publication
npm run build
node scripts/verify_github_connector_build.mjs
node scripts/verify_google_drive_connector_build.mjs
npm run verify:dynamic-logic
npm run verify:dynamic-rendering
```

The GitHub Actions workflow packages the exact verified head with `git archive` only after all gates pass.
