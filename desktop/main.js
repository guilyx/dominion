// Electron shell around the bundled game. The page is plain browser code with
// no Node access, so the renderer stays sandboxed: no node integration, context
// isolation on, and navigation to anywhere but the local file is refused.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const GAME = path.join(__dirname, '..', 'dist', 'index.html');

// One instance only: a second launch focuses the window that is already open,
// which also keeps the two from fighting over the same save storage.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0f18',
    title: 'Dominion',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // The game is a single local page; it never needs to reach the filesystem.
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (!fs.existsSync(GAME)) {
    dialog.showErrorBox('Dominion is not built', `Expected the bundled game at:\n${GAME}\n\nRun "npm run build" first, then start again.`);
    app.quit();
    return;
  }
  win.loadFile(GAME);

  // Links to the outside world open in the real browser, never in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Controls (press H in game)', enabled: false },
        { label: 'Project page', click: () => shell.openExternal('https://github.com/guilyx/baw') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
