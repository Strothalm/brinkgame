// Electron main process: window, permissions, local storage files and the anti-cheat monitor.
const { app, BrowserWindow, ipcMain, session, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const anticheat = require('./anticheat.cjs');

const isDev = !app.isPackaged;
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

// Camera and microphone are needed without a user gesture after a reconnect.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyFile(key) {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) throw new Error('bad key');
  return path.join(dataDir(), `${key}.json`);
}

function start() {
  const allowed = new Set(['media', 'mediaKeySystem', 'speaker-selection', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#05060b',
    autoHideMenuBar: true,
    title: 'Brinkgame',
    icon: path.join(__dirname, '../../dist/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
      backgroundThrottling: false, // keep voice and timers alive when the window is in the background
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '../../dist/index.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // The app never navigates away and never opens other pages inside itself.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (isDev && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });
  win.on('focus', () => anticheat.poke());
  win.on('blur', () => anticheat.poke());
  win.on('closed', () => {
    anticheat.stop();
    win = null;
  });
}

ipcMain.handle('store:get', (e, key) => {
  try {
    return JSON.parse(fs.readFileSync(keyFile(key), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:set', (e, key, value) => {
  const file = keyFile(key);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
  return true;
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dev: isDev }));
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));

ipcMain.on('ac:start', () => {
  if (!win) return;
  anticheat.start({
    window: win,
    displays: () => screen.getAllDisplays().length,
    send: (data) => win && !win.isDestroyed() && win.webContents.send('ac:data', data),
  });
});
ipcMain.on('ac:stop', () => anticheat.stop());

app.on('window-all-closed', () => app.quit());
