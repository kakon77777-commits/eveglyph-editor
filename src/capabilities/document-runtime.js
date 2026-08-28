import { evaluateDocument } from '../aimdc/graph.js'
import { createCapabilitySession } from './session.js'

const BASELINE_REQUESTS = Object.freeze([
  Object.freeze({
    capability: 'document.read.self',
    resource: 'document:self',
    lifetime: 'once',
    reason: 'Read current document semantics for AIMD-C evaluation.',
  }),
  Object.freeze({
    capability: 'document.compute',
    resource: 'document:self',
    lifetime: 'once',
    reason: 'Evaluate bounded AIMD-C computation.',
  }),
  Object.freeze({
    capability: 'ephemeral.output',
    resource: 'execution:aimdc',
    lifetime: 'once',
    reason: 'Return ephemeral AIMD-C results and evidence.',
  }),
])

// Canonical authority-aware entry point for AIMD-C document computation.
// It deliberately accepts no filesystem, network, process, environment,
// credential, OAuth or provider objects. Any authority beyond the baseline
// must arrive as an explicit capability request and be authorized by the
// supplied/created capability session before the pure graph evaluator runs.
export function evaluateDocumentInSandbox(blocks, options = {}) {
  const {
    externalRefs = {},
    session: providedSession,
    profile = 'document-only',
    grants = [],
    actor,
    requestedCapabilities = [],
  } = options || {}

  const session = providedSession || createCapabilitySession({ profile, grants, actor })

  for (const request of BASELINE_REQUESTS) session.require(request)
  for (const request of requestedCapabilities) session.require(request)

  const result = evaluateDocument(blocks, externalRefs)
  return {
    ...result,
    sandbox: session.snapshot(),
  }
}
