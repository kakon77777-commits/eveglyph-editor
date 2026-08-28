# MCP Delegated Connector Operations — Design Specification

Status: approved PR-E design  
Date: 2026-08-28  
Repository: `kakon77777-commits/eveglyph-editor`  
Stacked base: PR-D / `e94c54f297d319e03f729c9931f7768c08e198f4`  
Target branch: `feat/mcp-delegated-connector-operations`

## 1. Purpose

PR-E allows EveGlyph MCP clients to use the read-only GitHub and Google Drive connector capabilities introduced in PR-B/PR-C without giving the MCP process access to OAuth credentials, the OS keyring, the persistent credential broker, or provider refresh tokens.

The central claim is:

```text
MCP may use an external-service capability
without receiving the external-service credential.
```

PR-D already established three separate objects:

```text
provider credential
!=
EveGlyph connector-session grant
!=
delegation ticket
```

PR-E connects the third object to MCP through a local delegated-operation IPC path while preserving the first two boundaries.

## 2. Architectural choice

PR-E uses explicit, short-lived, one-use delegation tickets carried by individual MCP connector tool calls.

Rejected alternatives:

1. **Move MCP into the credential-owning Vite process.** This reduces wiring but collapses the process boundary PR-D intentionally created.
2. **Give MCP a long-lived broker/session credential that can mint its own delegations.** This can improve UX later, but introduces a new bootstrap identity and revocation domain and is deferred to a separate PR.

The selected PR-E model is deliberately narrower:

```text
user grants connector authority in EveGlyph
        ↓
EveGlyph issues one exact delegated operation ticket
        ↓
MCP presents ticket for one connector tool call
        ↓
local IPC validates and consumes ticket
        ↓
credential-owning process re-checks live connector authority
        ↓
connector performs provider request
        ↓
credential-free result returns to MCP
```

## 3. Security invariants

### 3.1 Delegation is operation authority, never credential export

MCP source must not import or receive:

- `@napi-rs/keyring`;
- system-keyring vault objects;
- persistent credential broker objects;
- access tokens;
- refresh tokens;
- provider client secrets;
- credential envelopes;
- provider OAuth refresh helpers.

The intended path is:

```text
MCP process
  ↓ delegation ticket + operation input
local IPC
  ↓
credential-owning EveGlyph process
  ↓
provider connector service
  ↓
GitHub / Google API
```

Not:

```text
MCP process
  ↓ getAccessToken()
GitHub / Google API
```

### 3.2 Delegation ticket and live connector grant are both required

A valid delegation ticket does not replace the live EveGlyph connector-session grant.

Execution requires:

```text
valid delegation ticket
AND
matching live connector-session grant
AND
connected/restored provider identity
```

If the user disconnects the provider, if the credential disappears, or if the live session grant is absent, a still-unexpired ticket must fail.

### 3.3 Restored identity still restores zero connector grants

PR-D behavior remains unchanged. Restart may restore provider identity from the OS keyring, but GitHub repository grants and Google Drive metadata/file grants remain empty until the user grants them again.

A ticket cannot be minted from restored identity alone.

### 3.4 Ticket use is explicit and bounded

PR-E uses the existing PR-D defaults unless a future design explicitly changes them:

```text
raw ticket bytes: 32 random bytes, base64url encoded
stored form:       SHA-256(ticket) only
TTL default:       60 seconds
TTL hard maximum:  300 seconds
uses default:      1
uses hard maximum: 10
```

PR-E issuance uses one-use tickets by default.

### 3.5 Ticket values are not persisted by EveGlyph

Raw delegation tickets must not be written to:

- OS keyring;
- browser `localStorage`;
- browser `sessionStorage`;
- workspace files;
- `.eveglyph/`;
- Git history;
- monitor/audit logs;
- publication artifacts.

The Settings UI may render a newly issued ticket in live DOM state and may allow the user to copy it. Reloading the page loses that displayed ticket.

MCP hosts may independently log tool arguments. PR-E cannot control third-party MCP-host logging, so tickets remain short-lived and one-use and documentation must warn operators not to treat a delegation ticket as a reusable credential.

## 4. Credential-owning process

The credential-owning process remains the EveGlyph Vite/Node process created by `npm run dev`.

It owns:

- the shared provider-neutral credential runtime;
- restored GitHub/Google identity;
- connector-session grants;
- one shared PR-D delegation broker;
- one local delegation IPC server;
- provider connector services and delegated operation handlers.

MCP processes remain separate.

## 5. Shared delegated-operation contract

PR-E must define one pure, credential-free operation contract consumed by both the credential-owning process and MCP registration code.

