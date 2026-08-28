import { defineConfig } from 'vite'
import { agentBridge } from './vite-agent-bridge.js'
import { githubConnectorBridge } from './vite-github-connector.js'
import { googleDriveConnectorBridge } from './vite-google-drive-connector.js'
import { googleDriveSettingsUi } from './vite-google-drive-settings-ui.js'
import { githubSettingsUi } from './vite-github-settings-ui.js'

// EveGlyph Editor — Vite config
// Dev server auto-opens the browser so the .bat launcher is one double-click.
export default defineConfig({
  root: '.',
  plugins: [
    agentBridge(),
    githubConnectorBridge(),
    googleDriveConnectorBridge(),
    googleDriveSettingsUi(),
    githubSettingsUi(),
  ],
  server: {
    open: true,
    port: 5173
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
})
