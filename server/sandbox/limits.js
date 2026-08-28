import { sandboxError } from './errors.js'

export const SANDBOX_DEFAULT_LIMITS = Object.freeze({
  fuel: 10_000_000,
  memory_bytes: 32 * 1024 * 1024,
  timeout_ms: 2_000,
  wasm_stack_bytes: 1 * 1024 * 1024,
  instances: 1,
  memories: 1,
  tables: 1,
})

export const SANDBOX_HARD_MAXIMA = Object.freeze({
  fuel: 100_000_000,
  memory_bytes: 64 * 1024 * 1024,
  timeout_ms: 10_000,
  wasm_stack_bytes: 2 * 1024 * 1024,
  instances: 1,
  memories: 1,
  tables: 1,
})

const KEYS = Object.freeze(Object.keys(SANDBOX_DEFAULT_LIMITS))
const KEY_SET = new Set(KEYS)

export const MAX_MODULE_BYTES = 1024 * 1024
export const MAX_INPUT_BYTES = 256 * 1024
export const MAX_STDOUT_BYTES = 1024 * 1024
export const MAX_STDERR_BYTES = 64 * 1024

export function normalizeSandboxLimits(input = {}) {
  if (input == null) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw sandboxError('sandbox_invalid_limits')
  }
  for (const key of Object.keys(input)) {
    if (!KEY_SET.has(key)) throw sandboxError('sandbox_invalid_limits')
  }

  const out = {}
  for (const key of KEYS) {
    const value = input[key] ?? SANDBOX_DEFAULT_LIMITS[key]
    if (!Number.isInteger(value) || value <= 0 || value > SANDBOX_HARD_MAXIMA[key]) {
      throw sandboxError('sandbox_invalid_limits')
    }
    if ((key === 'instances' || key === 'memories' || key === 'tables') && value !== 1) {
      throw sandboxError('sandbox_invalid_limits')
    }
    out[key] = value
  }
  return Object.freeze(out)
}
