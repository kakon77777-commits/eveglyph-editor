import { defineConfig } from 'vite'
import { agentBridge } from './vite-agent-bridge.js'

// EveGlyph Editor — Vite config
// Dev server auto-opens the browser so the .bat launcher is one double-click.
export default defineConfig({
  root: '.',
  plugins: [agentBridge()],
  server: {
    open: true,
    port: 5173
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
})
