# EveGlyph Capability Foundation + Document-Only Enforcement — Design

**Date:** 2026-08-28  
**Branch:** `feat/capability-sandbox-foundation`  
**Target:** `main`  
**Status:** Approved implementation slice derived from `EveGlyph External Connector & Capability Sandbox Runtime v0.1`

## 1. Goal

Build the first security-control-plane slice for EveGlyph external capabilities without adding Google/GitHub credentials, OAuth, arbitrary code execution, or a new low-level sandbox backend.

This PR establishes a provider-neutral capability registry, actor context, grants, deny-by-default policy evaluation, an in-memory audit ledger, a `document-only` profile, an AIMD-C document execution wrapper, and an MCP tool-to-capability map.

The key invariant is:

> Document computation starts with document-scoped authority only. Workspace, network, process, host environment, and external connector authority must never appear implicitly.

## 2. Existing Baseline

The current repository already has:

- AIMD-C parsing/evaluation in `src/aimdc/*`;
- Dynamic Logic projections passed into AIMD-C as read-only document-runtime refs;
- local workspace read/write MCP tools in `mcp-tools.js`;
- publication MCP tools composed through `mcp-server-factory.js` / `mcp-publication.js`;
- stdio and remote HTTP MCP transports sharing the same capability implementation;
- a pull-request GitHub Actions workflow that runs publication tests, build, and dynamic regressions.

AIMD-C currently has no arbitrary filesystem/network/process API. This PR preserves that property and adds an explicit authority boundary around document execution rather than adding host functionality.

## 3. Scope

### In scope

- capability registry;
- actor context model;
- resource-scoped grant model;
- lifetime model (`once`, `session`, `workspace`, `until`, `persistent`);
- `document-only` profile;
- deny-by-default/fail-closed policy evaluation;
- audit evidence for allow and deny decisions;
- exact-resource and trailing-wildcard resource matching;
- canonical capability session API;
- canonical AIMD-C document execution wrapper;
- explicit MCP tool → capability request mapping;
- tests and CI wiring;
- security/documentation updates.

### Out of scope

- OAuth/OIDC implementation;
- credential vault implementation;
- Google/GitHub provider calls;
- GitHub App installation flow;
- Google Drive scopes;
- Wasmtime/Deno/Bubblewrap/gVisor/Firecracker execution backends;
- persistent grants database;
- interactive permission UI;
- remote MCP OAuth middleware;
- changing legacy MCP bearer-token behavior in this PR.

The mapping and policy primitives introduced here are intentionally usable by those later PRs.

## 4. Capability Registry

Capability IDs are stable strings. Unknown capability IDs fail closed.

Initial registry:

```text
document.read.self
document.compute
ephemeral.output
workspace.read
workspace.write
network.connect
process.spawn
host.env.read
connector.github.repository.contents.read
connector.github.repository.contents.write
connector.google.drive.file.read
connector.google.drive.file.write
```

Read and write capabilities are separate. No hierarchical implication is inferred from naming.

Each registry entry exposes minimal metadata:

```js
{
  id,
  risk: 'low' | 'medium' | 'high',
  description
}
```

## 5. Actor Context

A capability decision carries an actor chain rather than only a user name.

The first version normalizes these optional string fields:

```js
{
  humanPrincipal,
  client,
  agent,
  document,
  session
}
```

Unknown extra fields are not required for PR-A. The object is immutable after normalization.

## 6. Capability Requests

A request is:

```js
{
  capability,
  resource,
  lifetime,
  reason,
  context
}
```

Rules:

- `capability` must exist in the registry;
- `resource` is a non-empty canonical string;
- `lifetime` must be one of the supported lifetime values;
- `context` is plain structured metadata and does not itself grant authority;
- invalid/unknown requests are denied/fail closed.

Example:

```text
capability = connector.github.repository.contents.read
resource   = github:repo:kakon77777-commits/eveglyph-editor
lifetime   = once
```

## 7. Grants

A grant is explicit authority supplied to a capability session:

```js
{
  capability,
  resource,
  lifetime,
  source,
  grantedBy,
  expiresAt
}
```

Rules:

- exact capability match is required;
- resource matches either exactly or by one trailing `*` wildcard prefix;
- a read grant never matches a write request;
- `until` requires a valid `expiresAt`;
- expired grants never authorize;
- unknown capability grants are rejected when normalized;
- no grant inheritance is inferred from profile names or capability prefixes.

`once` is represented and audited in PR-A but is not globally persisted. A capability session consumes a matching `once` grant after its first successful authorization so a second authorization requires another grant.

## 8. Document-Only Profile

The default profile contains only:

