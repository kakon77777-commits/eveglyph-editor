import { z } from 'zod'

import { toPublicSandboxError } from './server/sandbox/errors.js'

const jsonResult = value => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

function errorResult(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('sandbox_')) {
    const publicError = toPublicSandboxError(error)
    return {
      content: [{ type: 'text', text: `Error [${publicError.code}]: ${publicError.message}` }],
      isError: true,
    }
  }
  if (error?.code === 'capability_denied') {
    return {
      content: [{ type: 'text', text: `Error [capability_denied]: ${error.message}` }],
      isError: true,
    }
  }
  return {
    content: [{ type: 'text', text: 'Error [sandbox_internal_error]: Internal sandbox error.' }],
    isError: true,
  }
}

export function registerWasmSandboxMcp(server, { wasmService } = {}) {
  if (!server || typeof server.registerTool !== 'function') throw new TypeError('MCP server is required')
  if (!wasmService || typeof wasmService.execute !== 'function') throw new TypeError('document Wasm service is required')

  server.registerTool('execute_wasm_document', {
    title: 'Execute an untrusted document WebAssembly program',
    description: 'Execute one bounded wasi-stdio-json WebAssembly module through EveGlyph\'s document-only capability policy and Wasmtime physical sandbox. The tool accepts module bytes and JSON input only; it exposes no host path, environment, network, connector, credential, shell, or process-spawn authority.',
    inputSchema: {
      module_base64: z.string().min(4).describe('Canonical Base64-encoded WebAssembly module bytes (maximum decoded size 1 MiB)'),
      input: z.unknown().describe('JSON-compatible input value delivered to guest stdin'),
      limits: z.object({
        fuel: z.number().int().positive().optional(),
        memory_bytes: z.number().int().positive().optional(),
        timeout_ms: z.number().int().positive().optional(),
        wasm_stack_bytes: z.number().int().positive().optional(),
      }).strict().optional(),
    },
  }, async args => {
    try {
      return jsonResult(await wasmService.execute({
        moduleBase64: args.module_base64,
        input: args.input,
        limits: args.limits,
        actor: {
          client: 'eveglyph-mcp',
          document: 'inline:execute_wasm_document',
        },
      }))
    } catch (error) {
      return errorResult(error)
    }
  })

  return true
}
