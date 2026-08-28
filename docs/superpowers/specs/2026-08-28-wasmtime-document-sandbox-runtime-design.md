# EveGlyph PR-F — Wasmtime Document Sandbox Runtime Design

Date: 2026-08-28
Status: Canonical design for implementation planning
Stacked base: `feat/mcp-delegated-connector-operations`
Base SHA: `e9565a96c757b9c23feb68230306fa206ccace15`
Target branch: `feat/wasmtime-document-sandbox-runtime`

## 1. Purpose

PR-F adds the first physical execution boundary for untrusted document programs in EveGlyph.

The core claim is:

```text
Untrusted Program
!=
Ambient Host Authority
```

More precisely, an untrusted WebAssembly program may compute over explicitly supplied JSON input and return JSON output, but it must not thereby obtain ambient access to:

- the workspace or host filesystem;
- environment variables;
- process spawning;
- network sockets or DNS;
- OAuth credentials;
- GitHub or Google connectors;
- the OS keyring or persistent credential broker;
- other documents;
- the user's home directory;
- SSH keys, API keys, or provider secrets.

PR-F composes two independent controls:

```text
EveGlyph capability authorization
AND
Wasmtime physical guest confinement
```

Neither layer is treated as a replacement for the other.

## 2. Scope

### 2.1 In scope

PR-F implements:

1. a Wasmtime CLI runtime adapter owned by EveGlyph's Node server-side runtime;
2. exact runtime discovery/version verification;
3. WebAssembly module size validation;
4. static import allowlisting before process spawn;
5. a strict `wasi-stdio-json` guest profile;
6. bounded stdin/stdout/stderr transport;
7. CPU/instruction, wall-clock, linear-memory, stack, instance, memory-count and table-count limits;
8. private per-execution staging directories;
9. minimized child-process environment and private working directory;
10. stable redacted sandbox errors;
11. capability + physical-sandbox evidence in results;
12. a shared document-Wasm service;
13. one MCP tool, `execute_wasm_document`;
14. executable boundary verifiers and security regression tests;
15. exact-head CI packaging and artifact verification.

### 2.2 Explicit non-goals

PR-F does not add:

- filesystem preopens;
- arbitrary host path access;
- network host imports;
- connector host imports;
- GitHub/Google writes;
- JavaScript or Python execution;
- shell execution;
- automatic Wasmtime downloading;
- a Rust sidecar;
- browser live `aimd-wasm` document blocks;
- persistence of modules or execution input/output;
- a generic plugin package manager;
- Windows Job Object/AppContainer enforcement;
- Linux namespaces/bubblewrap/gVisor enforcement;
- macOS sandbox profiles;
- protection against a fully compromised Wasmtime/JIT process.

The final item is important: Wasmtime is the guest WebAssembly/WASI boundary. It is not claimed to be an operating-system process sandbox if the Wasmtime engine itself is compromised. Platform process isolation is a later layer.

## 3. Existing architecture preserved

### 3.1 AIMD-C remains on the closed-grammar evaluator

Existing AIMD-C computation is intentionally not rewritten into Wasm.

`src/aimdc/evaluator.js` already uses a closed parser/evaluator with no `eval` or `Function`, and `src/capabilities/document-runtime.js` already applies the `document-only` capability profile before invoking the pure graph evaluator.

Therefore PR-F creates a parallel computation route:

```text
AIMD-C closed grammar
    -> existing JS evaluator

Untrusted document program
    -> document Wasm service
    -> Wasmtime runtime adapter
```

### 3.2 Existing connector/delegation boundaries remain unchanged

PR-F must not connect the Wasm guest to PR-B/PR-C/PR-D/PR-E connector credentials, delegation IPC, or provider APIs.

A Wasm module cannot request a delegation ticket, connector session, credential handle, or provider operation from inside the guest.

## 4. Runtime strategy

### 4.1 Chosen approach: Wasmtime CLI sidecar process

PR-F uses the Wasmtime CLI as an external runtime process rather than Node's `node:wasi` and rather than adding a Rust embedding layer.

Reasons:

- Wasmtime is designed to execute untrusted WebAssembly/WASI modules;
- the CLI provides the resource-limit controls required for this MVP;
- no stable official Node embedding API is required;
- EveGlyph remains primarily a Node/JavaScript application;
- the runtime process forms a separate crash/termination boundary;
- a later Rust embedding layer can replace the CLI adapter without changing the public document-Wasm service contract.

