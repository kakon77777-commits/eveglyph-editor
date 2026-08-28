import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const settings = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8')
const settingsSurface = `${html}\n${settings}`

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

test('settings module exports the five GitHub connector actions', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.match(settings, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`), `missing export ${name}`)
  }
  assert.match(settings, /\/api\/connectors\/github\/status/)
  assert.match(settings, /\/api\/connectors\/github\/auth\/start/)
  assert.match(settings, /\/api\/connectors\/github\/grant-read/)
  assert.match(settings, /\/api\/connectors\/github\/read-file/)
  assert.match(settings, /textContent\s*=/, 'file preview must use textContent, not HTML injection')
})

test('main module imports and wires every GitHub Settings control', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.match(main, new RegExp(`\\b${name}\\b`), `main.js does not reference ${name}`)
  }
  for (const id of ['btn-github-connect', 'btn-github-disconnect', 'btn-github-grant-read', 'btn-github-read']) {
    assert.match(main, new RegExp(`getElementById\\(['"]${id}['"]\\)`), `main.js does not wire ${id}`)
  }
  assert.match(main, /githubRefreshStatus\(\)/)
})
