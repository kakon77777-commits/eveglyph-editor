import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function readOrEmpty(url) {
  try { return await readFile(url, 'utf8') }
  catch { return '' }
}

const uiPlugin = await readOrEmpty(new URL('../vite-google-drive-settings-ui.js', import.meta.url))
const settingsModule = await readOrEmpty(new URL('../src/googledrivesettings.js', import.meta.url))
const viteConfig = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8')
const settingsSurface = `${uiPlugin}\n${settingsModule}`

const REQUIRED_IDS = [
  's-google-status',
  'btn-google-connect',
  'btn-google-disconnect',
  'btn-google-grant-metadata',
  'btn-google-list-files',
  's-google-file-select',
  'btn-google-grant-file-read',
  'btn-google-read',
  's-google-read-result',
]

const REQUIRED_EXPORTS = [
  'googleRefreshStatus',
  'googleConnect',
  'googleDisconnect',
  'googleGrantMetadata',
  'googleListFiles',
  'googleGrantFileRead',
  'googleReadFile',
]

test('Settings exposes Google identity, explicit metadata grant, exact file grant, and read-only controls', () => {
  assert.match(settingsSurface, /Google Drive Connector/)
  assert.match(settingsSurface, /OAuth connects identity only/i)
  assert.match(settingsSurface, /Grant metadata browse for this session/i)
  assert.match(settingsSurface, /Grant read for selected file/i)
  for (const id of REQUIRED_IDS) {
    assert.match(settingsSurface, new RegExp(`id=[\\"']${id}[\\"']`), `missing Google Settings control ${id}`)
  }
  assert.match(settingsSurface, /<(pre|textarea)[^>]+id=[\\"']s-google-read-result[\\"']/i)
})

test('Google Settings surface contains no OAuth access-token, refresh-token, or client-secret input', () => {
  const inputs = [...settingsSurface.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
  const dangerous = inputs.filter(input => /google[^>]*(access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)|(access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)[^>]*google/i.test(input))
  assert.deepEqual(dangerous, [])
  assert.equal(/id=[\\"'][^\\"']*google[^\\"']*(token|secret)[^\\"']*[\\"']/i.test(settingsSurface), false)
})

test('Google Settings module exports all seven connector actions and uses only the local broker endpoints', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.match(settingsModule, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`), `missing export ${name}`)
  }
  assert.match(settingsModule, /fetch\(`\/api\/connectors\/google\/\$\{path\}`/)
  for (const route of ['status', 'auth/start', 'disconnect', 'grant-metadata', 'list-files', 'grant-file-read', 'read-file']) {
    assert.ok(
      settingsModule.includes(`googleRequest('${route}'`) || settingsModule.includes(`googleRequest("${route}"`),
      `missing Google connector operation ${route}`,
    )
  }
  assert.match(settingsModule, /textContent\s*=/, 'Drive read preview must use textContent, not HTML injection')
  assert.equal(/localStorage|sessionStorage/.test(settingsModule), false, 'Google connector state must not persist credentials or authority in browser storage')
})

test('Google Settings module wires every control and Vite loads both bridge and pre-order UI transform', () => {
  assert.match(settingsModule, /document\.getElementById\(id\)/)
  for (const id of [
    'btn-google-connect',
    'btn-google-disconnect',
    'btn-google-grant-metadata',
    'btn-google-list-files',
    'btn-google-grant-file-read',
    'btn-google-read',
  ]) {
    assert.ok(
      settingsModule.includes(`$('${id}')`) || settingsModule.includes(`$("${id}")`),
      `Google Settings module does not wire ${id}`,
    )
  }
  assert.match(settingsModule, /googleRefreshStatus\(\)/)
  assert.match(uiPlugin, /src\/googledrivesettings\.js/)
  assert.match(uiPlugin, /order:\s*['"]pre['"]/)
  assert.match(viteConfig, /googleDriveConnectorBridge/)
  assert.match(viteConfig, /googleDriveSettingsUi/)
})
