import { spawnSync } from 'node:child_process'
import path from 'node:path'

const fixture = name => path.resolve('.tmp/wasmtime-fixtures', `${name}.wasm`)

function run(label, args) {
  const result = spawnSync('wasmtime', args, {
    shell: false,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 256 * 1024,
  })
  console.log(`=== ${label} ===`)
  console.log(`status=${String(result.status)} signal=${String(result.signal)}`)
  console.log('stdout:')
  console.log(String(result.stdout || '').slice(0, 8000))
  console.log('stderr:')
  console.log(String(result.stderr || '').slice(0, 8000))
  if (result.error) console.log(`spawn_error=${result.error.code || result.error.message}`)
}

const common = [
  '-W', 'max-memory-size=33554432',
  '-W', 'max-wasm-stack=1048576',
  '-W', 'max-instances=1',
  '-W', 'max-memories=1',
  '-W', 'max-tables=1',
]

run('fuel-exhaustion', [
  'run', '-W', 'fuel=1000', ...common, '-W', 'timeout=10000ms', fixture('infinite-loop'),
])

run('memory-grow-default', [
  'run', '-W', 'fuel=10000000', ...common, '-W', 'timeout=2000ms', fixture('memory-grow'),
])

run('memory-grow-trap', [
  'run', '-W', 'fuel=10000000', ...common,
  '-W', 'trap-on-grow-failure=y',
  '-W', 'timeout=2000ms', fixture('memory-grow'),
])
