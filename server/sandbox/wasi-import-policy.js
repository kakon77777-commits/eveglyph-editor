import { MAX_MODULE_BYTES } from './limits.js'
import { sandboxError } from './errors.js'

const ALLOWED_IMPORTS = new Set([
  'wasi_snapshot_preview1.fd_read',
  'wasi_snapshot_preview1.fd_write',
  'wasi_snapshot_preview1.proc_exit',
])

const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_MODULE_BYTES / 3)
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function decodeCanonicalModuleBase64(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BASE64_CHARS) {
    throw sandboxError('sandbox_invalid_module')
  }
  if (!CANONICAL_BASE64.test(text)) throw sandboxError('sandbox_invalid_module')

  const bytes = Buffer.from(text, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_MODULE_BYTES) throw sandboxError('sandbox_invalid_module')
  if (bytes.toString('base64') !== text) throw sandboxError('sandbox_invalid_module')
  return bytes
}

export function inspectWasiStdioJsonModule(bytes) {
  let module
  try {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('module bytes required')
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MODULE_BYTES) throw new TypeError('module size invalid')
    module = new WebAssembly.Module(bytes)
  } catch {
    throw sandboxError('sandbox_invalid_module')
  }

  const imports = WebAssembly.Module.imports(module)
  const names = []
  for (const item of imports) {
    const authority = `${item.module}.${item.name}`
    if (item.kind !== 'function' || !ALLOWED_IMPORTS.has(authority)) {
      throw sandboxError('sandbox_import_denied')
    }
    names.push(authority)
  }

  const exports = WebAssembly.Module.exports(module)
  const start = exports.find(item => item.name === '_start' && item.kind === 'function')
  if (!start) throw sandboxError('sandbox_entrypoint_missing')

  return Object.freeze({
    imports: Object.freeze(names),
    exports: Object.freeze(exports.map(item => `${item.kind}:${item.name}`)),
    entrypoint: '_start',
  })
}

export const WASI_STDIO_JSON_ALLOWED_IMPORTS = Object.freeze([...ALLOWED_IMPORTS])
