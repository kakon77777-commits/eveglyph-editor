import { defineConfig } from 'vite'
import { agentBridge } from './vite-agent-bridge.js'
import { githubConnectorBridge } from './vite-github-connector.js'
import { githubSettingsUi } from './vite-github-settings-ui.js'

// EveGlyph Editor — Vite config
// Dev server auto-opens the browser so the .bat launcher is one double-click.
export default defineConfig({
  root: '.',
  plugins: [agentBridge(), githubConnectorBridge(), githubSettingsUi()],
  server: {
    open: true,
    port: 5173
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
})
