// Test für EPG, Programmübersicht, vorherigen Sender, Live-Zurückspulen, Mini-Player,
// Favoriten-Reihenfolge und Playlist-Wechsel.
// SIGNAL_FEATURES_E2E=<ordner> SIGNAL_PLAYLIST=<url A mit url-tvg> SIGNAL_PLAYLIST_B=<url B> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.SIGNAL_FEATURES_E2E;
  const plA = process.env.SIGNAL_PLAYLIST;
  const plB = process.env.SIGNAL_PLAYLIST_B;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(`(()=>{${code}})()`, true);
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const log = [];
  const check = (label, ok, extra = '') => log.push(`${ok ? 'OK  ' : 'FAIL'} ${label} ${extra}`);
  const dbg = () => js(`return window.__signalDebug()`);
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(150);
  };
  const blur = () => js(`document.activeElement && document.activeElement.blur()`);
  const search = (q) => js(`const s=document.getElementById('search'); s.value=${JSON.stringify(q)}; s.dispatchEvent(new Event('input'));`);

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(800);
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(plA)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(3000);

      // --- EPG in der Liste ---
      let d = await dbg();
      check('EPG zugeordnet (30 Sender)', d.epgMatched === 30, `${d.epgMatched}`);
      const epgRows = await js(`return document.querySelectorAll('.row .grp.epg').length`);
      check('Liste zeigt laufende Sendung', epgRows > 5, `${epgRows} Zeilen`);
      await shot('f1-list-epg');

      // --- Senderanzeige mit Sendung ---
      await js(`document.querySelector('.row[data-i="0"]').click()`);
      await wait(1200);
      const osd = await js(`return { shown: !document.getElementById('osdEpg').hidden, prog: document.getElementById('osdProg').textContent, next: document.getElementById('osdNext').textContent }`);
      check('Senderanzeige mit Sendung und „Danach“', osd.shown && osd.prog && osd.next.startsWith('Danach'), JSON.stringify(osd));
      await shot('f2-osd-epg');

      // --- Vorheriger Sender ---
      await js(`document.querySelector('.row[data-i="1"]').click()`);
      await wait(1500);
      await blur();
      await key('Backspace');
      await wait(800);
      d = await dbg();
      check('Rücktaste: vorheriger Sender', d.playing === 0, `${d.playingName}`);

      // --- Live-Zurückspulen ---
      await wait(14000);
      await blur();
      await key('Left');
      await wait(800);
      const ts = await js(`return { cls: document.getElementById('screen').classList.contains('timeshift'), cur: document.getElementById('timeCur').textContent, seek: !document.getElementById('seekRow').hidden }`);
      check('Live zurückgespult', ts.cls && ts.seek && ts.cur.startsWith('−'), JSON.stringify(ts));
      await js(`document.getElementById('screen').dispatchEvent(new MouseEvent('mousemove'))`);
      await wait(200);
      await shot('f3-timeshift');
      await js(`document.getElementById('liveBtn').click()`);
      await wait(1200);
      const live = await js(`return document.getElementById('timeCur').textContent`);
      check('„Live“ springt zurück zum Live-Bild', live === 'Live', live);

      // --- Programmübersicht ---
      await key('G');
      await wait(800);
      const g = await js(`return { open: !document.getElementById('guidePane').hidden, progs: document.querySelectorAll('.g-prog').length, now: document.querySelectorAll('.g-prog.now').length }`);
      check('Programmübersicht offen', g.open && g.progs > 20 && g.now > 3, JSON.stringify(g));
      await shot('f4-guide');
      await js(`document.querySelectorAll('.g-prog.now')[2].click()`);
      await wait(300);
      await shot('f5-guide-detail');
      const target = await js(`return +document.querySelector('#guideDetail [data-act="watch"]').dataset.ch`);
      await js(`document.querySelector('#guideDetail [data-act="watch"]').click()`);
      await wait(1200);
      d = await dbg();
      check('„Jetzt ansehen“ schaltet um', d.playing === target && (await js(`return document.getElementById('guidePane').hidden`)), d.playingName);

      // --- Mini-Player ---
      await blur();
      await key('P');
      await wait(900);
      const b = win.getBounds();
      check('Mini-Player: kleines Fenster, immer im Vordergrund', (await js(`return document.body.classList.contains('mini')`)) && b.width <= 500 && win.isAlwaysOnTop(), `${b.width}x${b.height}`);
      await shot('f6-mini');
      await key('Escape');
      await wait(900);
      check('Mini-Player beendet', !(await js(`return document.body.classList.contains('mini')`)) && win.getBounds().width > 900);

      // --- Favoriten sortieren ---
      for (const i of [3, 4, 5]) await js(`document.querySelector('[data-star="${i}"]').click()`);
      await js(`document.querySelector('[data-filter="fav"]').click()`);
      await wait(300);
      const before = (await dbg()).favorites;
      await js(`document.querySelector('.row[data-i="3"]').click()`);
      await wait(500);
      await blur();
      await key('Down', ['alt']);
      await wait(300);
      const after = (await dbg()).favorites;
      check('Alt+↓ verschiebt Favorit', after[1] === before[0] && after[0] === before[1], `${before} -> ${after}`);
      await shot('f7-favorites');

      // --- Zweite Playlist, Wechseln, getrennte Suche ---
      await js(`document.getElementById('addBtn').click()`);
      await wait(200);
      await js(`document.getElementById('addName').value='Ausland'; document.getElementById('addUrl').value=${JSON.stringify(plB)};
                document.getElementById('addForm').requestSubmit(document.getElementById('addSubmit'));`);
      await wait(2000);
      d = await dbg();
      check('Zweite Playlist aktiv', d.playlists.length === 2 && (await js(`return document.getElementById('plName').textContent`)) === 'Ausland', JSON.stringify(d.playlists));
      await search('CNN');
      await wait(400);
      check('Suche in Playlist B findet CNN', (await js(`return document.querySelectorAll('.row').length`)) === 1);
      await js(`document.getElementById('plBtn').click()`);
      await wait(300);
      await shot('f8-playlist-menu');
      check('Menü listet beide Playlisten', (await js(`return document.querySelectorAll('#plMenu [data-pl]').length`)) === 2);
      await js(`document.getElementById('plBtn').click()`);
      await blur();
      await key('1', ['control']);
      await wait(2000);
      check('Strg+1 wechselt zu Playlist A', (await js(`return document.getElementById('plName').textContent`)) !== 'Ausland');
      await search('CNN');
      await wait(400);
      const res = await js(`return { rows: document.querySelectorAll('.row').length, also: document.getElementById('listAlso').hidden ? '' : document.getElementById('listAlso').textContent }`);
      check('Suche in A zeigt nichts aus B', res.rows === 0 && !res.also.includes('CNN'), JSON.stringify(res));
      await search('');

      // --- Umbenennen ---
      await js(`document.getElementById('settingsBtn').click()`);
      await wait(300);
      await js(`document.querySelector('#plManage [data-act="edit"]').click()`);
      await wait(200);
      await shot('f9-edit');
      await js(`document.querySelector('#plManage [data-f="name"]').value='Zuhause'; document.querySelector('#plManage [data-act="save"]').click();`);
      await wait(300);
      check('Umbenannt', (await js(`return document.getElementById('plName').textContent`)) === 'Zuhause');
      await shot('f10-settings');
    } catch (e) {
      log.push('E2E ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'features-log.txt'), log.join('\n'));
    app.quit();
  });
};
