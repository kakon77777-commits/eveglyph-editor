const GITHUB_SETTINGS_HTML = `
            <!-- GitHub Connector — identity and capability grants are separate. -->
            <div id="s-github-wrap" style="display:flex; flex-direction:column; gap:12px">
              <div class="sg">
                <label>GitHub Connector</label>
                <span id="s-github-status" style="font-size:11px;color:var(--t3)">Checking…</span>
                <div class="agent-row" style="margin-top:6px">
                  <button class="btn-p" id="btn-github-connect">Connect GitHub</button>
                  <button class="btn-s" id="btn-github-disconnect" disabled>Disconnect</button>
                </div>
                <span style="font-size:10px;color:var(--t3)">OAuth connects identity only. Repository access still requires an explicit read grant for this session.</span>
              </div>

              <div class="sg">
                <label>Repository <span style="color:var(--t3)">(owner/repo)</span></label>
                <div class="agent-row">
                  <input type="text" id="s-github-repository" placeholder="owner/repository" autocomplete="off">
                  <button class="btn-s" id="btn-github-grant-read" disabled>Grant read for this session</button>
                </div>
              </div>

              <div class="sg">
                <label>Read repository file</label>
                <input type="text" id="s-github-path" placeholder="README.md" autocomplete="off">
                <input type="text" id="s-github-ref" placeholder="main (optional)" autocomplete="off" style="margin-top:6px">
                <button class="btn-s" id="btn-github-read" disabled style="margin-top:6px">Read file</button>
                <pre id="s-github-read-result" style="margin-top:6px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--t2)"></pre>
              </div>
            </div>
`

const MODULE_SCRIPT = '<script type="module" src="/src/githubsettings.js"></script>'
const MCP_SETTINGS_ANCHOR = '<div id="s-mcp-wrap"'

function transformSettingsHtml(html) {
  // Anchor to a semantic element id, not a comment. Vite (and other HTML
  // transforms) may remove or rewrite comments, while the Settings container
  // id is a runtime contract that must survive.
  if (!html.includes(MCP_SETTINGS_ANCHOR)) {
    throw new Error('GitHub Settings insertion point not found')
  }
  let next = html.replace(MCP_SETTINGS_ANCHOR, `${GITHUB_SETTINGS_HTML}\n            ${MCP_SETTINGS_ANCHOR}`)
  if (!next.includes('/src/githubsettings.js')) {
    if (!next.includes('</body>')) throw new Error('GitHub Settings module insertion point not found')
    next = next.replace('</body>', `${MODULE_SCRIPT}\n</body>`)
  }
  return next
}

export function githubSettingsUi() {
  return {
    name: 'eveglyph-github-settings-ui',
    // This must run before Vite's core HTML pipeline. Otherwise the injected
    // source-module script survives into dist/index.html as /src/... instead of
    // being discovered, bundled and rewritten to a hashed build asset.
    transformIndexHtml: {
      order: 'pre',
      handler: transformSettingsHtml,
    },
  }
}

export { GITHUB_SETTINGS_HTML, transformSettingsHtml }
