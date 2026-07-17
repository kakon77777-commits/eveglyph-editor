import { CONFIG } from './config.js'

export const S = {
  dirHandle: null,
  workspaceMode: '',
  workspaceRoot: '',
  files: new Map(),
  active: null,
  editor: null,
  tabs: [],
  lastResp: null,
  // Defaults sourced from the config contract (config.js); cfgLoad merges the user's
  // localStorage overrides on top (the whole cfg object is persisted as one blob).
  cfg: {
    sidebarWidth: CONFIG.layout.sidebarWidth,
    rightPanelWidth: CONFIG.layout.rightPanelWidth,
    theme: CONFIG.theme,
    language: CONFIG.language,
    editorFontSize: CONFIG.editor.fontSize,
    editorFontFamily: CONFIG.editor.fontFamily,
    provider: CONFIG.provider,
    url: CONFIG.url,
    key: CONFIG.key,
    keyPersist: CONFIG.keyPersist,
    model: CONFIG.model,
    agent: CONFIG.agent,
    workspace: CONFIG.workspace,
    compilableWorldRuntimeUrl: CONFIG.compilableWorldRuntimeUrl,
    agentCmd: CONFIG.agentCmd,
    defaultEncoding: CONFIG.defaultEncoding,
    agentMode: CONFIG.agentMode,
    agentPermission: CONFIG.agentPermission,
    agentTimeoutMs: CONFIG.agentTimeoutMs,
    agentQuiet: CONFIG.agentQuiet,
    memory: { ...CONFIG.memory },
    contextPackWrite: CONFIG.contextPackWrite,
    // Only the user-tunable subset of the schema persists; the enum lists (types /
    // statuses) stay in CONFIG so they can't go stale in someone's localStorage.
    eveglyphMd: {
      enabled: CONFIG.eveglyphMd.enabled,
      defaultType: CONFIG.eveglyphMd.defaultType,
      defaultStatus: CONFIG.eveglyphMd.defaultStatus,
      stampNewFiles: CONFIG.eveglyphMd.stampNewFiles,
      injectIntoContext: CONFIG.eveglyphMd.injectIntoContext
    }
  },
  agentBridge: null,
  agentConnected: false,
  agentRunning: false,
  agentAbort: null
}

// Re-exported from the config contract so existing imports keep working unchanged.
export const CFG_KEY      = CONFIG.storageKey
export const EVEGLYPH_DIR   = CONFIG.eveglyphDir
export const EVEGLYPH_FILES = CONFIG.eveglyphFiles