Recommended module boundary:

```text
server/connectors/delegated-contracts.js
```

The module may contain:

- tool name;
- provider id;
- operation id;
- capability id;
- safe input normalization;
- canonical authorization-resource construction.

It must not import credential/keyring/broker modules or perform network I/O.

This prevents the MCP side and the connector side from independently inventing resource strings.

## 6. PR-E delegated operations

Only three read-only operations are in scope.

### 6.1 GitHub repository file read

MCP tool:

```text
github_read_file_delegated
```

Delegation contract:

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
ref?                 # optional provider input; not a separate authority resource
```

The repository/path normalization must be equivalent to the existing GitHub connector normalization. Leading `/`, empty segments, `.`/`..`, NULs and invalid repository identifiers remain rejected.

`ref` remains operation input rather than a separate capability resource because the current GitHub authority vocabulary scopes repository/path, not Git ref. The one-use ticket still prevents replay across multiple refs.

### 6.2 Google Drive metadata list

MCP tool:

```text
google_drive_list_files_delegated
```

Delegation contract:

```text
provider   = google
operation  = list-files
capability = connector.google.drive.metadata.list
resource   = google:drive:files:list
```

Inputs:

```text
delegation_ticket
page_token?           # optional provider pagination input
```

The current connector page-token validation remains authoritative.

### 6.3 Google Drive exact file read

MCP tool:

```text
google_drive_read_file_delegated
```

Delegation contract:

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

The current Google file-id validation remains authoritative. Google Docs continue to export as `text/markdown`; unsupported Workspace object types remain fail-closed.

## 7. Issuance model

Delegation tickets are minted only by the credential-owning process after proving current connector authority.

### 7.1 GitHub issuance

The connector side must normalize `repository`, `path`, and optional `ref`, then require the current live capability:

```text
connector.github.repository.contents.read
on github:repository:<owner>/<repo>:contents:<path>
```

Only after that allow decision may it issue:

```text
provider   = github
operation  = read-file
capability = connector.github.repository.contents.read
resource   = github:repository:<owner>/<repo>:contents:<path>
actor      = current authenticated GitHub human principal
```

A repository A grant cannot mint a repository B ticket.

### 7.2 Google metadata issuance

The connector side must require:

```text
connector.google.drive.metadata.list
on google:drive:files:list
```

before issuing the `google / list-files` ticket.

### 7.3 Google exact-file issuance

The connector side must normalize `fileId` and require:

```text
connector.google.drive.file.read
on google:drive:file:<fileId>
```

before issuing the `google / read-file` ticket.

A file A grant cannot mint a file B ticket.

### 7.4 Actor attribution

The delegation record actor is the authenticated provider principal already held by the connector service:

```text
GitHub: github:user:<id>
Google: google:account:<sub>
```

PR-E does not claim that a standalone stdio MCP process has a separately authenticated human identity. Its caller attribution is `eveglyph-mcp` plus transport/context metadata; the provider human principal remains the authority source for delegation issuance.

## 8. Live re-authorization at execution time

Ticket issuance and ticket consumption are not enough by themselves.

After the IPC server consumes the ticket, the provider handler must call the existing connector operation through the live connector service:

```text
GitHub handler
→ service.readRepositoryFile(...)

Google metadata handler
→ service.listDriveFiles(...)

Google file handler
→ service.readDriveFile(...)
```

Those service methods re-run the current `connector-session` capability decision before credential access/network I/O.

Therefore:

```text
ticket minted
→ user disconnects or grant disappears
→ later IPC invocation fails
```

## 9. Input/resource binding at the IPC server

The IPC caller is untrusted with respect to operation input.

It is not sufficient to validate only the request's declared `resource` field, because a malicious caller could present:

```text
ticket/resource = file A
input           = file B
```

Therefore every registered delegated handler must:

1. normalize its `input` using the shared delegated-operation contract;
2. recompute the canonical resource from normalized input;
3. require equality with the consumed delegation record's provider, operation, capability and resource;
4. only then call the live connector service.

This server-side recomputation is mandatory even though the MCP client also computes the same resource.

## 10. Delegation runtime composition

PR-E adds a small provider-neutral runtime around the PR-D primitives.

Recommended responsibilities:

```text
createConnectorDelegationRuntime(...)
  ├── owns createDelegationBroker()
  ├── owns one createDelegationIpcServer(...)
  ├── exposes stable endpoint
  ├── registers provider operation handlers
  ├── issues tickets through one broker
  └── starts/stops IPC with Vite lifecycle
