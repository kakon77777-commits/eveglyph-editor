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

export function githubSettingsUi() {
  return {
    name: 'eveglyph-github-settings-ui',
    transformIndexHtml(html) {
      const mcpMarker = '            <!-- MCP server — separate from AI Provider above; this is how an EXTERNAL'
      if (!html.includes(mcpMarker)) {
        throw new Error('GitHub Settings insertion point not found')
      }
      let next = html.replace(mcpMarker, `${GITHUB_SETTINGS_HTML}\n${mcpMarker}`)
      if (!next.includes('/src/githubsettings.js')) {
        next = next.replace('</body>', `${MODULE_SCRIPT}\n</body>`)
      }
      return next
    },
  }
}

export { GITHUB_SETTINGS_HTML }
