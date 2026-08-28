import test from 'node:test'
import assert from 'node:assert/strict'

import { createMemoryCredentialBroker } from '../server/credentials/memory-broker.js'
import { getCapabilityDefinition } from '../src/capabilities/index.js'

async function requireDriveService() {
  try { return await import('../server/connectors/google-drive-service.js') }
  catch (error) { assert.fail(`Google Drive connector service is not implemented: ${error?.message || error}`) }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

function bytesResponse(text, status = 200) {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain; charset=utf-8', 'content-length': String(bytes.length) }),
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
  }
}

function makeHarness({ fetchImpl, expiresAt = '2026-08-28T07:00:00.000Z', refreshImpl } = {}) {
  const broker = createMemoryCredentialBroker({
    now: () => new Date('2026-08-28T06:00:00.000Z'),
    idFactory: () => 'google-cred',
  })
  const oauth = {
    configured: () => true,
    start: ({ redirectUri }) => ({ authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(redirectUri)}` }),
    async complete({ broker: targetBroker }) {
      const credentialId = targetBroker.store({
        provider: 'google',
        account: { sub: 'google-sub-1', email: 'neo@example.com', email_verified: true, name: 'Neo', picture: null },
        accessToken: 'google-access-secret',
        accessExpiresAt: expiresAt,
        refreshToken: 'google-refresh-secret',
      })
      return { credentialId, account: { sub: 'google-sub-1', email: 'neo@example.com', email_verified: true, name: 'Neo', picture: null } }
    },
    async refreshCredential(args) {
      if (refreshImpl) return refreshImpl(args)
      return args.broker.replaceSecrets(args.credentialId, {
        accessToken: 'google-access-refreshed',
        accessExpiresAt: '2026-08-28T08:00:00.000Z',
        refreshToken: 'google-refresh-secret',
      })
    },
  }
  return { broker, oauth, fetchImpl }
}

async function connectedService(options = {}) {
  const { createGoogleDriveConnectorService } = await requireDriveService()
  const harness = makeHarness(options)
  const service = createGoogleDriveConnectorService({
    ...harness,
    now: () => new Date('2026-08-28T06:00:00.000Z'),
    eventIdFactory: (() => { let i = 0; return () => `google-event-${++i}` })(),
  })
  await service.completeAuth({ code: 'code', state: 'state' })
  return { service, ...harness }
}

test('Google Drive metadata list capability is registered independently from file read and write', () => {
  const metadata = getCapabilityDefinition('connector.google.drive.metadata.list')
  const read = getCapabilityDefinition('connector.google.drive.file.read')
  const write = getCapabilityDefinition('connector.google.drive.file.write')
  assert.equal(metadata.risk, 'medium')
  assert.equal(read.risk, 'medium')
  assert.equal(write.risk, 'high')
  assert.notEqual(metadata.id, read.id)
})

test('Google OAuth connection establishes identity with zero Drive grants', async () => {
  const { service } = await connectedService({ fetchImpl: async () => { throw new Error('no API call expected') } })
  const status = service.getStatus()
  assert.equal(status.connected, true)
  assert.equal(status.account.sub, 'google-sub-1')
  assert.deepEqual(status.grants, [])
})

test('Drive file listing is denied before explicit metadata grant and allowed after the grant', async () => {
  let fetchCount = 0
  const { service } = await connectedService({
    fetchImpl: async (url, options = {}) => {
      fetchCount += 1
      const parsed = new URL(String(url))
      assert.equal(parsed.origin + parsed.pathname, 'https://www.googleapis.com/drive/v3/files')
      assert.equal(parsed.searchParams.get('q'), 'trashed = false')
      assert.equal(parsed.searchParams.get('pageSize'), '50')
      assert.match(parsed.searchParams.get('fields'), /files\(id,name,mimeType,size,modifiedTime,webViewLink\)/)
      assert.equal(options.headers.Authorization, 'Bearer google-access-secret')
      return jsonResponse({
        files: [
          { id: 'file_1234567890', name: 'Research.md', mimeType: 'text/markdown', size: '321', modifiedTime: '2026-08-27T00:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/file_1234567890/view' },
          { id: 'doc_12345678901', name: 'Theory', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-08-26T00:00:00.000Z', webViewLink: 'https://docs.google.com/document/d/doc_12345678901/edit' },
        ],
        nextPageToken: 'next-token',
      })
    },
  })

  await assert.rejects(
    service.listDriveFiles(),
    error => error?.code === 'capability_denied',
  )
  assert.equal(fetchCount, 0)

  const grant = service.grantMetadataList()
  assert.equal(grant.capability, 'connector.google.drive.metadata.list')
  assert.equal(grant.resource, 'google:drive:files:*')

  const listed = await service.listDriveFiles()
  assert.equal(fetchCount, 1)
  assert.equal(listed.files.length, 2)
  assert.deepEqual(listed.files[0], {
    id: 'file_1234567890',
    name: 'Research.md',
    mime_type: 'text/markdown',
    size: 321,
    modified_time: '2026-08-27T00:00:00.000Z',
    web_view_link: 'https://drive.google.com/file/d/file_1234567890/view',
  })
  assert.equal(listed.next_page_token, 'next-token')
  assert.equal(listed.capability_evidence.decision, 'allow')
  assert.equal(listed.capability_evidence.profile, 'connector-session')
})

test('Drive file A grant permits A and does not authorize file B', async () => {
  let fetchCount = 0
  const { service } = await connectedService({
    fetchImpl: async () => { fetchCount += 1; throw new Error('network should not run for denied file') },
  })

  const grant = service.grantFileRead({ fileId: 'file_A1234567890' })
  assert.equal(grant.capability, 'connector.google.drive.file.read')
  assert.equal(grant.resource, 'google:drive:file:file_A1234567890')

  await assert.rejects(
    service.readDriveFile({ fileId: 'file_B1234567890' }),
    error => error?.code === 'capability_denied',
  )
  assert.equal(fetchCount, 0)
})

test('Drive stored UTF-8 text file is read through metadata then alt=media after exact file grant', async () => {
  const calls = []
  const { service } = await connectedService({
    fetchImpl: async (url, options = {}) => {
      calls.push([String(url), options])
      const parsed = new URL(String(url))
      if (parsed.pathname === '/drive/v3/files/file_text1234567890' && parsed.searchParams.get('alt') !== 'media') {
        assert.match(parsed.searchParams.get('fields'), /id,name,mimeType,size,modifiedTime,webViewLink/)
        return jsonResponse({
          id: 'file_text1234567890',
          name: 'notes.md',
          mimeType: 'text/markdown',
          size: '12',
          modifiedTime: '2026-08-28T00:00:00.000Z',
          webViewLink: 'https://drive.google.com/file/d/file_text1234567890/view',
        })
      }
      if (parsed.pathname === '/drive/v3/files/file_text1234567890' && parsed.searchParams.get('alt') === 'media') {
        return bytesResponse('# hello\n世界')
      }
      throw new Error(`unexpected URL ${url}`)
    },
  })

  service.grantFileRead({ fileId: 'file_text1234567890' })
  const result = await service.readDriveFile({ fileId: 'file_text1234567890' })
  assert.equal(result.file.id, 'file_text1234567890')
  assert.equal(result.file.name, 'notes.md')
  assert.equal(result.export_mime_type, null)
  assert.equal(result.content, '# hello\n世界')
  assert.equal(result.encoding, 'utf-8')
  assert.equal(result.capability_evidence.decision, 'allow')
  assert.equal(calls.length, 2)
  for (const [, options] of calls) assert.match(options.headers.Authorization, /^Bearer google-access-secret$/)
})

test('Google Docs are exported as Markdown instead of treated as stored Drive bytes', async () => {
  const calls = []
  const { service } = await connectedService({
    fetchImpl: async (url) => {
      calls.push(String(url))
      const parsed = new URL(String(url))
      if (parsed.pathname === '/drive/v3/files/doc_markdown123456') {
        return jsonResponse({
          id: 'doc_markdown123456',
          name: 'Canonical Theory',
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2026-08-28T00:00:00.000Z',
          webViewLink: 'https://docs.google.com/document/d/doc_markdown123456/edit',
        })
      }
      if (parsed.pathname === '/drive/v3/files/doc_markdown123456/export') {
        assert.equal(parsed.searchParams.get('mimeType'), 'text/markdown')
        return bytesResponse('# Canonical Theory\n\nBody')
      }
      throw new Error(`unexpected URL ${url}`)
    },
  })

  service.grantFileRead({ fileId: 'doc_markdown123456' })
  const result = await service.readDriveFile({ fileId: 'doc_markdown123456' })
  assert.equal(result.export_mime_type, 'text/markdown')
  assert.equal(result.content, '# Canonical Theory\n\nBody')
  assert.equal(calls.some(url => url.includes('alt=media')), false)
})

test('Drive read rejects oversized or non-UTF-8 content and unsupported Google Workspace exports', async () => {
  const { MAX_DRIVE_TEXT_BYTES } = await requireDriveService()

  for (const scenario of ['oversized', 'binary', 'unsupported-workspace']) {
    const { service } = await connectedService({
      fetchImpl: async (url) => {
        const parsed = new URL(String(url))
        if (!parsed.pathname.endsWith('/export') && parsed.searchParams.get('alt') !== 'media') {
          if (scenario === 'oversized') return jsonResponse({ id: 'file_reject123456', name: 'huge.txt', mimeType: 'text/plain', size: String(MAX_DRIVE_TEXT_BYTES + 1) })
          if (scenario === 'binary') return jsonResponse({ id: 'file_reject123456', name: 'bad.txt', mimeType: 'text/plain', size: '2' })
          return jsonResponse({ id: 'file_reject123456', name: 'drawing', mimeType: 'application/vnd.google-apps.drawing' })
        }
        if (scenario === 'binary') {
          const bytes = Uint8Array.from([0xff, 0xfe])
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-length': '2' }),
            async arrayBuffer() { return bytes.buffer },
          }
        }
        throw new Error('content fetch should not occur')
      },
    })
    service.grantFileRead({ fileId: 'file_reject123456' })
    const expected = scenario === 'oversized'
      ? 'google_drive_file_too_large'
      : scenario === 'binary'
        ? 'google_drive_file_encoding_unsupported'
        : 'google_drive_export_unsupported'
    await assert.rejects(
      service.readDriveFile({ fileId: 'file_reject123456' }),
      error => error?.code === expected,
    )
  }
})

test('an oversized Google Doc export is rejected without buffering the full body first', async () => {
  // Regression test for a real finding: readTextBytes() only pre-checked
  // size via Content-Length or Drive's file.size metadata. Google Docs
  // exports (files.export) have neither — the export is generated on the
  // fly with no advertised length, and Drive's file metadata never
  // populates `size` for native Workspace documents. So exactly the file
  // type most likely to lack both signals also skipped the pre-flight size
  // check entirely, and got fully buffered into memory before the
  // post-hoc byte-length check finally rejected it. Still failed closed
  // (no oversized content was ever returned) — this was a resource-
  // exhaustion gap, not a confidentiality leak — but it contradicted the
  // connector's own "1 MiB enforced before buffering" claim for this path.
  const { MAX_DRIVE_TEXT_BYTES } = await requireDriveService()
  const chunkSize = 64 * 1024
  const totalBytes = MAX_DRIVE_TEXT_BYTES * 4 // a lot more than the limit
  let bytesPulled = 0
  let cancelled = false
  const { service } = await connectedService({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url))
      if (!parsed.pathname.endsWith('/export')) {
        // Deliberately no `size` field — matches what Drive's real
        // metadata response for a native Google Doc actually looks like.
        return jsonResponse({ id: 'doc_oversized123456', name: 'huge doc', mimeType: 'application/vnd.google-apps.document' })
      }
      // No Content-Length header either — matches a real export response.
      let sent = 0
      const body = new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) { controller.close(); return }
          const size = Math.min(chunkSize, totalBytes - sent)
          const chunk = new Uint8Array(size).fill(0x61)
          sent += size
          bytesPulled += size
          controller.enqueue(chunk)
        },
        cancel() { cancelled = true },
      })
      return { ok: true, status: 200, headers: new Headers(), body }
    },
  })

  service.grantFileRead({ fileId: 'doc_oversized123456' })
  await assert.rejects(
    service.readDriveFile({ fileId: 'doc_oversized123456' }),
    error => error?.code === 'google_drive_file_too_large',
  )
  // The real assertion: readTextBytes must abort as soon as the running
  // total crosses the limit, not after draining all totalBytes (4x the
  // limit) into memory first. The exact stop point isn't pinned to a
  // single chunk: ReadableStream's default queuing strategy lets the
  // producer buffer a little ahead of what the consumer has actually
  // read via reader.read(), so a small multi-chunk margin is expected
  // stream behavior, not a bug — the bound below (4 chunks) is generous
  // enough to absorb that while still being nowhere near totalBytes.
  assert.ok(bytesPulled < totalBytes, `expected an early abort, but all ${totalBytes} bytes were pulled from the stream`)
  assert.ok(bytesPulled <= MAX_DRIVE_TEXT_BYTES + (chunkSize * 4), `expected to stop close to the limit, pulled ${bytesPulled} bytes (limit ${MAX_DRIVE_TEXT_BYTES})`)
  assert.equal(cancelled, true, 'the underlying stream reader should be cancelled once the limit is exceeded')
})

test('expiring Google token refreshes before Drive API access', async () => {
  let refreshCount = 0
  const seenAuth = []
  const { service } = await connectedService({
    expiresAt: '2026-08-28T06:00:10.000Z',
    refreshImpl: async ({ credentialId, broker }) => {
      refreshCount += 1
      return broker.replaceSecrets(credentialId, {
        accessToken: 'fresh-google-access',
        accessExpiresAt: '2026-08-28T07:00:00.000Z',
        refreshToken: 'google-refresh-secret',
      })
    },
    fetchImpl: async (url, options = {}) => {
      seenAuth.push(options.headers.Authorization)
      const parsed = new URL(String(url))
      if (parsed.pathname === '/drive/v3/files') return jsonResponse({ files: [] })
      throw new Error(`unexpected ${url}`)
    },
  })

  service.grantMetadataList()
  await service.listDriveFiles()
  assert.equal(refreshCount, 1)
  assert.deepEqual(seenAuth, ['Bearer fresh-google-access'])
})

test('disconnect destroys Google credential and all Drive grants; public service exposes no write surface', async () => {
  const { service, broker } = await connectedService({ fetchImpl: async () => jsonResponse({ files: [] }) })
  service.grantMetadataList()
  service.grantFileRead({ fileId: 'file_disconnect1234' })
  const credentialId = service.getStatus().credential_id

  assert.equal(service.disconnect(), true)
  assert.equal(service.getStatus().connected, false)
  assert.deepEqual(service.getStatus().grants, [])
  assert.throws(() => broker.describe(credentialId), error => error?.code === 'credential_not_found')

  for (const forbidden of ['writeDriveFile', 'createDriveFile', 'updateDriveFile', 'deleteDriveFile', 'requestAuthenticated']) {
    assert.equal(Object.prototype.hasOwnProperty.call(service, forbidden), false, `unexpected write surface ${forbidden}`)
  }
})