```

The runtime must not expose raw delegation records containing secrets beyond the one returned raw ticket at issuance.

On Unix the existing `0600` socket behavior remains. On Windows the existing named-pipe behavior remains.

## 11. Vite composition

`vite.config.js` remains the composition root for the credential-owning process.

Expected high-level composition:

```text
credentialRuntime = createCredentialRuntime(...)
delegationRuntime = createConnectorDelegationRuntime(...)

plugins:
  delegation runtime lifecycle
  agent bridge (receives delegation endpoint for remote MCP child)
  GitHub connector bridge (credential broker + delegation runtime)
  Google connector bridge (credential broker + delegation runtime)
  Settings UI transforms
```

The delegation IPC server starts with the Vite process and stops when the Vite server closes.

## 12. Remote MCP lifecycle

The existing remote MCP server is spawned by the Vite agent bridge.

PR-E may inject only the delegation IPC endpoint into that child environment:

```text
EVEGLYPH_DELEGATION_ENDPOINT=<local socket or named pipe>
```

It must not inject provider access tokens, refresh tokens, credential ids, keyring objects, or serialized credential envelopes.

Remote MCP still separately requires its existing `EVEGLYPH_MCP_TOKEN` bearer-token compatibility authentication. PR-E does not replace or upgrade remote MCP authentication.

A remote delegated connector call therefore requires both:

1. access to the remote MCP transport under its existing bearer-token model; and
2. a valid short-lived delegated-operation ticket supplied in the connector tool call.

## 13. Standalone stdio MCP lifecycle

A standalone MCP host that launches:

```sh
node mcp-server.js <workspace>
```

may use delegated connector tools only when:

```text
EVEGLYPH_DELEGATION_ENDPOINT
```

points at a live EveGlyph Vite delegation IPC server.

This implies that `npm run dev` (or an equivalent future credential-owning runtime) must be running for delegated connector operations.

If no delegation endpoint is configured, PR-E must not register the three delegated connector tools. Existing workspace, AIMD-C and publication tools continue unchanged.

## 14. MCP-side IPC client

PR-E adds a small local IPC client module used by MCP connector tools.

Responsibilities:

- accept an endpoint from configuration/environment;
- open only the local endpoint supplied by the operator/parent EveGlyph process;
- serialize one bounded `invoke` request;
- bound the response size;
- parse the stable PR-D IPC response;
- surface stable error code/message;
- never log, persist or return the raw delegation ticket.

The MCP process does not call GitHub or Google directly.

## 15. MCP tool registration

A separate connector MCP registration module should be composed by `mcp-server-factory.js` so stdio and remote transports expose the same delegated connector surface whenever a delegation endpoint is available.

Recommended composition:

```text
createMcpServer(workspaceRoot, { delegationEndpoint? })
  ↓
