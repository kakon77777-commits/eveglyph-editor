import { defineConfig } from 'vite'
import { Entry } from '@napi-rs/keyring'
import { agentBridge } from './vite-agent-bridge.js'
import { githubConnectorBridge } from './vite-github-connector.js'
import { googleDriveConnectorBridge } from './vite-google-drive-connector.js'
import { googleDriveSettingsUi } from './vite-google-drive-settings-ui.js'
import { githubSettingsUi } from './vite-github-settings-ui.js'
import { createCredentialRuntime } from './server/credentials/runtime.js'

// One provider-neutral credential runtime is shared by external-service
// connectors. The default storage mode is the OS-backed system keyring;
// EVEGLYPH_CREDENTIAL_STORE=memory is an explicit non-persistent fallback.
const credentialRuntime = createCredentialRuntime({ EntryClass: Entry })

// EveGlyph Editor — Vite config
// Dev server auto-opens the browser so the .bat launcher is one double-click.
export default defineConfig({
  root: '.',
  plugins: [
    agentBridge(),
    githubConnectorBridge({ broker: credentialRuntime.broker }),
    googleDriveConnectorBridge({ broker: credentialRuntime.broker }),
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
