function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

const GITHUB_NAME_RE = /^[A-Za-z0-9_.-]+$/
const GOOGLE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/

export function normalizeGitHubRepository(value) {
  if (typeof value !== 'string') throw codedError('github_invalid_repository', 'repository must be owner/repo')
  const text = value.trim()
  const parts = text.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1] || !GITHUB_NAME_RE.test(parts[0]) || !GITHUB_NAME_RE.test(parts[1])) {
    throw codedError('github_invalid_repository', 'repository must be a valid owner/repo identifier')
  }
  return `${parts[0]}/${parts[1]}`
}

export function normalizeGitHubPath(value) {
  if (typeof value !== 'string') throw codedError('github_invalid_path', 'path must be a non-empty repository-relative path')
  const text = value.trim()
  if (!text || text.startsWith('/') || text.includes('\0')) {
    throw codedError('github_invalid_path', 'path must be a non-empty repository-relative path')
  }
  const segments = text.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw codedError('github_invalid_path', 'path contains an invalid segment')
  }
  return segments.join('/')
}

export function normalizeGitHubRef(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw codedError('github_invalid_ref', 'ref must be a non-empty string')
  }
  return value.trim()
}

export function githubRepositoryGrantResource(repository) {
  return `github:repository:${normalizeGitHubRepository(repository)}:contents:*`
}

export function githubRepositoryFileResource(repository, path) {
  return `github:repository:${normalizeGitHubRepository(repository)}:contents:${normalizeGitHubPath(path)}`
}

export function normalizeGoogleFileId(value) {
  if (typeof value !== 'string') throw codedError('google_drive_invalid_file_id', 'Google Drive file id must be a non-empty identifier')
  const id = value.trim()
  if (!GOOGLE_FILE_ID_RE.test(id)) throw codedError('google_drive_invalid_file_id', 'Google Drive file id is invalid')
  return id
}

export function normalizeGooglePageToken(value) {
  if (value == null || value === '') return null
  const token = String(value).trim()
  if (!token || token.length > 2048 || token.includes('\0')) {
    throw codedError('google_drive_invalid_page_token', 'Google Drive page token is invalid')
  }
  return token
}

export function googleMetadataGrantResource() {
  return 'google:drive:files:*'
}

export function googleMetadataListResource() {
  return 'google:drive:files:list'
}

export function googleFileResource(fileId) {
  return `google:drive:file:${normalizeGoogleFileId(fileId)}`
}

const DELEGATED_SPECS = Object.freeze({
  github_read_file_delegated: Object.freeze({
    provider: 'github',
    operation: 'read-file',
    capability: 'connector.github.repository.contents.read',
    normalize(input = {}) {
      const repository = normalizeGitHubRepository(input.repository)
      const path = normalizeGitHubPath(input.path)
      const ref = normalizeGitHubRef(input.ref)
      return Object.freeze({
        input: Object.freeze({ repository, path, ...(ref ? { ref } : {}) }),
        resource: `github:repository:${repository}:contents:${path}`,
      })
    },
  }),
  google_drive_list_files_delegated: Object.freeze({
    provider: 'google',
    operation: 'list-files',
    capability: 'connector.google.drive.metadata.list',
    normalize(input = {}) {
      const pageToken = normalizeGooglePageToken(input.page_token)
      return Object.freeze({
        input: Object.freeze(pageToken ? { page_token: pageToken } : {}),
        resource: googleMetadataListResource(),
      })
    },
  }),
  google_drive_read_file_delegated: Object.freeze({
    provider: 'google',
    operation: 'read-file',
    capability: 'connector.google.drive.file.read',
    normalize(input = {}) {
      const fileId = normalizeGoogleFileId(input.file_id)
      return Object.freeze({
        input: Object.freeze({ file_id: fileId }),
        resource: `google:drive:file:${fileId}`,
      })
    },
  }),
})

export const DELEGATED_TOOL_NAMES = Object.freeze(Object.keys(DELEGATED_SPECS))

export function resolveDelegatedOperation(toolName, input = {}) {
  const spec = DELEGATED_SPECS[toolName]
  if (!spec) throw codedError('unknown_delegated_tool', `unknown delegated connector tool: ${toolName}`)
  const normalized = spec.normalize(input)
  return Object.freeze({
    tool: toolName,
    provider: spec.provider,
    operation: spec.operation,
    capability: spec.capability,
    resource: normalized.resource,
    input: normalized.input,
  })
}