```text
document.read.self  -> document:self
document.compute    -> document:self
ephemeral.output    -> execution:*
```

It does not include:

```text
workspace.read
workspace.write
network.connect
process.spawn
host.env.read
connector.*
```

Profile grants are treated as built-in grants for the lifetime of the capability session. They do not mutate user/persistent grant storage.

## 9. Capability Session and Audit Ledger

`createCapabilitySession()` is the canonical policy entry point.

Responsibilities:

- normalize actor/profile/grants;
- authorize or require a request;
- fail closed on unknown capabilities/resources/lifetimes;
- consume `once` grants after successful use;
- append an immutable audit record for every allow/deny decision;
- expose a snapshot for UI/MCP/evidence layers.

A decision record includes at minimum:

```js
{
  eventId,
  timestamp,
  actor,
  profile,
  request,
  decision: 'allow' | 'deny',
  reason,
  grantSource
}
```

Denied requests are evidence too; they must not disappear from the ledger.

For deterministic tests, the session accepts injectable `now()` and `idFactory()` functions. Production defaults use real time and `crypto.randomUUID()`.

## 10. Document Runtime Wrapper

`src/capabilities/document-runtime.js` becomes the canonical high-level entry for AIMD-C execution where authority matters.

It:

1. creates or receives a capability session;
2. requires `document.read.self` on `document:self`;
3. requires `document.compute` on `document:self`;
4. requires `ephemeral.output` on `execution:aimdc`;
5. only then invokes the existing low-level `evaluateDocument()`;
6. returns the existing result plus a `sandbox` snapshot containing profile and audit evidence.

Dynamic Logic `externalRefs` remain allowed because they are read-only projections produced inside the same document runtime and are covered by `document.read.self`; this PR does not reinterpret them as network/provider access.

The low-level graph evaluator remains pure and reusable. It does not receive filesystem/network/credential objects.

## 11. MCP Tool Capability Mapping

Create a transport-neutral mapping helper. It does not change bearer-token compatibility behavior yet; it makes authority requirements explicit for later middleware.

Required mappings include:

```text
list_files                  -> workspace.read
read_file                   -> workspace.read
write_file                  -> workspace.write
evaluate_aimdc              -> document.read.self + document.compute + ephemeral.output
validate_world_ir           -> document.read.self + document.compute
get_publication_capabilities-> document.read.self
inspect_document            -> document.read.self + document.compute
validate_document           -> document.read.self + document.compute
render_document             -> document.read.self + document.compute + ephemeral.output
get_render_artifact         -> ephemeral.output
get_render_report           -> ephemeral.output
```

Resources are derived from tool arguments where possible. Unknown MCP tool names fail closed in the mapping helper rather than returning an empty requirement set.

This PR does **not** put all current MCP calls behind a newly enforced session because no user-facing grant acquisition flow exists yet. Document execution itself is enforced immediately; full remote MCP authorization middleware is a later PR.

## 12. Error Semantics

Stable errors introduced by this PR:

```text
unknown_capability
invalid_capability_request
invalid_grant
unknown_profile
capability_denied
unknown_mcp_tool
```

`CapabilityDeniedError` carries the denied decision record so callers can surface audit evidence without parsing an error string.

## 13. Testing

Use Node's built-in test runner.

Required behavior coverage:

1. `document-only` exposes exactly the three default capabilities/scopes;
2. workspace/network/process/env/provider capabilities are denied by default;
3. unknown capability fails closed;
4. denied decisions appear in the audit ledger with actor context;
5. exact-resource grant allows only that resource;
6. read grant does not imply write;
7. expired grant denies;
8. `once` grant is consumed after one successful decision;
9. AIMD-C execution succeeds through the document runtime under `document-only`;
10. Dynamic Logic-style external refs still work through the wrapper;
11. document runtime rejects an explicitly requested non-document capability without a grant;
12. MCP mapping covers current base/publication tools and unknown tools fail closed.

CI adds the new capability test command before existing publication/build/dynamic regression steps.

## 14. Acceptance Criteria

PR-A is complete only when:

1. document computation has an explicit `document-only` authority boundary;
2. no filesystem/network/process/env/provider authority exists in that profile;
3. capability requests carry resource and lifetime;
4. allow and deny decisions emit actor-aware audit evidence;
5. explicit grants are resource-scoped and fail closed;
6. read does not imply write;
7. current AIMD-C and Dynamic Logic behavior remains compatible;
8. existing publication/runtime/build/dynamic regressions remain green;
9. MCP tools have explicit capability mappings without silently changing legacy remote-auth behavior;
10. no OAuth token, provider credential, or low-level sandbox dependency is introduced.
