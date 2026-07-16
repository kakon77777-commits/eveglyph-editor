// ─── CONFIG — the system's explicit contract ──────────────────────
// Every controllable / tunable variable, declared up front with its default.
// The principle (Neo.K): declaring config up front forces answering "what does the
// user get to decide vs not", and a capability like the .eveglyph/ memory injection
// should be a one-line flag, not scattered hardcoded logic.
//
// Tags:  [user]    surfaced (or meant to be) in Settings/UI
//        [flag]    on/off capability toggle
//        [tunable] internal number/threshold
//        [const]   fixed identifier/list (rarely changes)
//        [secret]  sensitive
//        [reserved] declared but not yet wired/exposed — kept at its current value
//
// Defaults here PRESERVE current behavior; introducing this layer is a pure refactor.
// This file is the FRONTEND contract. Server-side constants live in
// vite-agent-bridge.js → BRIDGE_CONFIG (the browser can't reach the Node process).

export const CONFIG = {
  // ── Product identity (single source for the About panel + package metadata) ──
  product: {
    name: 'EveGlyph Editor',                                 // [const] product name
    tagline: 'A local-first, agent-native Markdown workspace', // [const]
    format: 'EveGlyph-MD',                                    // [const] the format/protocol it edits
    version: '0.4.0',                                      // [const] keep in sync with package.json
    egCode: 'EG-MD-2026',                                // [const] EveMissLab protocol/product code
    year: 2026,                                            // [const] copyright year
    license: 'MIT',                                        // [const] see LICENSE
    author: 'Neo.K (許筌崴)',                              // [const]
    company: 'EVEMISS TECHNOLOGY CO., LTD.',               // [const] legal name (EN)
    companyZh: '一言諾科技有限公司',                        // [const] legal name (ZH)
    companyShort: 'EveMissLab',                            // [const] informal brand
    email: 'kakon77777@evemisslab.com',                   // [const] business / licensing contact
    location: 'Taipei City, Taiwan',                       // [const]
  },

  // ── Appearance ──
  theme: 'dark',                                          // [user] app theme: dark | light
  // i18n Phase 1: the setting + <html lang> only. UI strings stay English until
  // the translation-string architecture itself is decided (Neo: "先來一個語言
  // 設置。然後我們來討論如何最好的兼容性") — deliberately not solved here.
  language: 'en',                                         // [user] UI language — see `languages` below
  languages: ['en', 'zh-TW'],                              // [const] supported UI languages so far
  languageLabels: { en: 'English', 'zh-TW': '繁體中文' }, // [const]

  // ── AI provider (persisted, user-facing) ──
  provider: 'anthropic',                                  // [user] anthropic | openai | local-agent
  url: '',                                                // [user] OpenAI-compatible base URL
  key: '',                                                // [secret] API key — localStorage plaintext (see SECURITY.md)
  keyPersist: true,                                       // [user] if false, the key is kept in-memory for this session only, never written to localStorage
  model: 'claude-opus-4-8',                               // [user]
  maxTokens: 4096,                                        // [tunable] Anthropic max_tokens per call
  anthropicVersion: '2023-06-01',                         // [const] anthropic-version header
  anthropicUrl: 'https://api.anthropic.com/v1/messages',  // [const]
  openaiUrlFallback: 'https://api.openai.com',            // [const] used when url is blank
  dangerousDirectBrowserAccess: true,                     // [reserved] Anthropic direct-browser header (see SECURITY.md)

  // ── Local agent (persisted, user-facing) ──
  agent: 'claude',                                        // [user] CLI agent id
  workspace: '',                                          // [user] absolute workspace path
  compilableWorldRuntimeUrl: 'http://127.0.0.1:8765',      // [user] local CompilableWorld Runtime preview endpoint
  agentCmd: '',                                           // [user] command override
  agentMode: 'patch',                                     // [user] suggest | patch | direct (whitepaper §11.2)
  agentPermission: 'standard',                            // [user] cautious | standard | trusted — capability + trust tier
  agentTimeoutMs: 180000,                                 // [user] client-side hard-kill for a run (also sent to the bridge)
  agentQuiet: true,                                       // [user] hide raw agent stdout (show diff/result only)
  reconfirmWorkspaceChange: true,                         // [reserved] folded into agentPermission='trusted' (which skips the re-confirm)

  // ── Memory / context (.eveglyph/) — persisted ──  ← the architect's example
  memory: {
    enabled: true,                                        // [flag] master switch for .eveglyph/ context injection
    rules: true,                                          // [flag] inject rules.md
    glossary: true,                                       // [flag] inject glossary.md
    pitfalls: true,                                       // [flag] inject memory/pitfalls.md
    recent: true,                                         // [flag] inject memory/recent.md
  },
  contextPackWrite: true,                                 // [flag] write .eveglyph/context-pack.json (debug artifact)
  relatedFilesMax: 50,                                    // [tunable] cap for context-pack related_files

  // ── EveGlyph-MD frontmatter schema (v0.1) — persisted ──
  // The minimal semantic-classification layer: a document is a typed, status-tracked
  // knowledge unit (whitepaper §4.5 / supplement memo §4.3). Defined NOW (v0.3, not
  // v1.0) so the frontmatter habit forms early — backfilling metadata into a corpus
  // later is expensive — and so the context compiler has a basic document class to
  // hand the agent. `types`/`statuses` are protocol constants (read from CONFIG, never
  // persisted, so the enum can't go stale in someone's localStorage); the rest are
  // user-tunable flags/defaults.
  eveglyphMd: {
    enabled: true,                                        // [flag] schema awareness (chip + preview badges + context)
    types:    ['article', 'note', 'theorem', 'whitepaper', 'draft'], // [const] allowed `type`
    statuses: ['draft', 'review', 'final'],               // [const] allowed `status`
    defaultType: 'note',                                  // [user] type stamped on new .md files
    defaultStatus: 'draft',                               // [user] status stamped on new .md files
    stampNewFiles: true,                                  // [flag] auto-insert frontmatter on New File
    injectIntoContext: true,                              // [flag] include the active doc's class in the agent context
  },

  // ── Editor ──
  editor: {
    fontFamily: "'JetBrains Mono', monospace",            // [user] default seed; live override persists as cfg.editorFontFamily
    fontSize: 13.5,                                       // [user] px — default seed; live override persists as cfg.editorFontSize
    lineHeight: 1.65,                                     // [reserved]
    previewDebounceMs: 600,                               // [tunable] preview re-render delay after a keystroke
  },

  // ── Search ──
  search: {
    matchCapPerFile: 2000,                                // [tunable] stop after N matches/file (anti-freeze)
    snippetMaxChars: 240,                                 // [tunable] result snippet truncation
  },

  // ── AI semantic search (whitepaper §12.2) ──
  // A second, clearly-separate search mode from the exact/regex one above (§5.2/
  // §12.1's "human-owned navigator, NOT AI") — natural-language queries answered by
  // the already-configured cloud provider (Anthropic/OpenAI), not a dedicated
  // embeddings index. One-shot: the corpus is sent as plain context in the prompt,
  // so it's bounded by maxContextChars, not indexed/cached.
  aiSearch: {
    maxContextChars: 60000,                               // [tunable] corpus cap sent in one request (~15k tokens, comfortable for both providers)
    snippetMaxChars: 200,                                 // [tunable] result snippet truncation
  },

  // ── Monitor viewer (reads back the PHOSPHOR diagnostic stream) ──
  monitorView: {
    enabled: true,                                        // [flag] show the Log panel tab
    limit: 200,                                           // [tunable] events fetched per refresh (bridge caps at monitorViewMax)
    autoRefreshMs: 2500,                                  // [tunable] poll interval while Auto is on + the tab is open
  },

  // ── Encoding ──
  defaultEncoding: 'UTF-8',                               // [user] new-file + uncertain-detection fallback
  encodings: ['UTF-8', 'UTF-16LE', 'Big5', 'GBK', 'GB18030', 'Shift_JIS', 'EUC-JP', 'EUC-KR', 'windows-1252'], // [const]

  // ── Workspace files (.eveglyph/) ──
  eveglyphDir: '.eveglyph',                                   // [const] per-workspace agent-config dir
  eveglyphFiles: ['rules.md', 'glossary.md', 'memory/recent.md', 'memory/pitfalls.md'], // [const] surfaced in tree

  // ── Storage ──
  storageKey: 'eveglyph_cfg',                               // [const] localStorage key
  legacyStorageKey: 'noesis_cfg',                         // [const] one-time migration source (Noesis era)
}
