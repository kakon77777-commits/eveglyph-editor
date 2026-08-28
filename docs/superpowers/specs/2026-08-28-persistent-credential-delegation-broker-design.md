# EveGlyph Persistent Credential Vault & Delegation Broker — Design Specification

## Status

- Date: 2026-08-28
- Branch: `feat/persistent-credential-delegation-broker`
- Stacked base: PR #9 / `feat/google-drive-connector-broker`
- Base SHA: `ea7a53a95d2dc300932acc3fc54402c45a076248`

## Goal

Upgrade the first-generation process-memory GitHub/Google credential custody into a provider-neutral persistent system-keyring broker, while introducing a short-lived delegation ticket and local IPC boundary that lets future child processes request broker-executed operations without ever receiving raw provider access or refresh tokens.

## Non-goals

This PR does not wire GitHub/Google connector operations into MCP, does not expose refresh tokens to another process, does not persist EveGlyph session grants, does not add multi-account UX, and does not add remote-network credential delegation.

## Core invariants

1. OAuth identity is not capability authorization.
2. Persisted credential restoration grants zero connector authority. Repository/file/session grants remain ephemeral and must be reacquired after restart.
3. Raw provider secrets are stored only in an OS-backed keyring backend or, when the operator explicitly chooses `EVEGLYPH_CREDENTIAL_STORE=memory`, in process memory.
4. System-keyring failure must not silently downgrade to plaintext or memory persistence.
5. Browser code, documents, publication output, MCP payloads and workspace files never receive access tokens, refresh tokens, client secrets or serialized credential envelopes.
6. Delegation tickets contain no provider secret. The server stores only a SHA-256 hash of each opaque ticket.
7. Delegation defaults to one use, has a hard maximum lifetime of five minutes, and requires exact provider + operation + capability + resource matching.
8. IPC returns operation results, never credential material. The credential-owning broker executes delegated work on behalf of the caller.

## System keyring backend

Use `@napi-rs/keyring` rather than archived `keytar`.

The backend adapter lives at `server/credentials/system-keyring-vault.js` and exposes a deliberately small interface:

```text
putCredential(envelope)
getCredential(credentialId)
deleteCredential(credentialId)
setActiveCredential(provider, credentialId)
getActiveCredential(provider)
clearActiveCredential(provider)
```

The default service namespace is `EveGlyph Editor`.

Entries are split into:

```text
credential:<credentialId>   -> JSON credential envelope
active:<provider>           -> credentialId
```

This keeps lookup deterministic and avoids requiring keyring enumeration.

## Persistent broker

`server/credentials/persistent-broker.js` wraps the existing memory broker and preserves its public API:

```text
store
describe
withCredential
replaceSecrets
remove
```

It adds:

```text
restoreActive(provider)
```

`store` writes the in-memory record, persists the complete envelope through the vault, and updates the provider active pointer. `replaceSecrets` updates both memory and vault. `remove` destroys both stores and clears the provider pointer when it points at the removed credential.

`restoreActive(provider)` reads the provider pointer and envelope, restores the exact credential id into the memory broker, and returns only the normal redacted description. A stale pointer is cleared. A keyring/backend failure becomes a stable `credential_vault_unavailable` error and does not silently switch storage mode.

To support exact-id restore, the existing memory broker may accept an optional internal `credentialId` input while preserving random ids for normal callers.

## Runtime storage mode

`server/credentials/runtime.js` selects the broker mode:

```text
EVEGLYPH_CREDENTIAL_STORE=system   # default
EVEGLYPH_CREDENTIAL_STORE=memory   # explicit compatibility fallback
```

Unknown values fail closed.

The Vite config creates one provider-neutral broker instance and injects it into both GitHub and Google connector bridges so they share one custody runtime.

Production build may load the module but must not access the operating-system keyring. Keyring reads happen only when a local dev server restores a provider connection or a connector stores/updates/removes a credential.

## Provider restoration

GitHub and Google connector services gain a restoration entry point that accepts a broker-restored credential id. Restoration validates the provider, recreates actor identity from the persisted account metadata, and resets grants to `[]`.

Startup semantics:

```text
Vite configureServer
-> broker.restoreActive('github'|'google')
-> service.restoreAuth(credentialId)
-> identity restored
-> zero EveGlyph connector grants
```

A restored identity therefore cannot immediately access a GitHub repository or Drive metadata/file until the user explicitly grants the relevant session capability again.

## Delegation ticket broker

`server/credentials/delegation-broker.js` creates opaque capability tickets.

Ticket claims:

```text
provider
operation
capability
resource
actor
issued_at
expires_at
max_uses
remaining_uses
```

The raw ticket is a 32-byte random base64url value returned only at issue time. Internal storage is keyed by SHA-256(ticket), not by the raw ticket.

Defaults and bounds:

```text
default TTL = 60 seconds
maximum TTL = 300 seconds
default max_uses = 1
maximum max_uses = 10
```

`consume()` requires exact match on provider, operation, capability and resource. Expired, revoked, exhausted, unknown or mismatched tickets fail closed with stable codes. Successful use decrements `remaining_uses`; exhausted tickets are destroyed.

Public inspection never returns the raw ticket.

## Local IPC boundary

`server/credentials/delegation-ipc.js` implements a local-only operation broker over Node `net`:

- Unix: Unix-domain socket under the OS temp directory;
- Windows: named pipe under `\\.\pipe\`;
- maximum request body: 16 KiB;
- one newline-delimited JSON request per connection;
- only `invoke` is supported;
- request contains the opaque delegation ticket plus provider/operation/capability/resource and inert input;
- ticket is consumed before the registered operation handler executes;
- registered handlers execute inside the credential-owning process;
- response is JSON result or stable public error;
- no IPC method returns credential/token material.

The IPC server is a foundation only in PR-D. GitHub/Google connector handlers are not registered for MCP yet.

## Security posture of delegation

A delegation ticket is itself a short-lived bearer capability. The design reduces its impact by:

- cryptographically random 256-bit tickets;
- server-side hash-only storage;
- local IPC only;
- exact operation/capability/resource binding;
- five-minute hard TTL;
- bounded use count;
- explicit revoke;
- no credential/token response surface.

Future MCP integration must obtain a ticket through an explicit user-authorized path rather than minting its own unrestricted tickets.

## Testing

TDD must cover:

- memory broker exact-id restore support;
- system keyring vault serialization, active pointers and backend failure redaction using an injected fake `Entry` class;
- persistent broker store/replace/remove/restore behavior;
- restoration creates actor identity with zero grants for GitHub and Google;
- system mode does not silently fall back when vault operations fail;
- explicit memory mode retains current process-only behavior;
- delegation ticket hash-only storage, TTL, use count, exact matching, revoke and no raw-ticket listing;
- IPC `invoke` executes only after ticket consumption and never returns a credential field;
- request-size and malformed-JSON failures;
- all existing GitHub, Google, capability, publication, build and dynamic regression suites remain green.

## Dependency

Add `@napi-rs/keyring` as the system keyring binding. No plaintext fallback package is allowed.

## Documentation

README and SECURITY must state:

- system keyring is the default persistent store;
- `memory` mode is explicit and non-persistent;
- restart restores identity but not session grants;
- delegation tickets are short-lived capabilities, not credentials;
- PR-D does not yet expose connector credentials to MCP.
