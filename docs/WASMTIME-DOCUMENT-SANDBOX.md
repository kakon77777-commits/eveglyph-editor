# EveGlyph Wasmtime Document Sandbox

PR-F adds a physical execution boundary for untrusted document WebAssembly programs.

The security claim is deliberately narrow:

```text
Untrusted Program
!=
Ambient Host Authority
```

A guest receives JSON on stdin and may return JSON on stdout. It does not receive the workspace, host filesystem, environment, network, connector credentials, keyring, process spawning, or arbitrary host imports.

This document describes the exact PR-F runtime and operator contract.

## 1. Required runtime

Canonical and currently supported runtime:

```text
Wasmtime 48.0.0
```

PR-F intentionally requires this exact version. A different version fails closed until it has been separately validated and the compatibility contract is updated.

Install Wasmtime manually from the official Bytecode Alliance Wasmtime release/distribution path. EveGlyph does **not** download or install Wasmtime automatically.

Verify the installation:

```sh
wasmtime --version
```

Expected version prefix:

```text
wasmtime 48.0.0
```

If Wasmtime is not on `PATH`, point EveGlyph at an absolute executable path:

```text
EVEGLYPH_WASMTIME_BIN=/absolute/path/to/wasmtime
```

On Windows, use the full path to `wasmtime.exe`.

Missing runtime:

```text
sandbox_runtime_unavailable
```

Wrong runtime version:

```text
sandbox_runtime_version_mismatch
```

## 2. Execution profile

The only PR-F guest profile is:

```text
wasi-stdio-json
```

A conforming guest is a WASI Preview1 command module exporting:

```text
_start
```

Input/output flow:

```text
UTF-8 JSON stdin
        ↓
WebAssembly guest
        ↓
UTF-8 JSON stdout
```

EveGlyph serializes the input once with `JSON.stringify`, appends one newline, and sends the bytes over a pipe. The guest must emit one JSON value on stdout. Surrounding whitespace is allowed; multiple values or non-JSON output are rejected.

## 3. Allowed WASI imports

Only these function imports are accepted:

```text
wasi_snapshot_preview1.fd_read
wasi_snapshot_preview1.fd_write
wasi_snapshot_preview1.proc_exit
```

`proc_exit` is optional.

