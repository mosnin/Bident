// Bident for macOS: an Electron shell around the same local Vite server the
// browser and Pinokio launches use (see scripts/pinokio-start.mjs). The server
// runs in this main process, the window loads it over loopback, and everything
// the server writes (.env keys, caches, logs, Vite's dependency cache) lives in
// the per-user data directory instead of the read-only app bundle.
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
// localStorage (panel layout, saved scenes, voice settings) is keyed by
// origin, so the app keeps one port across launches whenever it is free.
const PREFERRED_PORT = 47821;
const SMOKE_TEST = process.argv.includes('--smoke-test');
const SMOKE_TIMEOUT_MS = 120_000;

app.setName('Bident');
const DATA_DIR = app.getPath('userData');

let server = null;
let appUrl = null;
let mainWindow = null;
let quitting = false;

function log(message) {
  console.log(`[Bident] ${message}`);
}

/** Resolve to `preferred` when it is free on loopback, else any free port. */
function choosePort(preferred) {
  const probe = (port) =>
    new Promise((resolve, reject) => {
      const socket = net.createServer();
      socket.unref();
      socket.once('error', reject);
      socket.listen({ host: HOST, port }, () => {
        const { port: bound } = socket.address();
        socket.close(() => resolve(bound));
      });
    });
  return probe(preferred).catch(() => probe(0));
}

async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Finder launches start in `/`. Run from the app root like every other
  // launch (vite-plugin-cesium resolves node_modules from the working
  // directory); provider caches follow GEV_DATA_DIR instead.
  process.chdir(ROOT);
  const port = await choosePort(PREFERRED_PORT);
  // Set before Vite loads the config: Provider Settings captures the launcher
  // and data directory at module load to decide where saved keys go.
  Object.assign(process.env, {
    GEV_LAUNCHER: 'desktop',
    GEV_DATA_DIR: DATA_DIR,
    HOST,
    PORT: String(port),
  });

  const { createServer } = await import('vite');
  server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    // Import the config as plain ESM; the default loader bundles it into
    // node_modules/.vite-temp, which would write inside the app bundle.
    configLoader: 'native',
    cacheDir: path.join(DATA_DIR, 'vite-cache'),
    clearScreen: false,
    server: { host: HOST, port, strictPort: true, open: false },
  });
  await server.listen();
  appUrl = `http://${HOST}:${port}/`;
  log(`Server ready at ${appUrl} (data: ${DATA_DIR})`);
}

function isAppUrl(url) {
  return Boolean(appUrl) && url.startsWith(appUrl);
}

function lockDownSession() {
  const allowed = new Set([
    'media',
    'geolocation',
    'fullscreen',
    'clipboard-sanitized-write',
    'notifications',
  ]);
  const fromApp = (webContents, origin) =>
    isAppUrl(origin || webContents?.getURL() || '');
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        allowed.has(permission) && fromApp(webContents, details?.requestingUrl),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, origin) =>
      allowed.has(permission) && fromApp(webContents, origin),
  );
}

const STATE_FILE = () => path.join(DATA_DIR, 'window-state.json');

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    return Number.isFinite(state.width) && Number.isFinite(state.height)
      ? state
      : {};
  } catch {
    return {};
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(
      STATE_FILE(),
      JSON.stringify({ ...bounds, maximized: win.isMaximized() }),
    );
  } catch {
    // Window placement is a convenience; never block closing on it.
  }
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>Bident</title><style>
html,body{margin:0;height:100%;background:#05090f;color:#9fd8e6;
font:500 13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.2em}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
h1{margin:0;font-size:28px;letter-spacing:.45em;color:#00f6ff}
p{margin:0;opacity:.7}
</style></head><body><h1>BIDENT</h1><p>STARTING LOCAL SERVER…</p></body></html>`)}`;

function createWindow() {
  const state = readWindowState();
  const win = new BrowserWindow({
    title: 'Bident',
    width: state.width || 1440,
    height: state.height || 900,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#05090f',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show();
  });
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Links to anything but the local app open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || url.startsWith('data:')) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.loadURL(appUrl || SPLASH);
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(DATA_DIR),
        },
        {
          label: 'Bident on GitHub',
          click: () => shell.openExternal('https://github.com/mosnin/Bident'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Load the app headlessly, wait for the globe canvas, then exit 0 or 1. */
async function runSmokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  let rendered = false;
  while (Date.now() < deadline) {
    rendered = await win.webContents
      .executeJavaScript(
        "document.readyState === 'complete' && !!document.querySelector('canvas')",
      )
      .catch(() => false);
    if (rendered) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const title = await win.webContents
    .executeJavaScript('document.title')
    .catch(() => '');
  const screenshot = process.env.BIDENT_SMOKE_SCREENSHOT;
  if (screenshot) {
    // Give the globe a moment to draw its first tiles.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshot, image.toPNG());
    log(`Screenshot saved to ${screenshot}`);
  }
  for (const message of errors.slice(0, 20)) log(`renderer error: ${message}`);
  log(
    `Smoke test ${rendered ? 'passed' : 'FAILED'}: title="${title}" url=${win.webContents.getURL()}`,
  );
  await exitWith(rendered ? 0 : 1);
}

async function stopServer() {
  const running = server;
  server = null;
  if (!running) return;
  // Never let a slow watcher teardown hold the app open on quit.
  await Promise.race([
    running.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

/**
 * Exit with `code` once the server is closed. On macOS a live Vite file
 * watcher can keep the process alive after app.exit(), so a short fallback
 * forces the exit.
 */
async function exitWith(code) {
  await stopServer();
  setTimeout(() => process.exit(code), 2000);
  app.exit(code);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    mainWindow = createWindow();
    try {
      await startServer();
    } catch (error) {
      console.error(error);
      if (SMOKE_TEST) app.exit(1);
      dialog.showErrorBox(
        'Bident could not start',
        `The local server failed to start:\n\n${error?.message || error}`,
      );
      app.exit(1);
      return;
    }
    lockDownSession();
    await mainWindow.loadURL(appUrl);
    if (SMOKE_TEST) runSmokeTest(mainWindow);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
      mainWindow = createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    quitting = true;
    event.preventDefault();
    stopServer().finally(() => app.quit());
  });
}
