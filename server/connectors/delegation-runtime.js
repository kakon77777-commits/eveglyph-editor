import { createDelegationBroker } from '../credentials/delegation-broker.js'
import { createDelegationIpcServer } from '../credentials/delegation-ipc.js'
import { resolveDelegatedOperation } from './delegated-contracts.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// The GitHub/Google connector services build their actor.session field as
// `${provider}:${credentialId}` — the credential broker's own internal
// lookup handle, not the real OAuth secret itself, but still an internal
// implementation detail with no reason to leave this process. That's fine
// for the local browser-facing HTTP endpoints (same trust boundary, same
// process, and Settings never displays it), but a delegated MCP result
// reaches a channel this project's own docs already flag as something
// third-party MCP hosts may log — so redact just that one field on the way
// out through here, not on the readRepositoryFile/listDriveFiles/
// readDriveFile functions themselves (those stay exactly as they are for
// their existing local HTTP callers).
function redactDelegatedResult(result) {
  if (!result || typeof result !== 'object' || !result.capability_evidence?.actor) return result
  const { actor, ...evidenceRest } = result.capability_evidence
  const { session, ...actorRest } = actor
  return {
    ...result,
    capability_evidence: { ...evidenceRest, actor: actorRest },
  }
}

function requireMatch(delegation, operation) {
  if (!delegation ||
      delegation.provider !== operation.provider ||
      delegation.operation !== operation.operation ||
      delegation.capability !== operation.capability ||
      delegation.resource !== operation.resource) {
    throw codedError('delegation_mismatch', 'delegation input does not match ticket authority')
  }
}

export function createConnectorDelegationRuntime({
  endpoint,
  now,
  randomBytesImpl,
} = {}) {
  const broker = createDelegationBroker({ now, randomBytesImpl })
  let githubService = null
  let googleService = null

  const handlers = {
    'github:read-file': async ({ delegation, input }) => {
      const operation = resolveDelegatedOperation('github_read_file_delegated', input || {})
      requireMatch(delegation, operation)
      if (!githubService) throw codedError('delegation_service_unavailable', 'GitHub delegated connector service is unavailable')
      return redactDelegatedResult(await githubService.readRepositoryFile({
        repository: operation.input.repository,
        path: operation.input.path,
        ref: operation.input.ref ?? null,
      }))
    },
    'google:list-files': async ({ delegation, input }) => {
      const operation = resolveDelegatedOperation('google_drive_list_files_delegated', input || {})
      requireMatch(delegation, operation)
      if (!googleService) throw codedError('delegation_service_unavailable', 'Google delegated connector service is unavailable')
      return redactDelegatedResult(await googleService.listDriveFiles({ pageToken: operation.input.page_token ?? null }))
    },
    'google:read-file': async ({ delegation, input }) => {
      const operation = resolveDelegatedOperation('google_drive_read_file_delegated', input || {})
      requireMatch(delegation, operation)
      if (!googleService) throw codedError('delegation_service_unavailable', 'Google delegated connector service is unavailable')
      return redactDelegatedResult(await googleService.readDriveFile({ fileId: operation.input.file_id }))
    },
  }

  const ipc = createDelegationIpcServer({
    delegationBroker: broker,
    handlers,
    ...(endpoint ? { endpoint } : {}),
  })

  function attachGitHubService(service) {
    if (!service || typeof service.readRepositoryFile !== 'function') throw new TypeError('GitHub connector service is required')
    githubService = service
    return service
  }

  function attachGoogleService(service) {
    if (!service || typeof service.listDriveFiles !== 'function' || typeof service.readDriveFile !== 'function') {
      throw new TypeError('Google Drive connector service is required')
    }
    googleService = service
    return service
  }

  function vitePlugin() {
    return {
      name: 'eveglyph-connector-delegation-runtime',
      apply: 'serve',
      async configureServer(server) {
        await ipc.start()
        server.httpServer?.once('close', () => { void ipc.stop() })
      },
    }
  }

  return Object.freeze({
    broker,
    endpoint: ipc.endpoint,
    attachGitHubService,
    attachGoogleService,
    start: ipc.start,
    stop: ipc.stop,
    vitePlugin,
  })
}