Every other import is rejected **before Wasmtime is spawned**. Examples:

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
custom host imports
```

Imported memories, tables, globals, or other non-function imports are also rejected.

The static inspection uses Node's `WebAssembly.Module` only to validate bytes and inspect imports/exports. The untrusted module is never instantiated through V8.

## 4. Capability authorization

Physical confinement does not replace EveGlyph authorization.

Before touching module bytes or Wasmtime, the document Wasm service requires the existing `document-only` baseline:

```text
document.read.self on document:self
document.compute   on document:self
ephemeral.output   on execution:wasm
```

The execution rule is therefore:

```text
Policy Allow
AND
Physical Sandbox
```

A capability denial occurs before module inspection or Wasmtime process creation.

## 5. Resource limits

Fixed byte limits:

| Resource | Limit |
| --- | ---: |
| decoded module | 1 MiB |
| serialized JSON input | 256 KiB |
| stdout | 1 MiB |
| stderr | 64 KiB |

Default execution limits:

| Resource | Default |
| --- | ---: |
| fuel | 10,000,000 |
| linear memory | 32 MiB |
| wall-clock budget | 2,000 ms |
| Wasm stack | 1 MiB |
| instances | 1 |
| memories | 1 |
| tables | 1 |

Hard caller maxima:

| Resource | Maximum |
| --- | ---: |
| fuel | 100,000,000 |
| linear memory | 64 MiB |
| wall-clock budget | 10,000 ms |
| Wasm stack | 2 MiB |
| instances | 1 |
| memories | 1 |
| tables | 1 |

Unknown limit keys, non-integers, zero/negative values, or values above the maxima fail as:

```text
sandbox_invalid_limits
```

Memory growth uses Wasmtime's `trap-on-grow-failure=y` in addition to the maximum-memory setting so an attempted growth beyond the bound becomes a deterministic trap instead of merely returning `-1` to the guest.

## 6. Dual interruption

EveGlyph does not rely on one mechanism to stop runaway computation.

The runtime combines:

1. Wasmtime fuel;
2. Wasmtime timeout/resource controls;
3. an independent Node wall-clock kill timer.

Validated stable outcomes include:

```text
sandbox_fuel_exhausted
sandbox_timeout
sandbox_memory_limit
sandbox_output_too_large
sandbox_stderr_too_large
sandbox_guest_exit_nonzero
```

The exact fuel/memory trap classifications are based on Wasmtime 48.0.0 behavior exercised in CI. Unknown runtime failures are not returned verbatim; they fail closed behind a stable sandbox error.

## 7. Private staging and child environment

Every execution gets its own operating-system temporary directory and a fixed staged filename:

```text
module.wasm
```

On POSIX EveGlyph attempts:

```text
directory 0700
module    0600
```

The Wasmtime child runs with:

```text
shell: false
cwd: private execution directory
stdin/stdout/stderr: pipes
```

There is no `--dir` preopen and no guest environment/network inheritance.

EveGlyph does not pass the full parent process environment to Wasmtime. On POSIX the child receives only private `TMPDIR`, plus `PATH` when command-name resolution is required. With an explicit `EVEGLYPH_WASMTIME_BIN`, `PATH` is not required by the child. On Windows the minimal bootstrap set may additionally contain `SystemRoot`/`WINDIR`, private `TEMP`/`TMP`, and `PATH` only when needed for runtime lookup.

Examples of values that are not copied into the Wasmtime child:

```text
HOME
USERPROFILE
EVEGLYPH_GITHUB_CLIENT_SECRET
EVEGLYPH_GOOGLE_CLIENT_SECRET
EVEGLYPH_MCP_TOKEN
OPENAI_API_KEY
GITHUB_TOKEN
AWS_*
AZURE_*
SSH_*
arbitrary parent environment values
```

The private execution directory is removed in a `finally` path after success, trap, timeout, malformed output, or spawn failure.

## 8. MCP tool

PR-F registers one shared MCP tool for both stdio and remote MCP transports:

```text
execute_wasm_document
```

Input:

```json
{
  "module_base64": "AGFzbQE...",
  "input": {
    "n": 7
  },
  "limits": {
    "fuel": 10000000,
    "memory_bytes": 33554432,
    "timeout_ms": 2000,
    "wasm_stack_bytes": 1048576
  }
}
```

`limits` is optional.

The MCP schema deliberately has no:

```text
module_path
workspace_path
preopen_dir
env
network
command
shell
args
credential
credential_id
delegation_ticket
```

Module bytes therefore enter as data, not as authority to open a host path.

## 9. Result evidence

Successful execution returns the parsed application value plus evidence similar to:

```json
{
  "result": {
    "answer": 42
  },
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

Evidence does not include the private staging path, child environment, raw command line, provider credential, or host stack trace.

## 10. Public error contract

Representative stable codes:

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
sandbox_output_too_large
sandbox_stderr_too_large
sandbox_output_empty
sandbox_output_invalid_utf8
sandbox_output_invalid_json
sandbox_guest_exit_nonzero
sandbox_internal_error
```

MCP returns sandbox errors through the stable redacted error mapping. Raw Wasmtime stderr is internal diagnostic material and is not forwarded as the public error payload.

## 11. What this protects against

PR-F materially constrains an untrusted WebAssembly guest from obtaining ambient host authority through normal WebAssembly/WASI operation. In particular, a module cannot gain filesystem/environment/network/connector/credential access simply because it is executing on the same machine as EveGlyph.

The security regression suite includes:

- filesystem import denial;
- environment import denial;
- unknown host import denial;
- exact fuel exhaustion;
- independent host timeout;
- memory-growth trap;
- stdout bomb;
- stderr bomb;
- invalid JSON output;
- non-zero guest exit;
- real stdio MCP end-to-end execution.

## 12. What this does not protect against

Wasmtime is the WebAssembly/WASI guest boundary. PR-F does **not** claim that the Wasmtime operating-system process is contained after a hypothetical full Wasmtime/JIT/native-code escape.

That requires a later platform isolation layer such as appropriately designed Windows Job Object/AppContainer restrictions, Linux namespaces/seccomp/bubblewrap/gVisor, or an equivalent OS/container boundary.

PR-F reduces the potential blast radius of such a failure by using a private cwd and minimal child environment, but those measures are defense in depth rather than a substitute for an OS sandbox.

PR-F also does not add:

- browser `aimd-wasm` live blocks;
- filesystem preopens;
- connector host functions;
- network host functions;
- arbitrary JavaScript/Python/shell execution;
- automatic runtime downloads;
- a Rust Wasmtime embedding sidecar.

## 13. CI reference runtime

The canonical CI path installs and verifies:

```text
Wasmtime 48.0.0
wasm-tools 1.254.0
```

`wasm-tools` is used only to compile the repository's human-reviewable WAT security fixtures into temporary test `.wasm` files. It is not a production EveGlyph runtime dependency.

Release acceptance requires the complete Wasmtime test suite plus the executable physical-sandbox boundary verifier, existing connector/credential/MCP-delegation verifiers, application build, Dynamic Logic/Rendering regressions, and exact-head `git archive` packaging.
