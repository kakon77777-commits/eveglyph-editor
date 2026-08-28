export class SandboxError extends Error {
  constructor(code, message) {
    super(message || publicMessageFor(code))
    this.name = 'SandboxError'
    this.code = code
  }
}

const PUBLIC_MESSAGES = Object.freeze({
  sandbox_runtime_unavailable: 'Wasmtime runtime is unavailable.',
  sandbox_runtime_version_mismatch: 'Wasmtime runtime version is not supported.',
  sandbox_invalid_module: 'WebAssembly module is invalid.',
  sandbox_import_denied: 'WebAssembly module requests a denied host import.',
  sandbox_entrypoint_missing: 'WebAssembly module is missing the required _start entrypoint.',
  sandbox_invalid_input: 'Sandbox input is not valid JSON-compatible data.',
  sandbox_input_too_large: 'Sandbox input exceeds the size limit.',
  sandbox_invalid_limits: 'Sandbox resource limits are invalid.',
  sandbox_spawn_failed: 'Sandbox runtime could not be started.',
  sandbox_timeout: 'Sandbox execution exceeded its wall-clock limit.',
  sandbox_fuel_exhausted: 'Sandbox execution exhausted its instruction fuel.',
  sandbox_memory_limit: 'Sandbox execution exceeded its memory limit.',
  sandbox_stack_limit: 'Sandbox execution exceeded its stack limit.',
  sandbox_resource_limit: 'Sandbox execution exceeded a resource limit.',
  sandbox_output_too_large: 'Sandbox stdout exceeds the size limit.',
  sandbox_stderr_too_large: 'Sandbox stderr exceeds the size limit.',
  sandbox_output_empty: 'Sandbox produced no JSON output.',
  sandbox_output_invalid_utf8: 'Sandbox output is not valid UTF-8.',
  sandbox_output_invalid_json: 'Sandbox output is not valid JSON.',
  sandbox_guest_exit_nonzero: 'Sandbox guest exited unsuccessfully.',
  sandbox_internal_error: 'Internal sandbox error.',
})

export function publicMessageFor(code) {
  return PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.sandbox_internal_error
}

export function sandboxError(code, message) {
  return new SandboxError(code, message)
}

export function toPublicSandboxError(error) {
  const code = error instanceof SandboxError && PUBLIC_MESSAGES[error.code]
    ? error.code
    : 'sandbox_internal_error'
  return Object.freeze({ code, message: publicMessageFor(code) })
}
