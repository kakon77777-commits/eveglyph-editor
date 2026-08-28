const GOOGLE_DRIVE_SETTINGS_HTML = `
            <!-- Google Drive Connector — provider identity and EveGlyph grants stay separate. -->
            <div id="s-google-wrap" style="display:flex; flex-direction:column; gap:12px">
              <div class="sg">
                <label>Google Drive Connector</label>
                <span id="s-google-status" style="font-size:11px;color:var(--t3)">Checking…</span>
                <div class="agent-row" style="margin-top:6px">
                  <button class="btn-p" id="btn-google-connect">Connect Google</button>
                  <button class="btn-s" id="btn-google-disconnect" disabled>Disconnect</button>
                </div>
                <span style="font-size:10px;color:var(--t3)">OAuth connects identity only. EveGlyph grants Drive metadata and file access separately for this session.</span>
              </div>

              <div class="sg">
                <label>Drive metadata</label>
                <div class="agent-row">
                  <button class="btn-s" id="btn-google-grant-metadata" disabled>Grant metadata browse for this session</button>
                  <button class="btn-s" id="btn-google-list-files" disabled>List Drive files</button>
                </div>
              </div>

              <div class="sg">
                <label>Selected Drive file</label>
                <select id="s-google-file-select" disabled>
                  <option value="">List Drive files first</option>
                </select>
                <div class="agent-row" style="margin-top:6px">
                  <button class="btn-s" id="btn-google-grant-file-read" disabled>Grant read for selected file</button>
                  <button class="btn-s" id="btn-google-read" disabled>Read selected file</button>
                </div>
                <pre id="s-google-read-result" style="margin-top:6px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--t2)"></pre>
              </div>
            </div>
`

const MODULE_SCRIPT = '<script type="module" src="/src/googledrivesettings.js"></script>'
const MCP_SETTINGS_ANCHOR = '<div id="s-mcp-wrap"'

function transformGoogleDriveSettingsHtml(html) {
  if (!html.includes(MCP_SETTINGS_ANCHOR)) {
    throw new Error('Google Drive Settings insertion point not found')
  }
  let next = html.replace(MCP_SETTINGS_ANCHOR, `${GOOGLE_DRIVE_SETTINGS_HTML}\n            ${MCP_SETTINGS_ANCHOR}`)
  if (!next.includes('/src/googledrivesettings.js')) {
    if (!next.includes('</body>')) throw new Error('Google Drive Settings module insertion point not found')
    next = next.replace('</body>', `${MODULE_SCRIPT}\n</body>`)
  }
  return next
}

export function googleDriveSettingsUi() {
  return {
    name: 'eveglyph-google-drive-settings-ui',
    // Run before Vite's core HTML processing so the injected module is bundled
    // into a hashed production asset instead of surviving as a raw /src path.
    transformIndexHtml: {
      order: 'pre',
      handler: transformGoogleDriveSettingsHtml,
    },
  }
}

export { GOOGLE_DRIVE_SETTINGS_HTML, transformGoogleDriveSettingsHtml }