base workspace tools
publication tools
delegated connector tools (only when endpoint exists)
```

Both `mcp-server.js` and `mcp-server-remote.js` derive the endpoint from:

```text
EVEGLYPH_DELEGATION_ENDPOINT
```

The remote process receives that variable from its Vite parent. A standalone stdio MCP host configures it explicitly.

## 16. MCP capability mapping

`src/capabilities/mcp-map.js` must include the three PR-E tool names and build the same canonical resource strings used by the delegated-operation contract.

This mapping remains the transport-neutral semantic declaration of the tool's required authority. Actual PR-E execution authority is enforced by the delegation ticket plus live connector-session re-authorization.

Unknown tools continue to fail closed.

## 17. Settings issuance UI

PR-E adds minimal ticket-issuance controls to the existing GitHub and Google Drive Settings surfaces.

### GitHub

Using the existing repository/path/ref controls:

```text
Issue MCP read ticket
```

The button must fail unless the current GitHub session has a matching repository grant.

### Google Drive

Add:

```text
Issue MCP list ticket
Issue MCP file-read ticket
```

The metadata ticket requires the metadata-list grant. The file ticket requires the exact selected-file grant.

### Ticket display

The UI displays:

- raw one-use ticket;
- expiration time;
- provider/operation/resource metadata;
- warning that it is short-lived and may appear in third-party MCP-host tool logs if pasted there.

The ticket is written to DOM using safe text APIs and is not persisted. A copy-to-clipboard action is allowed but must be explicit user action.

## 18. HTTP issuance routes

Ticket issuance is a local-only Vite connector operation and retains the existing Host/Origin local-request posture.

Recommended routes:

```text
POST /api/connectors/github/delegation/read-file
POST /api/connectors/google/delegation/list-files
POST /api/connectors/google/delegation/read-file
```

Responses may contain the newly issued raw ticket because issuance is the one intentional point where the user receives it.

Responses must not contain provider credentials or keyring material.

Issuance endpoints must not write tickets to logs/monitor events.

## 19. Error model

MCP delegated connector tools surface stable public errors only.

Representative errors include:

```text
delegation_endpoint_unavailable
delegation_not_found
delegation_expired
delegation_mismatch
delegation_invalid
ipc_request_too_large
ipc_invalid_json
ipc_handler_not_found
ipc_sensitive_result_blocked
capability_denied
github_not_connected
google_drive_not_connected
```

Provider/keyring exception strings, stack traces, OAuth token values and IPC internals are not returned.

Unknown provider/operation/tool combinations fail closed.

## 20. TDD and verification requirements

PR-E must preserve RED → GREEN evidence for each new boundary.

### 20.1 MCP mapping RED gate

Before production mapping exists, tests require all three tool names and exact resources.

Expected RED: missing tool mapping / unknown tool.

### 20.2 Delegation issuance RED gate

Tests require:

- GitHub issue denied before matching repo grant;
- repo A grant cannot mint repo B/path ticket;
- Google metadata issue denied before metadata grant;
- Google file A grant cannot mint file B ticket;
- issued ticket is one-use/short-lived and public result contains no credential.

Expected RED: issuance API/functions absent.

### 20.3 IPC operation RED gate

Integration tests require:

- correct one-use ticket executes fake/live provider handler exactly once;
- replay fails;
- expired/revoked/mismatched ticket fails;
- `resource A + input B` fails before connector execution;
- oversized/malformed request fails before connector execution;
- credential-shaped handler result remains blocked.

### 20.4 MCP end-to-end RED gate

Start a temporary delegation IPC endpoint and a real stdio MCP server. Confirm a delegated tool call succeeds once and a replay fails.

The test must inspect MCP output and confirm no delegation ticket/provider credential is echoed back.

### 20.5 Credential-boundary regression

Extend `scripts/verify_credential_boundary.mjs` to require:

- MCP may import the safe delegation IPC client and delegated-operation contract;
- MCP still may not import keyring/persistent credential broker/provider OAuth internals;
- MCP still has no provider access/refresh token access;
- browser build has no persisted delegation ticket;
- no raw delegation ticket appears in monitor/log source paths;
- remote MCP parent injects only delegation endpoint, never credential material.

### 20.6 Existing regressions

Final exact-head CI must continue to run and pass:

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

PR-E adds its own delegated-MCP suites before packaging.

Only after all final gates pass may CI run `git archive HEAD` and upload the exact source artifact.

## 21. Documentation requirements

PR-E must update or add operator documentation covering:

- starting the EveGlyph credential-owning Vite runtime;
- locating/propagating `EVEGLYPH_DELEGATION_ENDPOINT`;
- issuing one-use GitHub/Google tickets from Settings;
- configuring standalone stdio MCP;
- automatic endpoint injection for Vite-spawned remote MCP;
- ticket lifetime and third-party MCP-host logging risk;
- explicit statement that provider credentials never enter MCP;
- explicit statement that remote MCP still uses bearer-token compatibility auth.

## 22. Explicit non-goals

PR-E does not implement:

- GitHub write/create/update/delete/commit operations;
- Google Drive write/create/update/delete operations;
- Gmail, Calendar or Contacts connector operations;
- automatic OAuth from an MCP process;
- long-lived MCP broker sessions;
- MCP-controlled delegation minting;
- persistence of delegation tickets;
- persistence of connector-session grants;
- credential/token export to child processes;
- remote TCP/HTTP delegation IPC;
- multi-user/SaaS delegation tenancy;
- remote MCP OAuth hardening;
- Wasmtime/WASI or OS/process sandbox enforcement.

Those remain separate security boundaries.

## 23. Success criteria

PR-E is complete only when all of the following are true:

1. A user with a live GitHub repo grant can explicitly mint one short-lived MCP file-read ticket.
2. A user with a live Google metadata/file grant can explicitly mint the corresponding MCP ticket.
3. An MCP process can execute the matching provider operation through local IPC without receiving provider credentials.
4. Ticket replay, mismatch, expiry, revocation and input/resource substitution all fail closed.
5. Live connector authority is re-checked at execution time.
6. No MCP source imports the OS keyring or persistent provider credential broker.
7. No MCP result returns raw delegation tickets or provider credentials.
8. Existing workspace/publication/document behavior remains unchanged when no delegation endpoint is configured.
9. stdio and remote MCP share one delegated connector registration implementation.
10. Exact-head CI, boundary verification and source artifact packaging all pass before the PR is considered reviewable.