### 4.2 Canonical tested runtime

PR-F pins its CI and canonical compatibility contract to:

```text
Wasmtime 48.0.0
```

Local runtime resolution order:

1. `EVEGLYPH_WASMTIME_BIN`, if set;
2. `wasmtime` discovered from `PATH`.

`EVEGLYPH_WASMTIME_BIN` must resolve to an executable file. The runtime adapter executes `wasmtime --version` with a short timeout and bounded output before first use.

For PR-F, the accepted runtime version is exactly `48.0.0`. A missing binary, malformed version response, or different version fails closed as:

```text
sandbox_runtime_unavailable
sandbox_runtime_version_mismatch
```

A later PR may widen the supported version range after separate verification.

PR-F never downloads or installs Wasmtime automatically.

## 5. Guest ABI: `wasi-stdio-json`

### 5.1 Purpose-built profile

PR-F does not claim to run arbitrary general-purpose WASI command applications.

A conforming guest is a purpose-built WASI Preview1 command module whose only host communication is stdin/stdout and optional process exit.

The module receives one UTF-8 JSON value over stdin and emits exactly one UTF-8 JSON value over stdout.

Conceptually:

```text
JSON stdin
   -> guest linear memory / computation
   -> JSON stdout
```

### 5.2 Allowed imports

The only allowed imports are functions from:

```text
wasi_snapshot_preview1
```

with names:

```text
fd_read
fd_write
proc_exit
```

`proc_exit` is optional.

Every other import is rejected before the Wasmtime process is spawned.

Examples of imports that must fail closed include:

```text
path_open
environ_get
environ_sizes_get
args_get
args_sizes_get
random_get
clock_time_get
fd_readdir
fd_prestat_get
sock_*
wasi_unstable::*
env::*
any unknown module/name
```

No imported memory, table, global, or custom host function is allowed.

### 5.3 Required export

A conforming module must export:

```text
_start : function
```

PR-F invokes `_start` explicitly.

Other exports are inert and may exist, but they do not create host authority.

### 5.4 Static validation

Before any process spawn, EveGlyph performs:

1. module byte-length validation;
2. `WebAssembly.Module` validation in Node;
3. `WebAssembly.Module.imports()` inspection;
4. `WebAssembly.Module.exports()` inspection;
5. exact import allowlist enforcement;
6. `_start` export validation.

`WebAssembly.Module` is used for validation/metadata inspection only. EveGlyph must not instantiate or execute the untrusted module through V8.

Invalid modules fail as:

```text
sandbox_invalid_module
sandbox_import_denied
sandbox_entrypoint_missing
```

## 6. Capability authorization

### 6.1 Policy profile

The document-Wasm service reuses the existing `document-only` capability vocabulary.

Before physical execution it requires:

```text
document.read.self  on document:self
document.compute    on document:self
ephemeral.output    on execution:wasm
```

This is intentionally analogous to AIMD-C's baseline, with a distinct execution resource for evidence.

### 6.2 Authorization ordering

The order is:

```text
normalize request
-> require document capability session
-> validate module bytes/imports/entrypoint
-> validate requested resource limits
-> resolve/verify Wasmtime runtime
-> stage private module
-> spawn Wasmtime
-> parse bounded result
-> return capability + physical evidence
```

A capability denial must occur before Wasmtime process creation.

## 7. Input and output protocol

### 7.1 Input

The MCP/document service accepts a JSON-compatible value.

The service serializes it exactly once using `JSON.stringify`, encoded as UTF-8, followed by one newline.

Maximum serialized input size:

```text
256 KiB
```

Oversized input fails before process spawn:

```text
sandbox_input_too_large
```

Cyclic/non-serializable values fail as:

```text
sandbox_invalid_input
```

### 7.2 Output

Guest stdout is captured as bytes.

Maximum stdout:

```text
1 MiB
```

If the limit is exceeded, EveGlyph terminates the child and returns:

```text
sandbox_output_too_large
```

On normal exit, stdout must:

1. be valid UTF-8;
2. contain non-empty content;
3. parse as exactly one JSON value after surrounding whitespace is removed.

Failures map to:

```text
sandbox_output_invalid_utf8
sandbox_output_empty
sandbox_output_invalid_json
```

The returned application value is exposed under:

```json
{
  "result": "<parsed JSON value>"
}
```

### 7.3 Stderr

Guest stderr is captured only for bounded diagnostics and termination classification.

