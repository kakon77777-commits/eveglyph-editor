# EveGlyph PR-F — Wasmtime Document Sandbox Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Wasmtime 48.0.0-backed physical execution boundary for untrusted document WebAssembly programs, with no ambient filesystem, environment, network, process, credential, connector, or workspace authority.

**Architecture:** Preserve the current closed-grammar AIMD-C path. Add a separate server-side `document-wasm-service` that first requires the existing `document-only` capability baseline, statically validates a binary Wasm module against a strict WASI Preview1 import allowlist, then invokes an external Wasmtime CLI process in a private temp directory with bounded resources and a minimal child environment. MCP gets one transport-neutral `execute_wasm_document` tool that accepts module bytes as canonical Base64 and JSON input, never a host path or host capability object.

**Tech Stack:** Node.js 20 ESM, WebAssembly.Module metadata inspection, Wasmtime CLI 48.0.0, Bytecode Alliance `wasm-tools` 1.254.0 for CI fixture compilation only, MCP SDK + Zod, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-wasmtime-document-sandbox-runtime-design.md`

## Global Constraints

- Stacked base is exact PR-E head `e9565a96c757b9c23feb68230306fa206ccace15`.
- Canonical runtime is exactly Wasmtime `48.0.0`.
- Production code must not depend on `wasm-tools`; it is CI/test fixture tooling only.
- Guest profile is exactly `wasi-stdio-json`.
- Allowed guest imports are only `wasi_snapshot_preview1.fd_read`, `fd_write`, and optional `proc_exit` functions.
- No filesystem preopen, guest environment inheritance, guest network inheritance, connector host imports, process spawning, shell execution, workspace path, module path, or credential handle is accepted.
- Module decoded bytes <= 1 MiB; serialized JSON input <= 256 KiB; stdout <= 1 MiB; stderr <= 64 KiB.
- Default limits: memory 32 MiB, timeout 2000 ms, fuel 10,000,000, Wasm stack 1 MiB, instances/memories/tables = 1.
- Hard maxima: memory 64 MiB, timeout 10,000 ms, fuel 100,000,000, Wasm stack 2 MiB; instances/memories/tables remain 1.
- Capability denial and static import denial occur before Wasmtime spawn.
- Wasmtime child uses `shell:false`, private temp cwd, fixed `module.wasm`, pipe stdio, and a minimal explicit child environment.
- AIMD-C remains on the current closed JS evaluator.
- Existing PR-E delegated connector behavior must remain unchanged.
- No automatic Wasmtime download/install in application runtime.

---

## File Structure

Create:

- `server/sandbox/errors.js` — stable sandbox error type/code/redaction helpers.
- `server/sandbox/limits.js` — canonical defaults, maxima, and request limit normalization.
- `server/sandbox/wasi-import-policy.js` — binary validation, canonical Base64 decoding, import/export inspection.
- `server/sandbox/wasmtime-runtime.js` — runtime discovery/version check, argv/env construction, private staging, bounded process execution.
- `server/sandbox/document-wasm-service.js` — capability authorization + module hash + runtime invocation + public evidence.
- `mcp-wasm-sandbox.js` — one shared MCP tool registration module.
- `scripts/compile_wasmtime_fixtures.mjs` — invokes `wasm-tools parse` for test `.wat` fixtures only.
- `scripts/verify_wasmtime_sandbox_boundary.mjs` — executable source/build boundary verifier.
- `test/fixtures/wasmtime/*.wat` — human-reviewable positive/adversarial guests.
- `test/wasmtime-import-policy.test.mjs`
- `test/wasmtime-runtime-contract.test.mjs`
- `test/wasmtime-real-runtime.test.mjs`
- `test/wasmtime-resource-limits.test.mjs`
- `test/document-wasm-service.test.mjs`
- `test/mcp-wasmtime-sandbox.test.mjs`
- `docs/WASMTIME-DOCUMENT-SANDBOX.md`

Modify:

- `mcp-server-factory.js` — inject/register the document Wasm service once for stdio/remote transports.
- `package.json` — add `test:wasmtime-sandbox` and `verify:wasmtime-sandbox` scripts only; no runtime dependency.
- `.github/workflows/publication-runtime.yml` — PR-F branch trigger, setup Wasmtime/wasm-tools, fixture compile, sandbox tests/verifier, PR-F artifact name.
- `README.md` and `SECURITY.md` — bounded physical-sandbox path and honest engine-compromise limitation.

---

### Task 1: Stable Errors, Limits, Canonical Base64, and Static Import Policy

**Files:**
- Create: `server/sandbox/errors.js`
- Create: `server/sandbox/limits.js`
- Create: `server/sandbox/wasi-import-policy.js`
- Create: `test/wasmtime-import-policy.test.mjs`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- Produces `SandboxError`, `sandboxError(code, message?)`, `toPublicSandboxError(error)`.
- Produces `normalizeSandboxLimits(input = {}) -> frozen limits`.
- Produces `decodeCanonicalModuleBase64(text) -> Buffer`.
- Produces `inspectWasiStdioJsonModule(bytes) -> { imports, exports, entrypoint }`.

- [ ] **Step 1: Write the failing import-policy tests**

Tests must assert:

```js
assert.equal(normalizeSandboxLimits({}).memory_bytes, 32 * 1024 * 1024)
assert.throws(() => normalizeSandboxLimits({ timeout_ms: 10001 }), /sandbox_invalid_limits/)

const bytes = decodeCanonicalModuleBase64(Buffer.from(validWasm).toString('base64'))
assert.deepEqual(bytes, validWasm)
assert.throws(() => decodeCanonicalModuleBase64('%%%%'), /sandbox_invalid_module/)

assert.deepEqual(inspectWasiStdioJsonModule(validBytes).imports, [
  'wasi_snapshot_preview1.fd_read',
  'wasi_snapshot_preview1.fd_write',
])
assert.throws(() => inspectWasiStdioJsonModule(pathOpenBytes), /sandbox_import_denied/)
assert.throws(() => inspectWasiStdioJsonModule(envGetBytes), /sandbox_import_denied/)
assert.throws(() => inspectWasiStdioJsonModule(unknownImportBytes), /sandbox_import_denied/)
assert.throws(() => inspectWasiStdioJsonModule(noStartBytes), /sandbox_entrypoint_missing/)
```

Tests may use tiny binary modules encoded directly in the test helper for import metadata; they must not spawn Wasmtime.

- [ ] **Step 2: Add a PR-F RED CI gate and run it**

Add branch `feat/wasmtime-document-sandbox-runtime` to the workflow trigger and a step:

```yaml
- name: Wasmtime import-policy tests
  run: node --test test/wasmtime-import-policy.test.mjs
```

Expected RED: `npm ci` passes, import-policy test fails because `server/sandbox/*` modules do not exist. Subsequent legacy gates are skipped by normal step failure.

- [ ] **Step 3: Implement the minimal policy modules**

`limits.js` must export exact defaults/maxima and reject unknown keys.

`wasi-import-policy.js` must:

```js
const MAX_MODULE_BYTES = 1024 * 1024
const ALLOWED = new Set([
  'wasi_snapshot_preview1.fd_read',
  'wasi_snapshot_preview1.fd_write',
  'wasi_snapshot_preview1.proc_exit',
])
```

Canonical Base64 rules:
- input must be a string;
- pre-decode encoded length must be <= `Math.ceil(MAX_MODULE_BYTES / 3) * 4 + 4`;
- no whitespace;
- only standard Base64 alphabet with correct padding;
- decode then re-encode equality check after stripping permitted terminal `=` padding normalization;
- decoded size 1..1 MiB.

Module policy must construct `new WebAssembly.Module(bytes)` for validation only, inspect imports/exports, reject any non-function import, any import outside `ALLOWED`, and require function export `_start`. It must never instantiate the module.

- [ ] **Step 4: Re-run Task 1 tests**

Expected: all Task 1 tests PASS and Wasmtime spawn count remains zero for deny tests.

- [ ] **Step 5: Commit**

Commit message: `feat: add Wasmtime module policy and limits`

---

### Task 2: Wasmtime 48 Runtime Discovery and Invocation Contract

**Files:**
- Create: `server/sandbox/wasmtime-runtime.js`
- Create: `test/wasmtime-runtime-contract.test.mjs`

**Interfaces:**
- Produces `createWasmtimeRuntime({ env, platform, spawnImpl, fsImpl, tmpRoot, now })`.
- Runtime exposes `verifyRuntime()` and `execute({ moduleBytes, stdinBytes, limits })`.
- Produces internal/public-testable helpers `buildWasmtimeArgs(moduleFile, limits)` and `buildWasmtimeChildEnv(parentEnv, privateTmp, platform)`.

- [ ] **Step 1: Write failing runtime-contract tests**

Assert exact behavior:

```js
assert.deepEqual(buildWasmtimeArgs('module.wasm', limits), [
  'run',
  '-W', `fuel=${limits.fuel}`,
  '-W', `max-memory-size=${limits.memory_bytes}`,
  '-W', `max-wasm-stack=${limits.wasm_stack_bytes}`,
  '-W', 'max-instances=1',
  '-W', 'max-memories=1',
  '-W', 'max-tables=1',
  '-W', `timeout=${limits.timeout_ms}ms`,
  'module.wasm',
])
```

Assert args contain none of:

```text
--dir
--env
--tcplisten
--allow-precompiled
-S inherit-env
-S inherit-network
```

POSIX child env must contain only private `TMPDIR`, plus `PATH` only when runtime resolution actually needs PATH lookup. Windows child env may additionally carry `SystemRoot`/`WINDIR` and private `TEMP`/`TMP`; it must not carry `HOME`, `USERPROFILE`, `EVEGLYPH_*`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `AWS_*`, or arbitrary variables.

Mock `wasmtime --version` output `wasmtime 48.0.0 (...)` => PASS; `47.0.2` => `sandbox_runtime_version_mismatch`; ENOENT => `sandbox_runtime_unavailable`.

- [ ] **Step 2: Run RED**

Expected: fail because `wasmtime-runtime.js` does not exist.

- [ ] **Step 3: Implement runtime discovery/contract only**

Runtime resolution:

```text
EVEGLYPH_WASMTIME_BIN absolute executable path if set
else command name `wasmtime` resolved by spawn/PATH
```

`verifyRuntime()` must run with `shell:false`, a 2-second independent timeout, stdout/stderr caps <= 16 KiB, and accept only a version line matching `/^wasmtime 48\.0\.0(?:\s|$)/`.

Do not yet claim real guest execution works; mocked process behavior is sufficient for this task.

- [ ] **Step 4: Re-run contract tests**

Expected PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add Wasmtime runtime contract`

---

### Task 3: Reviewable WAT Fixtures, Official Tool Setup, and Real Positive Runtime

**Files:**
- Create: `test/fixtures/wasmtime/echo-json.wat`
- Create: `test/fixtures/wasmtime/path-open.wat`
- Create: `test/fixtures/wasmtime/environ-get.wat`
- Create: `test/fixtures/wasmtime/unknown-import.wat`
- Create: `test/fixtures/wasmtime/infinite-loop.wat`
- Create: `test/fixtures/wasmtime/memory-grow.wat`
- Create: `test/fixtures/wasmtime/output-bomb.wat`
- Create: `test/fixtures/wasmtime/stderr-bomb.wat`
- Create: `test/fixtures/wasmtime/invalid-json.wat`
- Create: `test/fixtures/wasmtime/nonzero-exit.wat`
- Create: `scripts/compile_wasmtime_fixtures.mjs`
- Create: `test/wasmtime-real-runtime.test.mjs`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- Fixture compiler maps every `*.wat` to sibling generated `*.wasm` under a temporary test build directory, not Git-tracked binary output.
- Real runtime test loads compiled `.wasm` bytes and calls `createWasmtimeRuntime().execute(...)`.

- [ ] **Step 1: Add official CI setup before real runtime tests**

```yaml
- name: Setup Wasmtime 48.0.0
  uses: bytecodealliance/actions/wasmtime/setup@v1
  with:
    version: "48.0.0"

- name: Setup wasm-tools 1.254.0
  uses: bytecodealliance/actions/wasm-tools/setup@v1
  with:
    version: "1.254.0"

- name: Verify sandbox toolchain
  run: |
    wasmtime --version
    wasm-tools --version
```

Then compile fixtures with:

```sh
node scripts/compile_wasmtime_fixtures.mjs
```

- [ ] **Step 2: Write the positive WAT fixture and failing real-runtime test**

`echo-json.wat` imports only `fd_read`/`fd_write`, reads bounded stdin into linear memory, and writes the bytes back unchanged to stdout. The test provides JSON bytes such as `{"n":7}\n` and expects exact stdout JSON parsing later.

Expected RED: runtime adapter has contract/discovery but no complete private staging/stdio execution implementation.

- [ ] **Step 3: Implement real `execute()`**

Execution must:
- create unique private temp directory;
- attempt 0700 directory / 0600 `module.wasm` on POSIX;
- write fixed `module.wasm` filename;
- use private cwd;
- spawn with `shell:false` and pipe stdio;
- stream stdin then close it;
- cap stdout/stderr incrementally and kill child on overflow;
- run an independent Node timeout;
- cleanup in `finally`;
- never return staging path or child env.

- [ ] **Step 4: Run positive real runtime**

Expected PASS on Wasmtime 48.0.0.

- [ ] **Step 5: Commit**

Commit message: `feat: execute JSON guests through Wasmtime`

---

### Task 4: Deterministic Physical Resource and Adversarial Enforcement

**Files:**
- Create: `test/wasmtime-resource-limits.test.mjs`
- Modify: `server/sandbox/wasmtime-runtime.js`
- Use fixtures from Task 3.

**Interfaces:**
- Runtime maps child termination/traps into stable `SandboxError` codes.

- [ ] **Step 1: Write RED adversarial tests**

Required assertions:

```text
path-open.wasm      -> sandbox_import_denied before runtime execute/spawn
environ-get.wasm    -> sandbox_import_denied before runtime execute/spawn
unknown-import.wasm -> sandbox_import_denied before runtime execute/spawn
```

Runtime-only tests:

```text
infinite-loop + very low fuel + generous host timeout -> sandbox_fuel_exhausted
infinite-loop + high fuel + tiny Node timeout -> sandbox_timeout
memory-grow -> sandbox_memory_limit or sandbox_resource_limit using stable documented classification
output-bomb -> sandbox_output_too_large
stderr-bomb -> sandbox_stderr_too_large
invalid-json -> later service/output parser classification
nonzero-exit -> sandbox_guest_exit_nonzero
```

Fuel and Node timeout must be separate tests; neither may accept either code.

- [ ] **Step 2: Run RED and inspect exact Wasmtime 48 stderr/trap signatures**

Only classify signatures observed from exact 48.0.0 CI output. Do not guess broad substring mappings that could expose arbitrary stderr.

- [ ] **Step 3: Implement bounded trap classification**

Store raw stderr only internally. Return stable public errors. If a failure cannot be safely identified, return `sandbox_internal_error` rather than forwarding raw runtime text.

- [ ] **Step 4: Re-run adversarial suite**

Expected all PASS and no hung child process.

- [ ] **Step 5: Commit**

Commit message: `test: enforce Wasmtime physical resource limits`

---

### Task 5: Capability-Gated Document Wasm Service and Evidence

**Files:**
- Create: `server/sandbox/document-wasm-service.js`
- Create: `test/document-wasm-service.test.mjs`

**Interfaces:**
- Produces `createDocumentWasmService({ runtime, now, idFactory })`.
- Service exposes `execute({ moduleBase64, input, limits, session, actor, grants })`.

- [ ] **Step 1: Write RED service tests**

Test ordering and evidence:

```js
await assert.rejects(
  service.execute({ moduleBase64, input, session: denyingSession }),
  error => error.code === 'capability_denied'
)
assert.equal(runtime.executeCalls, 0)
```

Positive result must include:

```js
{
  result,
  module_sha256: /^[0-9a-f]{64}$/,
  sandbox: {
    runtime: 'wasmtime',
    runtime_version: '48.0.0',
    profile: 'wasi-stdio-json',
    entrypoint: '_start',
    imports: [...],
    limits: {...},
    capability: { profile: 'document-only', audit: [...] }
  }
}
```

Service must reject invalid JSON output/UTF-8/empty output with stable codes and must not expose cwd/env/argv/staging paths.

- [ ] **Step 2: Run RED**

Expected fail because service does not exist.

- [ ] **Step 3: Implement service**

Ordering must exactly follow spec:

```text
capability require baseline
-> canonical Base64 decode
-> static module inspection
-> normalize JSON input + size
-> normalize limits
-> verify/invoke runtime
-> strict UTF-8 stdout decode
-> one JSON.parse
-> SHA-256/evidence compose
```

Baseline requests:

```text
document.read.self / document:self
document.compute / document:self
ephemeral.output / execution:wasm
```

- [ ] **Step 4: Re-run service tests**

Expected PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add capability-gated document Wasm service`

---

### Task 6: Shared MCP `execute_wasm_document` Tool

**Files:**
- Create: `mcp-wasm-sandbox.js`
- Create: `test/mcp-wasmtime-sandbox.test.mjs`
- Modify: `mcp-server-factory.js`

**Interfaces:**
- `registerWasmSandboxMcp(server, { wasmService }) -> boolean`.
- `createMcpServer(workspaceRoot, options)` receives/internally creates a document Wasm service without changing stdio vs remote semantics.

- [ ] **Step 1: Write real MCP RED E2E**

Call through MCP client:

```js
client.callTool({
  name: 'execute_wasm_document',
  arguments: {
    module_base64: moduleBytes.toString('base64'),
    input: { n: 7 },
  },
})
```

Assert:
- tool exists;
- positive fixture returns parsed JSON + sandbox evidence;
- input schema has no `module_path`, `workspace_path`, `preopen_dir`, `env`, `network`, `command`, `shell`, `args`, `credential`, or connector ticket field;
- existing `evaluate_aimdc` still passes its current test.

- [ ] **Step 2: Run RED**

Expected fail because MCP tool is absent.

- [ ] **Step 3: Implement one shared registration**

Zod schema:

```js
{
  module_base64: z.string().min(4),
  input: z.unknown(),
  limits: z.object({
    fuel: z.number().int().positive().optional(),
    memory_bytes: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional(),
    wasm_stack_bytes: z.number().int().positive().optional(),
  }).strict().optional(),
}
```

Do not accept arbitrary host fields.

- [ ] **Step 4: Run MCP E2E + existing MCP/capability/publication suites**

Expected PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: expose Wasmtime document sandbox through MCP`

---

### Task 7: Executable Physical-Sandbox Boundary Verifier and Documentation

**Files:**
- Create: `scripts/verify_wasmtime_sandbox_boundary.mjs`
- Create: `docs/WASMTIME-DOCUMENT-SANDBOX.md`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `package.json`
- Modify: `.github/workflows/publication-runtime.yml`

**Interfaces:**
- `npm run verify:wasmtime-sandbox` exits nonzero on boundary regression.

- [ ] **Step 1: Write the boundary verifier before changing docs/CI closure**

Mechanically assert source does not contain forbidden runtime behavior:

```text
--dir
--env
inherit-env
inherit-network
shell: true
module_path
workspace_path
preopen_dir
connector credential/keyring/persistent-broker imports in server/sandbox
provider API URLs in server/sandbox
```

Also assert:
- runtime imports `spawn` directly and uses `shell:false`;
- child env builder has explicit allowlist logic;
- WASI allowlist source contains only `fd_read`, `fd_write`, `proc_exit`;
- MCP schema contains `module_base64` and no path/host-capability fields;
- temp cleanup is present in `finally`;
- build artifacts do not contain credential envelope material introduced through sandbox UI (there is no browser sandbox UI in PR-F).

- [ ] **Step 2: Run verifier RED if any existing source violates the new contract**

Expected failure only for intentionally unfinished Task 7 wiring, not unrelated code.

- [ ] **Step 3: Add scripts and CI closure**

`package.json`:

```json
"test:wasmtime-sandbox": "node --test test/wasmtime-import-policy.test.mjs test/wasmtime-runtime-contract.test.mjs test/wasmtime-real-runtime.test.mjs test/wasmtime-resource-limits.test.mjs test/document-wasm-service.test.mjs test/mcp-wasmtime-sandbox.test.mjs",
"verify:wasmtime-sandbox": "node scripts/verify_wasmtime_sandbox_boundary.mjs"
```

CI final sandbox sequence:

```yaml
- run: node scripts/compile_wasmtime_fixtures.mjs
- run: npm run test:wasmtime-sandbox
- run: npm run test:mcp-delegation
- run: npm run test:credential-broker
- run: npm run test:google-connector
- run: npm run test:github-connector
- run: npm run test:capabilities
- run: npm run test:publication
- run: npm run build
- run: node scripts/verify_github_connector_build.mjs
- run: node scripts/verify_google_drive_connector_build.mjs
- run: node scripts/verify_credential_boundary.mjs
- run: node scripts/verify_mcp_delegation_boundary.mjs
- run: npm run verify:wasmtime-sandbox
- run: npm run verify:dynamic-logic
- run: npm run verify:dynamic-rendering
```

Artifact name becomes `eveglyph-wasmtime-document-sandbox-runtime` and is exact `git archive HEAD`.

- [ ] **Step 4: Write operator/security docs**

Document manual Wasmtime install/config, exact `48.0.0`, `EVEGLYPH_WASMTIME_BIN`, guest ABI, allowed imports, limits, MCP example, no automatic download, and explicit statement that a fully compromised Wasmtime/JIT process is outside this PR's protection.

- [ ] **Step 5: Run verifier + full regression**

Expected PASS.

- [ ] **Step 6: Commit**

Commit message: `docs: close Wasmtime sandbox security boundary`

---

### Task 8: Final Exact-Head Verification, Review, PR #12, and Artifact

**Files:** No new runtime feature files unless a verified blocker requires a minimal fix.

- [ ] **Step 1: Freeze candidate head and run fresh full CI**

Do not add validation documents containing the exact head SHA after this run. Exact-head evidence belongs in PR metadata/artifact metadata to avoid self-referential commits.

- [ ] **Step 2: Require final CI evidence**

All Task 7 gates plus packaging/upload must be green on the same head.

- [ ] **Step 3: Base-to-head security review**

Compare exact PR-E base `e9565a96c757b9c23feb68230306fa206ccace15` to final PR-F head. Verify:
- no connector write changes;
- no credential/keyring imports in sandbox;
- no browser sandbox authority path;
- no automatic runtime download;
- no workspace/module host path input;
- no preopen/env/network flags;
- no temporary self-modifying workflow/helper remains.

- [ ] **Step 4: Download and inspect exact Actions artifact**

Verify outer Actions SHA-256 against GitHub metadata, inner `git archive` integrity, inner ZIP SHA-256, and offline scans for forbidden sandbox authority terms/temporary scaffolding.

- [ ] **Step 5: Open stacked PR #12**

Base branch: `feat/mcp-delegated-connector-operations`.

Title: `feat: add Wasmtime physical document sandbox runtime`

PR body records exact base/head, TDD RED runs, final tests/verifiers, explicit non-goals, Actions artifact id/digests, and engine-compromise limitation.

- [ ] **Step 6: Refresh PR metadata**

Require open, not merged, ready-for-review, and `mergeable=true` before reporting closure.
