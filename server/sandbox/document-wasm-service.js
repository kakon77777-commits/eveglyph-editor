import { createHash } from 'node:crypto'

import { createCapabilitySession } from '../../src/capabilities/session.js'
import { sandboxError } from './errors.js'
import { MAX_INPUT_BYTES, normalizeSandboxLimits } from './limits.js'
import { decodeCanonicalModuleBase64, inspectWasiStdioJsonModule } from './wasi-import-policy.js'

const BASELINE_REQUESTS = Object.freeze([
  Object.freeze({
    capability: 'document.read.self',
    resource: 'document:self',
    lifetime: 'once',
    reason: 'Read current document semantics for sandboxed Wasm execution.',
  }),
  Object.freeze({
    capability: 'document.compute',
    resource: 'document:self',
    lifetime: 'once',
    reason: 'Execute bounded document computation through Wasmtime.',
  }),
  Object.freeze({
    capability: 'ephemeral.output',
    resource: 'execution:wasm',
    lifetime: 'once',
    reason: 'Return ephemeral Wasmtime result and physical-sandbox evidence.',
  }),
])

function serializeInput(input) {
  let json
  try {
    json = JSON.stringify(input)
  } catch {
    throw sandboxError('sandbox_invalid_input')
  }
  if (typeof json !== 'string') throw sandboxError('sandbox_invalid_input')
  const bytes = Buffer.from(`${json}\n`, 'utf8')
  if (bytes.length > MAX_INPUT_BYTES) throw sandboxError('sandbox_input_too_large')
  return bytes
}

function parseOutput(stdout) {
  if (!stdout || stdout.length === 0) throw sandboxError('sandbox_output_empty')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch {
    throw sandboxError('sandbox_output_invalid_utf8')
  }
  const trimmed = text.trim()
  if (!trimmed) throw sandboxError('sandbox_output_empty')
  try {
    return JSON.parse(trimmed)
  } catch {
    throw sandboxError('sandbox_output_invalid_json')
  }
}

export function createDocumentWasmService({ runtime } = {}) {
  if (!runtime || typeof runtime.execute !== 'function') {
    throw new TypeError('Wasmtime runtime with execute() is required')
  }

  async function execute({
    moduleBase64,
    input,
    limits: requestedLimits,
    session: providedSession,
    actor,
    grants = [],
  } = {}) {
    const session = providedSession || createCapabilitySession({
      profile: 'document-only',
      actor,
      grants,
    })

    // Authority must be proven before touching the untrusted module or runtime.
    for (const request of BASELINE_REQUESTS) session.require(request)

    const moduleBytes = decodeCanonicalModuleBase64(moduleBase64)
    const moduleInfo = inspectWasiStdioJsonModule(moduleBytes)
    const stdinBytes = serializeInput(input)
    const limits = normalizeSandboxLimits(requestedLimits)

    const execution = await runtime.execute({
      moduleBytes,
      stdinBytes,
      limits,
    })
    const result = parseOutput(execution.stdout)
    const moduleSha256 = createHash('sha256').update(moduleBytes).digest('hex')

    return Object.freeze({
      result,
      module_sha256: moduleSha256,
      sandbox: Object.freeze({
        runtime: 'wasmtime',
        runtime_version: execution.runtime_version || runtime.version || '48.0.0',
        profile: 'wasi-stdio-json',
        entrypoint: moduleInfo.entrypoint,
        imports: moduleInfo.imports,
        limits,
        capability: session.snapshot(),
      }),
    })
  }

  return Object.freeze({ execute })
}
