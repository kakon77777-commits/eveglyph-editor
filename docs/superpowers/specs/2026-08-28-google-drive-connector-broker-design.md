# Google Drive Connector + Credential Broker — Design Specification

Date: 2026-08-28  
Status: approved bounded continuation / PR-C  
Repository: `kakon77777-commits/eveglyph-editor`  
Stacked base: PR #8 / `877588daad20ada72aeb08e20a336bc95f268de7`

## 1. Context

PR #7 introduced EveGlyph's provider-neutral capability control plane and deny-by-default `document-only` runtime.

PR #8 introduced the first external connector vertical slice:

```text
identity
→ credential broker
→ explicit resource grant
→ capability check
→ provider read
```

PR-C applies that same authority model to Google Drive. It does not introduce a second authorization vocabulary.

## 2. Goals

PR-C must provide:

1. Google OAuth web-server authentication;
2. server-side Google credential custody;
3. stable Google actor identity using OpenID Connect `sub`;
4. explicit Drive metadata-list authority;
5. explicit exact-file read authority;
6. read-only Drive metadata/content operations;
7. Google Docs Markdown export;
8. localhost browser UX with no raw credential surface;
9. executable TDD and build-artifact evidence.

## 3. Non-goals

PR-C does not provide:

- Drive write/create/update/delete;
- Google Picker or `drive.file` UX;
- persistent keychain/encrypted credential storage;
- credential delegation to MCP processes;
- multi-account switching;
- shared-drive-specific UX;
- DPoP implementation;
- public SaaS verification automation;
- Calendar/Gmail/Contacts connectors.

## 4. Provider authorization versus EveGlyph authority

Google provider scope and EveGlyph authorization are distinct layers.

Provider request:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.readonly
```

Internal session begins with:

```text
profile = connector-session
grants  = []
```

Therefore:

```text
Google OAuth success
!=
Drive metadata-list authority
!=
Drive file-read authority
```

The broad provider credential must never be interpreted as an ambient EveGlyph capability.

## 5. Capability model

### 5.1 Metadata list

```text
capability = connector.google.drive.metadata.list
resource   = google:drive:files:*
lifetime   = session
source     = user-explicit-session
```

Runtime request uses a child resource such as:

```text
google:drive:files:list
```

### 5.2 Exact file read

```text
capability = connector.google.drive.file.read
resource   = google:drive:file:<fileId>
lifetime   = session
source     = user-explicit-session
```

A grant for file A must never match file B.

## 6. Ordering invariant

For every provider action:

```text
validate public input
→ capability authorize
→ resolve/refresh opaque credential
→ provider network request
→ bounded decode/normalize
→ redacted public result
```

Capability denial must occur before broker token access and before network I/O.

## 7. OAuth design

Use Google's confidential web-server flow with:

- exact redirect URI;
- random state;
- one-time state consumption before token exchange;
- 10-minute state TTL;
- PKCE S256 defense in depth;
- `access_type=offline`;
- `include_granted_scopes=true`;
- `prompt=consent` for the process-memory MVP;
- token-scope validation for `drive.readonly`;
- UserInfo lookup after token exchange;
- stable `sub` identity.

Client secret is Node-side only.

## 8. Credential model

Reuse `server/credentials/memory-broker.js`.

Stored secret fields:

```text
accessToken
accessExpiresAt
refreshToken
refreshExpiresAt
```

Public descriptions expose only opaque credential id, provider, public account metadata, and expiry timestamps.

Vite process restart destroys credentials and grants.

## 9. Drive API model

### Metadata

Use Drive v3 `files.list` with a bounded field projection and page size 50.

### Stored file content

Use:

```text
GET /drive/v3/files/<fileId>?alt=media
```

after a metadata lookup.

### Google Docs

Use:

```text
GET /drive/v3/files/<fileId>/export?mimeType=text/markdown
```

Other Google Workspace MIME families fail closed until an explicit typed export mapping is designed.

### Content bound

EveGlyph imposes a 1 MiB connector text limit even if Google permits a larger provider transfer.

UTF-8 decoding is fatal/strict.

## 10. HTTP boundary

Local dev routes:

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

Host/Origin locality checks mirror the GitHub connector.

Controller errors map internal exceptions to stable public codes and fixed messages.

## 11. Browser UX

Settings must expose:

1. Connect Google / Disconnect;
2. explicit metadata browse grant;
3. list Drive files;
4. select one file;
5. explicit exact-file read grant;
6. read selected file.

The browser must have no access-token, refresh-token, or client-secret input/storage surface.

Read content is rendered with `textContent`.

## 12. Build invariant

Google Settings HTML is injected through a Vite pre-order HTML transform.

CI must prove:

```text
s-google-wrap exists in dist/index.html
/src/googledrivesettings.js does not exist in dist/index.html
/api/connectors/google/ exists in a hashed built JS asset
```

## 13. Restricted-scope production constraint

`drive.readonly` is a broad Google Drive scope. Current Google production rules can require OAuth verification and, for restricted data accessed through third-party servers, a security assessment unless an exception applies.

This does not invalidate the local MVP, but it is a launch constraint and must remain explicit in operator documentation.

A future public product may migrate toward a Google Picker + `drive.file` architecture when per-file provider authorization is preferable to broad provider read scope.

## 14. Security invariants

- Authentication does not imply Drive authority.
- Metadata-list does not imply file-read.
- File A read does not imply file B read.
- Read does not imply write.
- Credential access follows capability authorization.
- Raw credentials remain Node-side.
- MCP/document runtimes do not receive the broker.
- Unknown capabilities and unsupported Workspace exports fail closed.
- Browser and callback responses are redacted.
- Production build must bundle the Settings client rather than serving raw source modules.