Maximum stderr:

```text
64 KiB
```

If guest stderr exceeds the limit, the process is terminated with:

```text
sandbox_stderr_too_large
```

Raw stderr is not included in successful public results. Failure results may expose only a bounded, UTF-8-safe diagnostic summary with no host stack trace or process environment.

## 8. Canonical resource limits

### 8.1 Defaults

```text
module bytes          1 MiB max
input JSON          256 KiB max
stdout                1 MiB max
stderr               64 KiB max

linear memory         32 MiB default
wall time              2 s default
fuel           10,000,000 default
Wasm stack             1 MiB default
instances              1
memories               1
tables                 1
```

### 8.2 Hard maxima accepted from callers

A caller may request stricter or moderately larger limits, but never beyond:

```text
linear memory         64 MiB hard max
wall time             10 s hard max
fuel          100,000,000 hard max
Wasm stack             2 MiB hard max
instances              1 hard max
memories               1 hard max
tables                 1 hard max
```

The module/input/output byte limits are not caller-increasable in PR-F.

### 8.3 Limit validation

Unknown limit keys, negative values, zero where invalid, non-integers, or values above hard maxima fail before process spawn as:

```text
sandbox_invalid_limits
```

## 9. Wasmtime invocation contract

### 9.1 Spawn behavior

The Wasmtime process is launched with:

```text
shell: false
stdio: pipe/pipe/pipe
cwd: private per-execution directory
```

The runtime adapter uses the exact Wasmtime 48.0.0 CLI grammar verified by CI for the following logical controls:

```text
fuel
max-memory-size
max-wasm-stack
max-instances=1
max-memories=1
max-tables=1
timeout
```

WASI configuration must explicitly avoid ambient authority:

```text
no --dir / filesystem preopen
no --env
no inherited guest environment
no inherited network
TCP disabled
UDP disabled
IP name lookup disabled
stdin/stdout/stderr connected only to EveGlyph pipes
```

The generated argv is itself unit tested as a security contract.

### 9.2 Dual interruption

PR-F does not rely on one termination mechanism.

Execution is bounded by:

1. Wasmtime fuel;
2. Wasmtime timeout/resource controls;
3. an independent Node wall-clock timer.

If Node's timer fires, EveGlyph kills the Wasmtime child and reports:

```text
sandbox_timeout
```

An out-of-fuel trap is classified as:

```text
sandbox_fuel_exhausted
```

Memory/stack/resource traps are mapped to stable sandbox error codes rather than returning arbitrary Wasmtime stderr verbatim.

## 10. Child-process host exposure reduction

### 10.1 Private execution directory

Every execution creates a unique directory under the operating-system temporary directory.

On POSIX, EveGlyph attempts:

```text
directory mode 0700
module mode    0600
```

The staged module is written as a fixed non-user-controlled filename such as:

```text
module.wasm
```

No user-supplied filesystem path is used.

Cleanup runs in `finally` on success, trap, timeout, cancellation, malformed output, or spawn failure.

### 10.2 Minimal child environment

Wasmtime must not inherit the full EveGlyph process environment.

The adapter constructs a minimal environment containing only operating-system variables needed to launch the process safely. It must not forward:

```text
EVEGLYPH_GITHUB_CLIENT_ID
EVEGLYPH_GITHUB_CLIENT_SECRET
EVEGLYPH_GOOGLE_CLIENT_ID
EVEGLYPH_GOOGLE_CLIENT_SECRET
EVEGLYPH_MCP_TOKEN
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
GITHUB_TOKEN
SSH_*
AWS_*
AZURE_*
HOME/USERPROFILE unless proven required
arbitrary parent env vars
```

A private temp directory may be supplied through `TMPDIR`/`TMP`/`TEMP` as required.

Windows may preserve required OS bootstrap variables such as `SystemRoot`/`WINDIR` if necessary for process startup. The exact allowlist is documented and tested.

### 10.3 Honest boundary

The above reduces blast radius if the runtime process misbehaves, but it is not an OS security boundary against a compromised Wasmtime engine.

A later platform-isolation layer should run the runtime under OS-specific restrictions.

## 11. Module identity and evidence

Every accepted module is identified by:

```text
SHA-256(module bytes)
```

Successful execution returns evidence shaped approximately as:

```json
{
  "result": {},
  "module_sha256": "...",
  "sandbox": {
    "runtime": "wasmtime",
    "runtime_version": "48.0.0",
    "profile": "wasi-stdio-json",
    "entrypoint": "_start",
    "imports": [
      "wasi_snapshot_preview1.fd_read",
      "wasi_snapshot_preview1.fd_write"
    ],
    "limits": {
      "fuel": 10000000,
      "memory_bytes": 33554432,
      "timeout_ms": 2000,
      "wasm_stack_bytes": 1048576,
      "instances": 1,
      "memories": 1,
      "tables": 1
    },
    "capability": {
      "profile": "document-only",
      "audit": []
    }
  }
}
```

The evidence must not contain:

- runtime child environment;
- host filesystem paths;
- the staging-directory path;
- raw Wasmtime command line if it includes host-specific paths;
- host stack traces.

## 12. Server-side components

PR-F introduces focused modules rather than putting runtime logic into `mcp-tools.js`.

Expected structure:

```text
server/sandbox/
  errors.js
  limits.js
  wasi-import-policy.js
  wasmtime-runtime.js
  document-wasm-service.js
```

Responsibilities:

### `errors.js`

Defines stable sandbox error codes and public redaction helpers.

### `limits.js`

Owns defaults, hard maxima, normalization and validation.

### `wasi-import-policy.js`

Owns static module validation, import allowlist and `_start` export requirement.

### `wasmtime-runtime.js`

Owns binary resolution, version verification, private staging, minimal environment, CLI argv construction, process execution, pipe limits, timeout and trap classification.

It must not know about MCP.

### `document-wasm-service.js`

Owns EveGlyph capability authorization + module hash + runtime invocation + evidence composition.

It must not know about MCP transport details.

## 13. MCP surface

PR-F adds one MCP tool:

```text
execute_wasm_document
```

Input shape:

```json
{
  "module_base64": "...",
  "input": {},
  "limits": {
    "fuel": 10000000,
    "memory_bytes": 33554432,
    "timeout_ms": 2000,
    "wasm_stack_bytes": 1048576
  }
}
```

`limits` is optional.

The tool intentionally does not accept:

```text
module_path
workspace_path
preopen_dir
env
network
command
shell
args
host_imports
connector ticket
credential handle
```

The MCP tool passes module bytes directly to `document-wasm-service` and returns the service result/evidence.

Both stdio and remote MCP reuse the existing server factory, so this tool must be registered once in the shared MCP implementation.

## 14. Browser behavior

PR-F does not add a browser editor control or live `aimd-wasm` block.

The physical runtime is server-side infrastructure first.

A future UI may call the same `document-wasm-service` through an explicitly designed local bridge, but that is not part of PR-F.

## 15. Error model

Public stable codes include at least:

```text
sandbox_runtime_unavailable
sandbox_runtime_version_mismatch
sandbox_invalid_module
sandbox_import_denied
sandbox_entrypoint_missing
sandbox_invalid_input
sandbox_input_too_large
sandbox_invalid_limits
sandbox_spawn_failed
sandbox_timeout
sandbox_fuel_exhausted
sandbox_memory_limit
sandbox_stack_limit
sandbox_resource_limit
sandbox_output_too_large
sandbox_stderr_too_large
sandbox_output_empty
sandbox_output_invalid_utf8
sandbox_output_invalid_json
sandbox_guest_exit_nonzero
sandbox_internal_error
```

Host exception messages, child environment, full staging paths and provider secrets never cross the public error boundary.

Unknown runtime failures map to `sandbox_internal_error` with a generic message.

## 16. Security regression fixtures

PR-F requires executable adversarial tests, not only positive examples.

### 16.1 Positive fixture

A minimal conforming module imports only `fd_read`/`fd_write`, reads JSON stdin, performs deterministic computation and emits valid JSON stdout.

Expected: PASS.

### 16.2 Filesystem fixture

Imports `path_open`.

Expected:

```text
sandbox_import_denied
Wasmtime spawn count = 0
```

### 16.3 Environment fixture

Imports `environ_get` or `environ_sizes_get`.

Expected:

```text
sandbox_import_denied
Wasmtime spawn count = 0
```

### 16.4 Unknown host import fixture

Imports from `env` or another unknown module.

Expected: `sandbox_import_denied` before spawn.

### 16.5 Infinite-loop fixture

Consumes execution indefinitely.

Expected termination by fuel and/or wall-clock limit with no hung test process.

### 16.6 Memory-growth fixture

Attempts to grow memory beyond the configured bound.

