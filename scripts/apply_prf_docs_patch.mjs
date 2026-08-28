import { readFile, writeFile } from 'node:fs/promises'

async function insertBefore(file, marker, uniqueHeading, block) {
  let text = await readFile(file, 'utf8')
  if (text.includes(uniqueHeading)) return false
  if (!text.includes(marker)) throw new Error(`${file}: marker not found`)
  text = text.replace(marker, `${block}\n\n${marker}`)
  await writeFile(file, text, 'utf8')
  return true
}

async function insertAfter(file, marker, uniqueLine, addition) {
  let text = await readFile(file, 'utf8')
  if (text.includes(uniqueLine)) return false
  if (!text.includes(marker)) throw new Error(`${file}: list marker not found`)
  text = text.replace(marker, `${marker}${addition}`)
  await writeFile(file, text, 'utf8')
  return true
}

const changed = new Set()

const readmeSection = `## Wasmtime physical document sandbox

PR-F adds a separate physical execution path for **untrusted WebAssembly document programs**. Existing AIMD-C stays on its closed JavaScript grammar/evaluator; arbitrary Wasm goes through the server-side Wasmtime boundary instead.

The execution rule is:

\`\`\`text
Policy Allow
AND
Wasmtime Physical Sandbox
\`\`\`

The canonical runtime is **Wasmtime 48.0.0**. EveGlyph never downloads it automatically: install it manually and either place \`wasmtime\` on \`PATH\` or set \`EVEGLYPH_WASMTIME_BIN\` to the absolute executable path.

The only guest profile is \`wasi-stdio-json\`. A guest receives UTF-8 JSON on stdin, returns one UTF-8 JSON value on stdout, exports \`_start\`, and may import only:

\`\`\`text
wasi_snapshot_preview1.fd_read
wasi_snapshot_preview1.fd_write
wasi_snapshot_preview1.proc_exit
\`\`\`

Filesystem preopens, guest environment inheritance, network inheritance, connector/credential host calls, arbitrary host imports, shell execution and workspace/module host paths are not exposed. Static import inspection rejects denied authority **before Wasmtime is spawned**.

The runtime also applies fuel, memory, Wasm-stack, instance/memory/table-count, stdout/stderr and independent wall-clock limits. Each execution uses a private temporary cwd, a fixed \`module.wasm\` staging name, \`shell:false\`, pipe stdio and a minimal child environment; staging is removed in a \`finally\` path.

The shared MCP tool is \`execute_wasm_document\`, which accepts only Base64 module bytes, JSON input and bounded limit overrides. Successful results include the module SHA-256 plus physical-sandbox and capability evidence.

This is a WebAssembly/WASI **guest boundary**, not a claim that a fully compromised Wasmtime/JIT process is OS-contained. Windows Job Object/AppContainer, Linux namespace/seccomp/bubblewrap/gVisor or equivalent platform isolation remains a later layer.

See [\`docs/WASMTIME-DOCUMENT-SANDBOX.md\`](docs/WASMTIME-DOCUMENT-SANDBOX.md) and [\`SECURITY.md\`](SECURITY.md) for the complete contract.`

if (await insertBefore('README.md', '## How it works\n', '## Wasmtime physical document sandbox\n', readmeSection)) changed.add('README.md')

if (await insertAfter(
  'README.md',
  '- `validate_world_ir` — validate a World IR YAML document (state machine / entity / entity list)\n',
  '- `execute_wasm_document` — execute a Base64 WebAssembly module through the document-only policy plus Wasmtime physical sandbox\n',
  '- `execute_wasm_document` — execute a Base64 WebAssembly module through the document-only policy plus Wasmtime physical sandbox\n',
)) changed.add('README.md')

const securitySection = `## Wasmtime physical document sandbox boundary

PR-F adds the first physical execution boundary for untrusted document programs. It does **not** replace the capability control plane. Successful execution requires the existing \`document-only\` grants for \`document.read.self\`, \`document.compute\` and \`ephemeral.output\` **and** successful confinement by the Wasmtime runtime.

The only guest profile is \`wasi-stdio-json\`. Before spawning Wasmtime, EveGlyph validates the binary with \`WebAssembly.Module\` for metadata inspection only, then accepts only these function imports:

\`\`\`text
wasi_snapshot_preview1.fd_read
wasi_snapshot_preview1.fd_write
wasi_snapshot_preview1.proc_exit
\`\`\`

The guest must export \`_start\`. Filesystem imports such as \`path_open\`, environment imports such as \`environ_get\`, socket/network imports, \`env::*\` and arbitrary host imports fail closed before process creation. The module is never instantiated through V8.

Wasmtime 48.0.0 runs as a separate child process with \`shell:false\`, pipe-only stdio, a private per-execution cwd and fixed \`module.wasm\` staging name. No directory is preopened; guest environment/network inheritance is not enabled. The child receives a minimal explicit environment rather than the full EveGlyph process environment, so provider secrets, MCP tokens, HOME/USERPROFILE, SSH/AWS/Azure/OpenAI values and arbitrary parent variables are not forwarded.

Execution is bounded by Wasmtime fuel and resource controls plus an independent Node wall-clock timer. PR-F validates memory growth with \`trap-on-grow-failure=y\`, caps decoded module/input/stdout/stderr sizes, and removes private staging in a \`finally\` path. Stable public error codes are used instead of forwarding raw Wasmtime stderr, process environment, staging paths or host stack traces.

The shared MCP tool \`execute_wasm_document\` accepts only \`module_base64\`, JSON \`input\` and bounded \`limits\`. It has no module/workspace path, preopen, environment, network, command, shell, credential or delegation-ticket field. Its control-plane mapping matches the same three document capability requests enforced by the document-Wasm service.

This boundary protects against ambient host authority through normal WebAssembly/WASI execution. It does **not** claim containment after a hypothetical full Wasmtime/JIT/native-code escape. OS-level process isolation is a separate future layer.

See [\`docs/WASMTIME-DOCUMENT-SANDBOX.md\`](docs/WASMTIME-DOCUMENT-SANDBOX.md) for operator setup, exact limits, ABI and failure semantics.`

if (await insertBefore(
  'SECURITY.md',
  '## Persistent credential vault and delegation boundary\n',
  '## Wasmtime physical document sandbox boundary\n',
  securitySection,
)) changed.add('SECURITY.md')

console.log(changed.size ? `Updated: ${[...changed].join(', ')}` : 'PR-F docs already current')
