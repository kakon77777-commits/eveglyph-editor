import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const sourceDir = path.resolve('test/fixtures/wasmtime')
const outputDir = path.resolve('.tmp/wasmtime-fixtures')

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

const files = (await readdir(sourceDir)).filter(name => name.endsWith('.wat')).sort()
if (!files.length) throw new Error('no Wasmtime WAT fixtures found')

for (const name of files) {
  const input = path.join(sourceDir, name)
  const output = path.join(outputDir, name.replace(/\.wat$/i, '.wasm'))
  const result = spawnSync('wasm-tools', ['parse', input, '-o', output], {
    shell: false,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`wasm-tools parse failed for ${name} with status ${result.status}`)
}

console.log(`Compiled ${files.length} Wasmtime fixtures into ${outputDir}`)
