import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const distRoot = path.resolve('dist')
const html = await readFile(path.join(distRoot, 'index.html'), 'utf8')

assert.match(html, /id=["']s-github-wrap["']/, 'built Settings HTML must contain the GitHub Connector block')
assert.equal(
  html.includes('/src/githubsettings.js'),
  false,
  'built index.html must not retain the source-module path /src/githubsettings.js',
)

const assetsDir = path.join(distRoot, 'assets')
const assetNames = await readdir(assetsDir)
const jsAssets = assetNames.filter(name => name.endsWith('.js'))
assert.ok(jsAssets.length > 0, 'build must produce JavaScript assets')

let connectorClientBundled = false
for (const name of jsAssets) {
  const source = await readFile(path.join(assetsDir, name), 'utf8')
  if (source.includes('/api/connectors/github/')) {
    connectorClientBundled = true
    break
  }
}

assert.equal(
  connectorClientBundled,
  true,
  'a built JavaScript asset must contain the GitHub connector client route prefix',
)

console.log(`GitHub connector build verification PASS (${jsAssets.length} JS assets checked)`)
