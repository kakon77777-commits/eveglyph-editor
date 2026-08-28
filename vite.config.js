import { defineConfig } from 'vite'
import { Entry } from '@napi-rs/keyring'
import { agentBridge } from './vite-agent-bridge.js'
import { githubConnectorBridge } from './vite-github-connector.js'
import { googleDriveConnectorBridge } from './vite-google-drive-connector.js'
import { googleDriveSettingsUi } from './vite-google-drive-settings-ui.js'
import { githubSettingsUi } from './vite-github-settings-ui.js'
import { createCredentialRuntime } from './server/credentials/runtime.js'
import { createConnectorDelegationRuntime } from './server/connectors/delegation-runtime.js'

const credentialRuntime = createCredentialRuntime({ EntryClass: Entry })
const delegationRuntime = createConnectorDelegationRuntime()

export default defineConfig({
  root: '.',
  plugins: [
    delegationRuntime.vitePlugin(),
    agentBridge({ delegationEndpoint: delegationRuntime.endpoint }),
    githubConnectorBridge({ broker: credentialRuntime.broker, delegationRuntime }),
    googleDriveConnectorBridge({ broker: credentialRuntime.broker, delegationRuntime }),
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
