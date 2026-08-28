import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function readOrEmpty(url) {
  try { return await readFile(url, 'utf8') }
  catch { return '' }
}

const uiPlugin = await readOrEmpty(new URL('../vite-github-settings-ui.js', import.meta.url))
const githubSettings = await readOrEmpty(new URL('../src/githubsettings.js', import.meta.url))
const viteConfig = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8')
const settingsSurface = `${uiPlugin}\n${githubSettings}`

const REQUIRED_IDS = [
  's-github-status',
  'btn-github-connect',
  'btn-github-disconnect',
  's-github-repository',
  'btn-github-grant-read',
  's-github-path',
  's-github-ref',
  'btn-github-read',
  's-github-read-result',
]

const REQUIRED_EXPORTS = [
  'githubRefreshStatus',
  'githubConnect',
  'githubDisconnect',
  'githubGrantRead',
  'githubReadFile',
]

test('Settings exposes GitHub identity, explicit repository read grant, and read-only file controls', () => {
  assert.match(settingsSurface, /GitHub Connector/)
  assert.match(settingsSurface, /OAuth connects identity only/i)
  assert.match(settingsSurface, /Grant read for this session/i)
  for (const id of REQUIRED_IDS) {
    assert.match(settingsSurface, new RegExp(`id=[\\"']${id}[\\"']`), `missing Settings control ${id}`)
  }
  assert.match(settingsSurface, /<(pre|textarea)[^>]+id=[\\"']s-github-read-result[\\"']/i)
})

test('GitHub Settings surface contains no access-token or client-secret input', () => {
  const inputs = [...settingsSurface.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
  const dangerous = inputs.filter(input => /github[^>]*(access[-_ ]?token|client[-_ ]?secret)|(access[-_ ]?token|client[-_ ]?secret)[^>]*github/i.test(input))
  assert.deepEqual(dangerous, [])
  assert.equal(/id=[\\"'][^\\"']*github[^\\"']*(token|secret)[^\\"']*[\\"']/i.test(settingsSurface), false)
})

test('GitHub Settings module exports and implements the five connector actions', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.match(githubSettings, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`), `missing export ${name}`)
  }
  assert.match(githubSettings, /\/api\/connectors\/github\/status/)
  assert.match(githubSettings, /\/api\/connectors\/github\/auth\/start/)
  assert.match(githubSettings, /\/api\/connectors\/github\/grant-read/)
  assert.match(githubSettings, /\/api\/connectors\/github\/read-file/)
  assert.match(githubSettings, /textContent\s*=/, 'file preview must use textContent, not HTML injection')
})

test('GitHub Settings module wires every connector control and is loaded by Vite', () => {
  for (const id of ['btn-github-connect', 'btn-github-disconnect', 'btn-github-grant-read', 'btn-github-read']) {
    assert.match(githubSettings, new RegExp(`getElementById\\(['"]${id}['"]\\)`), `GitHub Settings module does not wire ${id}`)
  }
  assert.match(githubSettings, /githubRefreshStatus\(\)/)
  assert.match(uiPlugin, /src\/githubsettings\.js/)
  assert.match(viteConfig, /githubSettingsUi/)
})
