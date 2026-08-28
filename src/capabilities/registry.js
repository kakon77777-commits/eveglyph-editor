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
  ['connector.google.drive.metadata.list', 'medium', 'List metadata for Google Drive files within an explicitly granted connector session.'],
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
  // Object.hasOwn, not a bracket-access truthy check: CAPABILITY_REGISTRY is
  // a plain object, so CAPABILITY_REGISTRY['constructor'] (or '__proto__',
  // 'toString', 'hasOwnProperty', 'valueOf', ...) resolves through the
  // Object.prototype chain to a real, truthy value even though no such
  // capability was ever registered — Object.freeze locks down the object's
  // OWN properties, it does not remove its prototype chain. A capability id
  // equal to any Object.prototype member name would silently pass as
  // "known" and return that prototype member as if it were a capability
  // definition, defeating the "unknown capabilities fail closed" invariant.
  if (!Object.hasOwn(CAPABILITY_REGISTRY, key)) {
    throw codedError('unknown_capability', `unknown capability: ${key || String(id)}`)
  }
  return CAPABILITY_REGISTRY[key]
}

export function listCapabilityDefinitions() {
  return Object.freeze(Object.values(CAPABILITY_REGISTRY))
}
