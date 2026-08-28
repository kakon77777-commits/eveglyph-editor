import { createDelegationBroker } from '../credentials/delegation-broker.js'
import { createDelegationIpcServer } from '../credentials/delegation-ipc.js'
import { resolveDelegatedOperation } from './delegated-contracts.js'

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
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
      return githubService.readRepositoryFile({
        repository: operation.input.repository,
        path: operation.input.path,
        ref: operation.input.ref ?? null,
      })
    },
    'google:list-files': async ({ delegation, input }) => {
      const operation = resolveDelegatedOperation('google_drive_list_files_delegated', input || {})
      requireMatch(delegation, operation)
      if (!googleService) throw codedError('delegation_service_unavailable', 'Google delegated connector service is unavailable')
      return googleService.listDriveFiles({ pageToken: operation.input.page_token ?? null })
    },
    'google:read-file': async ({ delegation, input }) => {
      const operation = resolveDelegatedOperation('google_drive_read_file_delegated', input || {})
      requireMatch(delegation, operation)
      if (!googleService) throw codedError('delegation_service_unavailable', 'Google delegated connector service is unavailable')
      return googleService.readDriveFile({ fileId: operation.input.file_id })
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
