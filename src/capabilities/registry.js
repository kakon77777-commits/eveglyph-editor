// EveGlyph capability registry.
// Stable capability ids live here so document, MCP and future connector layers
// share one authority vocabulary. Naming is descriptive only: no prefix or
// hierarchy implies another capability.

const entries = [
  ['document.read.self', 'low', 'Read the current document/runtime projections that belong to the same document.'],
  ['document.compute', 'low', 'Evaluate bounded document computation.'],
  ['ephemeral.output', 'low', 'Create or return non-persistent execution output.'],
  ['workspace.read', 'medium', 'Read an explicitly scoped workspace resource.'],
  ['workspace.write', 'high', 'Create or modify an explicitly scoped workspace resource.'],
  ['network.connect', 'high', 'Connect to an explicitly scoped network resource.'],
  ['process.spawn', 'high', 'Spawn an explicitly scoped host process.'],
  ['host.env.read', 'high', 'Read an explicitly scoped host environment value.'],
  ['connector.github.repository.contents.read', 'medium', 'Read contents from an explicitly scoped GitHub repository.'],
  ['connector.github.repository.contents.write', 'high', 'Write contents in an explicitly scoped GitHub repository.'],
  ['connector.google.drive.file.read', 'medium', 'Read an explicitly scoped Google Drive file.'],
  ['connector.google.drive.file.write', 'high', 'Create or modify an explicitly scoped Google Drive file.'],
]

export const CAPABILITY_REGISTRY = Object.freeze(Object.fromEntries(entries.map(([id, risk, description]) => [
  id,
  Object.freeze({ id, risk, description }),
])))

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function getCapabilityDefinition(id) {
  const key = typeof id === 'string' ? id.trim() : ''
  const entry = CAPABILITY_REGISTRY[key]
  if (!entry) throw codedError('unknown_capability', `unknown capability: ${key || String(id)}`)
  return entry
}

export function listCapabilityDefinitions() {
  return Object.freeze(Object.values(CAPABILITY_REGISTRY))
}
