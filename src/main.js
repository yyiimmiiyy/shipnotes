'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createGitHub, parseRepo } = require('./core/github');
const { createClaude, MODELS } = require('./core/claude');
const { writeNotes } = require('./core/notes');
const { createSettings } = require('./core/settings');

let settings;
let win;

function clients() {
  const s = settings.secrets();
  if (!s.githubToken) throw new Error('Add your GitHub access token in Settings first.');
  return { github: createGitHub({ token: s.githubToken }), makeClaude: () => createClaude({ apiKey: s.anthropicKey, model: s.model }) };
}

// Errors cross the IPC boundary as plain data so the window can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function registerHandlers() {
  handle('settings:get', () => ({ ...settings.publicView(), models: MODELS }));
  handle('settings:save', (p) => { settings.save(p); return settings.publicView(); });

  handle('repo:load', async ({ repo }) => {
    const r = parseRepo(repo);
    const refs = await clients().github.listRefs(r.owner, r.repo);
    settings.save({ lastRepo: `${r.owner}/${r.repo}` });
    return { repo: `${r.owner}/${r.repo}`, ...refs };
  });

  handle('notes:write', async ({ repo, base, head, version, audience, emphasis }) => {
    const r = parseRepo(repo);
    const { github, makeClaude } = clients();
    return writeNotes({ github, claude: makeClaude(), owner: r.owner, repo: r.repo, base: String(base || '').trim(), head: String(head || '').trim(), version: String(version || '').trim(), audience, emphasis });
  });

  handle('notes:save', async ({ markdown, version }) => {
    const res = await dialog.showSaveDialog(win, { title: 'Save release notes', defaultPath: `release-notes${version ? `-${String(version).replace(/[^\w.-]/g, '_')}` : ''}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (res.canceled || !res.filePath) return { saved: false };
    fs.writeFileSync(res.filePath, String(markdown));
    return { saved: true, path: res.filePath };
  });

  handle('notes:copy', ({ markdown }) => { clipboard.writeText(String(markdown)); return true; });

  handle('release:draft', async ({ repo, tag, markdown, target }) => {
    const r = parseRepo(repo);
    const t = String(tag || '').trim();
    if (!t || /\s/.test(t)) throw new Error('Enter a version tag without spaces, for example v1.2.0.');
    // The notes start with the version as a heading; GitHub shows the release title itself.
    const body = String(markdown).replace(/^# .*\n+/, '');
    return clients().github.createDraftRelease(r.owner, r.repo, { tag: t, name: t, body, target: String(target || '').trim() });
  });

  handle('open:external', ({ url }) => {
    const u = new URL(url);
    const allowed = ['github.com', 'console.anthropic.com', 'platform.claude.com'];
    if (u.protocol !== 'https:' || !allowed.includes(u.hostname)) throw new Error('That link is not allowed.');
    return shell.openExternal(u.toString());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    title: 'Shipnotes',
    backgroundColor: '#f6f4ef',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // The window only ever shows our own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  settings = createSettings({ dir: app.getPath('userData'), crypto: safeStorage });
  Menu.setApplicationMenu(null);
  registerHandlers();
  createWindow();
  if (process.env.SHIPNOTES_SMOKE) {
    win.webContents.once('did-finish-load', () => { console.log('SHIPNOTES_SMOKE_OK'); app.quit(); });
  }
});

app.on('window-all-closed', () => app.quit());
