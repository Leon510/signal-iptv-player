const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { loadEpg } = require('./epg.js');
const { normChannelName } = require('./renderer/m3u.js');

const DATA_DIR = () => app.getPath('userData');
const STORE_FILE = () => path.join(DATA_DIR(), 'store.json');
const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';

let win;
let userAgent = DEFAULT_UA;

// Tonspur-Auswahl für MP4/MKV (video.audioTracks) freischalten
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function createWindow() {
  const isWin = process.platform === 'win32';
  win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0F1724',
    title: 'Signal',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? { color: '#0F1724', symbolColor: '#8C99B0', height: 44 } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Wiedergabe nicht drosseln, wenn das Fenster im Hintergrund ist
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));

  // Links aus der App im Standardbrowser öffnen, nicht in einem neuen Electron-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function setupNetwork() {
  const ses = session.defaultSession;
  // Viele IPTV-Server liefern keine CORS-Header. Für Streams und Logos ergänzen wir sie,
  // damit hls.js und mpegts.js die Daten im Renderer lesen dürfen.
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const headers = details.requestHeaders;
    headers['User-Agent'] = userAgent;
    delete headers['Origin'];
    cb({ requestHeaders: headers });
  });
  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('access-control-')) delete headers[key];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Expose-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });
}

// ---------- IPC ----------
ipcMain.handle('store:load', () => readJSON(STORE_FILE(), null));
ipcMain.handle('store:save', (_e, data) => { writeJSON(STORE_FILE(), data); return true; });

ipcMain.handle('channels:load', (_e, id) =>
  readJSON(path.join(DATA_DIR(), 'playlists', `${id}.json`), null));
ipcMain.handle('channels:save', (_e, id, data) => {
  writeJSON(path.join(DATA_DIR(), 'playlists', `${id}.json`), data);
  return true;
});
ipcMain.handle('channels:delete', (_e, id) => {
  try { fs.unlinkSync(path.join(DATA_DIR(), 'playlists', `${id}.json`)); } catch {}
  return true;
});

ipcMain.handle('playlist:fetch', async (_e, url) => {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Server antwortet mit ${res.status} ${res.statusText}`);
  return await res.text();
});

ipcMain.handle('playlist:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Playlist öffnen',
    properties: ['openFile'],
    filters: [{ name: 'M3U-Playlist', extensions: ['m3u', 'm3u8', 'txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  return { path: file, name: path.basename(file).replace(/\.(m3u8?|txt)$/i, ''), text: fs.readFileSync(file, 'utf8') };
});

ipcMain.handle('playlist:readFile', (_e, file) => fs.readFileSync(file, 'utf8'));

// ---------- Programmführer (EPG) ----------
const EPG_FILE = (id) => path.join(DATA_DIR(), 'epg', `${id}.json`);
const epgRunning = new Map();

ipcMain.handle('epg:load', (_e, id) => readJSON(EPG_FILE(id), null));

// Lädt das XMLTV, filtert auf die Sender der Playlist und speichert das Ergebnis.
// Läuft schon ein Abruf für diese Playlist, wird auf ihn gewartet statt doppelt zu laden.
ipcMain.handle('epg:update', (_e, id, url, want) => {
  if (epgRunning.has(id)) return epgRunning.get(id);
  const job = (async () => {
    const now = Date.now();
    const data = await loadEpg(url, {
      userAgent,
      from: now - 6 * 3600e3,
      to: now + 4 * 24 * 3600e3,
      wantIds: want && want.ids ? new Set(want.ids.map((x) => x.toLowerCase())) : null,
      wantNames: want && want.names ? new Set(want.names) : null,
      normName: normChannelName,
    });
    data.url = url;
    writeJSON(EPG_FILE(id), data);
    return data;
  })().finally(() => epgRunning.delete(id));
  epgRunning.set(id, job);
  return job;
});

ipcMain.handle('epg:delete', (_e, id) => {
  try { fs.unlinkSync(EPG_FILE(id)); } catch {}
  return true;
});

// ---------- Über Signal ----------
ipcMain.handle('app:info', () => {
  const pkg = require('./package.json');
  const dir = path.join(__dirname, 'licenses');
  let licenses = [];
  try {
    licenses = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => ({
      name: f.replace(/\.txt$/, ''),
      text: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
  } catch {}
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    homepage: pkg.homepage || '',
    licenses,
  };
});

// Nur https-Links aus der App im Standardbrowser öffnen
ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

// ---------- Mini-Player ----------
let normalBounds = null;
ipcMain.handle('window:mini', (_e, on) => {
  const { screen } = require('electron');
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    normalBounds = win.getBounds();
    const area = screen.getDisplayMatching(normalBounds).workArea;
    const w = 480, h = 270;
    win.setMinimumSize(320, 180);
    win.setAlwaysOnTop(true, 'floating');
    win.setAspectRatio(16 / 9);
    win.setBounds({ x: area.x + area.width - w - 24, y: area.y + area.height - h - 24, width: w, height: h }, true);
    // Windows: Fensterknöpfe im kleinen Fenster dezent über dem Bild
    if (process.platform === 'win32') { try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: '#E6EAF2', height: 34 }); } catch {} }
  } else {
    if (process.platform === 'win32') { try { win.setTitleBarOverlay({ color: '#0F1724', symbolColor: '#8C99B0', height: 44 }); } catch {} }
    win.setAlwaysOnTop(false);
    win.setAspectRatio(0);
    win.setMinimumSize(960, 600);
    if (normalBounds) win.setBounds(normalBounds, true);
  }
  return on;
});

ipcMain.handle('net:setUserAgent', (_e, ua) => { userAgent = ua || DEFAULT_UA; return true; });

ipcMain.handle('window:fullscreen', (_e, value) => {
  win.setFullScreen(typeof value === 'boolean' ? value : !win.isFullScreen());
  return win.isFullScreen();
});

function findVlc() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
      ]
    : ['/usr/bin/vlc', '/Applications/VLC.app/Contents/MacOS/VLC'];
  return candidates.find((p) => fs.existsSync(p));
}

ipcMain.handle('external:vlc', (_e, url, title, lang) => {
  const vlc = findVlc();
  if (!vlc) return { ok: false, reason: 'VLC wurde nicht gefunden. Installiere VLC von videolan.org.' };
  const args = [url, `--meta-title=${title || ''}`, `--http-user-agent=${userAgent}`];
  // Bevorzugte Tonspur-Sprache an VLC weitergeben (z. B. "deu")
  if (lang && /^[a-z]{2,3}$/.test(lang)) args.push(`--audio-language=${lang}`);
  spawn(vlc, args, {
    detached: true, stdio: 'ignore',
  }).unref();
  return { ok: true };
});

app.whenReady().then(() => {
  setupNetwork();
  createWindow();
  if (process.env.SIGNAL_E2E) require('./test/e2e.js')(win);
  if (process.env.SIGNAL_BENCH) require('./test/bench.js')(win);
  if (process.env.SIGNAL_AUDIO_E2E) require('./test/audio-e2e.js')(win);
  if (process.env.SIGNAL_FEATURES_E2E) require('./test/features-e2e.js')(win);
  if (process.env.SIGNAL_SCREENSHOTS) require('./test/screenshots.js')(win);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
