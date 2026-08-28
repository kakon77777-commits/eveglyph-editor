# MCP Delegated Connectors

Status: PR-E operator/security guide  
Scope: read-only GitHub and Google Drive connector use from EveGlyph MCP without provider credential export

## 1. Core model

PR-E allows MCP to use an external-service operation without receiving the external-service credential.

```text
provider credential
!=
connector-session grant
!=
delegation ticket
```

A delegated MCP operation requires all of the following at execution time:

```text
valid short-lived delegation ticket
AND
matching live EveGlyph connector-session grant
AND
connected/restored provider identity
```

A ticket is therefore not a replacement for the live connector authorization state. If the provider is disconnected or the session grant is absent, a still-unexpired ticket fails.

## 2. Supported MCP tools

PR-E exposes only three read-only delegated operations:

```text
github_read_file_delegated
google_drive_list_files_delegated
google_drive_read_file_delegated
```

No GitHub or Google create/update/delete/write operation is added.

### GitHub file read

Authority:

```text
provider   = github
operation  = read-file
capability = connector.github.repository.contents.read
resource   = github:repository:<owner>/<repo>:contents:<path>
```

Inputs:

```text
delegation_ticket
repository
path
ref?                 # optional
```

### Google Drive metadata list

Authority:

```text
provider   = google
operation  = list-files
capability = connector.google.drive.metadata.list
resource   = google:drive:files:list
```

Inputs:

```text
delegation_ticket
page_token?           # optional
```

### Google Drive file read

Authority:

```text
provider   = google
operation  = read-file
capability = connector.google.drive.file.read
resource   = google:drive:file:<fileId>
```

Inputs:

```text
delegation_ticket
file_id
```

Google Docs continue to export as `text/markdown`; unsupported Google Workspace object types continue to fail closed.

## 3. Normal operator flow

Start the credential-owning EveGlyph process:

```sh
npm run dev
```

Then in Settings:

```text
connect GitHub or Google
→ obtain the existing explicit session grant
→ issue the matching MCP delegation ticket
→ copy that one-use ticket intentionally
→ call the delegated MCP tool
```

GitHub:

```text
Connect GitHub
→ Grant read for owner/repo
→ choose repository + path (+ optional ref)
→ Issue MCP read ticket
```

Google Drive metadata:

```text
Connect Google
→ Grant metadata browse
→ Issue MCP list ticket
```

Google Drive file:

```text
Connect Google
→ Grant metadata browse
→ List files
→ select file
→ Grant read for selected file
→ Issue MCP file ticket
```

Ticket issuance itself performs a live capability decision. Restored provider identity with zero fresh session grants cannot mint a ticket.

## 4. Ticket behavior

PR-E uses the PR-D delegation broker defaults:

```text
raw source:       32 random bytes
encoding:         base64url
stored server-side: SHA-256(ticket) only
TTL:              60 seconds by default
uses:             1 by default
hard TTL maximum: 300 seconds
hard use maximum: 10
```

PR-E Settings issues one-use tickets.

EveGlyph does not persist a raw ticket to:

- OS keyring;
- browser `localStorage`;
- browser `sessionStorage`;
- workspace files;
- `.eveglyph/`;
- Git history;
- monitor logs;
- publication artifacts.

The Settings surface shows the newly issued raw value only in live DOM state. Reloading loses the displayed value.

### MCP host logging warning

The delegation ticket is a tool argument. A third-party MCP host may independently record tool calls or tool arguments. EveGlyph cannot prevent that external logging.

For that reason, tickets are short-lived and one-use. Treat a ticket as temporary operation authority, not as a reusable account credential.

## 5. Standalone stdio MCP

The normal standalone server remains:

```sh
node mcp-server.js /absolute/path/to/workspace
```

Delegated connector tools are registered only when the MCP process receives:

```text
EVEGLYPH_DELEGATION_ENDPOINT
```

That endpoint must point to the live local delegation server owned by the EveGlyph Vite process.

If the variable is absent:

```text
base workspace MCP tools     available
aimd/publication tools       available
delegated connector tools    absent
```

This keeps existing MCP behavior unchanged for operators who do not opt into delegation.

The credential-owning EveGlyph runtime must remain alive while delegated connector operations are used.

## 6. Remote MCP

The existing remote MCP process still uses its bearer-token compatibility authentication:

```text
EVEGLYPH_MCP_TOKEN
```

PR-E does not replace that transport authentication with OAuth.

When Settings starts the remote MCP process, the Vite parent injects only the local delegation endpoint in addition to the existing MCP token/port configuration:

```text
EVEGLYPH_DELEGATION_ENDPOINT=<local pipe/socket>
```

It does not inject:

- GitHub access/refresh tokens;
- Google access/refresh tokens;
- provider credential ids;
- keyring objects;
- credential envelopes;
- provider OAuth client secrets.

A remote delegated connector call therefore requires both:

1. access to the remote MCP transport under the existing bearer-token model; and
2. a valid short-lived delegated-operation ticket supplied to the tool call.

## 7. IPC and input binding

MCP communicates with the credential-owning process through the local PR-D `node:net` IPC boundary.

The MCP process sends:

```text
method = invoke
provider
operation
capability
resource
ticket
input
```

The credential-owning handler does not trust the caller's `resource` declaration by itself. It normalizes the operation input again and recomputes the canonical resource.

Therefore this substitution attempt fails:

```text
ticket/resource = file A
input           = file B
```

The handler requires the recomputed provider/operation/capability/resource to match the consumed delegation record before calling the provider service.

After that match, the existing live connector service runs its own connector-session capability decision again before credential access and provider network I/O.

## 8. Credential boundary

MCP may import/use only the credential-free delegated operation path:

```text
canonical delegated contract
local delegation IPC client
```

MCP does not receive/import:

```text
@napi-rs/keyring
system-keyring vault
persistent credential broker
memory credential broker
provider OAuth clients
provider refresh helpers
accessToken
refreshToken
clientSecret
credential envelope
```

The MCP-side IPC client does not call GitHub or Google APIs directly.

## 9. Errors

Delegated tools expose stable public errors such as:

```text
delegation_endpoint_unavailable
delegation_not_found
delegation_expired
delegation_mismatch
delegation_invalid
delegation_service_unavailable
capability_denied
github_not_connected
google_drive_not_connected
github_reauthentication_required
google_reauthentication_required
```

Unknown internal exceptions remain redacted.

A consumed one-use ticket cannot be replayed even if the provider operation later fails.

## 10. Verification

PR-E adds an executable MCP delegation boundary verifier in addition to the existing credential boundary verifier.

Final CI must run:

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

Only after those gates pass should the exact PR head be archived.

## 11. Explicit non-goals

PR-E does not implement:

- GitHub/Google write operations;
- raw provider token delegation;
- long-lived MCP broker sessions;
- automatic MCP authority minting;
- remote delegation over TCP/HTTP;
- remote MCP OAuth hardening;
- persistence of connector-session grants;
- persistence of delegation tickets;
- Wasmtime/WASI or other physical computation sandbox enforcement;
- multi-user/SaaS delegation tenancy.

Those require separate designs and validation.