Expected stable memory/resource failure; host process remains healthy.

### 16.7 Output bomb fixture

Writes beyond 1 MiB to stdout.

Expected child termination and `sandbox_output_too_large`.

### 16.8 Stderr bomb fixture

Writes beyond 64 KiB to stderr.

Expected child termination and `sandbox_stderr_too_large`.

### 16.9 Invalid JSON fixture

Exits successfully after writing non-JSON stdout.

Expected `sandbox_output_invalid_json`.

### 16.10 Non-zero exit fixture

Calls `proc_exit` with non-zero status.

Expected `sandbox_guest_exit_nonzero`, unless the exit is already classified as a stricter runtime limit/trap condition.

## 17. TDD sequence

PR-F implementation must preserve RED evidence for the security boundary.

Recommended sequence:

1. runtime/import-policy contract RED;
2. module validation/import deny GREEN;
3. Wasmtime discovery/version/argv RED -> GREEN;
4. real positive runtime RED -> GREEN;
5. fuel/timeout/memory/output security RED -> GREEN;
6. document capability service RED -> GREEN;
7. MCP `execute_wasm_document` E2E RED -> GREEN;
8. physical-sandbox boundary verifier RED -> GREEN;
9. documentation + exact-head full regression.

Each RED checkpoint must fail for the intended missing behavior, not from unrelated setup breakage.

## 18. CI contract

CI installs/pins Wasmtime `48.0.0` from a trusted Bytecode Alliance distribution/setup path.

CI must verify:

```text
wasmtime --version -> 48.0.0
```

before real runtime tests.

CI then runs:

- Wasmtime sandbox tests;
- existing PR-E MCP delegation tests;
- credential broker tests;
- GitHub connector tests;
- Google connector tests;
- capability tests;
- publication tests;
- Vite build;
- connector build verifiers;
- credential boundary verifier;
- MCP delegation boundary verifier;
- new Wasmtime physical-sandbox boundary verifier;
- Dynamic Logic regression;
- Dynamic Rendering regression;
- exact-head `git archive` artifact generation.

The physical-sandbox verifier must mechanically assert at least:

- no `--dir` or filesystem preopen in runtime argv;
- no guest env inheritance;
- no guest network inheritance;
- no shell execution;
- no workspace path input in MCP sandbox tool;
- no connector/keyring/persistent-broker imports in sandbox modules;
- no provider credential environment copied into Wasmtime child env;
- only the canonical WASI import allowlist is accepted;
- temporary execution directories are cleanup-owned by the runtime;
- the MCP tool does not accept arbitrary host capability objects.

## 19. Documentation

PR-F updates:

- `README.md` with the new physical sandbox execution path;
- `SECURITY.md` with the exact Wasmtime trust boundary and explicit engine-compromise limitation;
- a focused operator document, expected as `docs/WASMTIME-DOCUMENT-SANDBOX.md`.

The operator document must explain:

- how to install/configure Wasmtime manually;
- the exact supported version;
- `EVEGLYPH_WASMTIME_BIN`;
- the `wasi-stdio-json` ABI;
- allowed imports;
- default/hard limits;
- MCP invocation;
- what this sandbox does and does not protect against.

## 20. Security invariants

The PR is not complete unless all of these remain true:

```text
Wasm guest != Node process
Wasm guest != workspace authority
Wasm guest != connector authority
Wasm guest != credential authority
Wasm guest != network authority
Wasm guest != process-spawn authority
Wasm guest != environment authority
```

And:

```text
Policy Allow
AND
Physical Sandbox
```

is required for successful untrusted document-program execution.

The physical-sandbox evidence is part of the result so callers can distinguish ordinary AIMD-C evaluation from Wasmtime-confined execution.

## 21. External runtime assumptions verified for this design

This design relies on Wasmtime's documented behavior that:

- the CLI automatically provides WASI imports requested by modules but does not satisfy arbitrary non-WASI imports;
- Wasmtime exposes fuel, max Wasm stack, max memory size, instance/memory/table limits and timeout controls through its CLI configuration;
- filesystem access requires preopened directories rather than ambient guest path access;
- WASI environment inheritance and network inheritance are explicit configuration choices;
- TCP/UDP/name-lookup can be disabled;
- Wasmtime 48.0.0 is the canonical runtime API/doc generation used by this PR-F design.

Implementation tests, not documentation assumptions alone, are the final acceptance authority for the exact 48.0.0 CLI grammar and behavior.
