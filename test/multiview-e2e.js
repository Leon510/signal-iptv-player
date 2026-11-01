// Test für verschiebbare Spalten und Multiview.
// SIGNAL_MV_E2E=<ordner> SIGNAL_PLAYLIST=<url zu mv.m3u aus scripts/make-test-media.py> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.SIGNAL_MV_E2E;
  const playlist = process.env.SIGNAL_PLAYLIST;
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
  const center = (sel) => js(`const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}`);
  async function drag(sel, dx) {
    const p = await center(sel);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    for (let s = 1; s <= 10; s++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + Math.round((dx * s) / 10), y: p.y, button: 'left', modifiers: ['leftButtonDown'] });
      await wait(30);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + dx, y: p.y, button: 'left', clickCount: 1 });
    await wait(400);
  }
  const tilesPlaying = async () => {
    const a = (await dbg()).mv.tiles.map((t) => t.t);
    await wait(2000);
    const b = (await dbg()).mv.tiles.map((t) => t.t);
    return a.map((x, k) => b[k] - x > 1);
  };

  win.setContentSize(1440, 900);
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(800);
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(playlist)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(2500);

      // ---------- Spalten ----------
      let d = await dbg();
      const list0 = d.columns.list, rail0 = d.columns.rail;
      const longName = `[...document.querySelectorAll('.row .name')].find(n=>n.textContent.includes('sehr langen'))`;
      const cutBefore = await js(`const n=${longName}; return n.scrollWidth > n.clientWidth`);
      await shot('m1-vorher');
      await drag('#listResizer', 380);
      d = await dbg();
      check('Senderliste breiter gezogen', Math.abs(d.columns.list - (list0 + 380)) <= 4, `${list0} -> ${d.columns.list}`);
      const cutAfter = await js(`const n=${longName}; return n.scrollWidth > n.clientWidth`);
      check('Langer Name jetzt ganz sichtbar', cutBefore && !cutAfter, `vorher abgeschnitten=${cutBefore}, nachher=${cutAfter}`);
      await drag('#railResizer', 60);
      d = await dbg();
      check('Kategorien breiter gezogen', Math.abs(d.columns.rail - (rail0 + 60)) <= 4, `${rail0} -> ${d.columns.rail}`);
      await shot('m2-breiter');
      await js(`document.getElementById('listResizer').focus()`);
      await key('Left');
      d = await dbg();
      check('Pfeiltaste am Trenner', Math.abs(d.columns.list - (list0 + 360)) <= 4, `${d.columns.list}`);
      check('Breiten gespeichert', d.columns.stored.list === d.columns.list && d.columns.stored.rail === d.columns.rail, JSON.stringify(d.columns.stored));
      await js(`document.getElementById('railResizer').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`);
      await wait(200);
      d = await dbg();
      check('Doppelklick setzt zurück', d.columns.rail === rail0 && !d.columns.stored.rail, `${d.columns.rail}`);
      await blur();

      // ---------- Multiview ----------
      await js(`document.querySelector('.row[data-i="0"]').click()`);
      await wait(2000);
      await key('V');
      await wait(1500);
      d = await dbg();
      check('Multiview mit laufendem Sender gestartet', d.mv.on && d.mv.tiles[0].name === 'Nordlicht' && d.mv.sel === 1, JSON.stringify(d.mv.tiles.map((t) => t.name)));
      for (const i of [1, 2, 3]) {
        await js(`document.querySelector('.row[data-i="${i}"]').click()`);
        await wait(400);
      }
      await wait(5000);
      d = await dbg();
      check('Vier Felder gefüllt', d.mv.tiles.every((t) => t.name), JSON.stringify(d.mv.tiles.map((t) => t.name)));
      const run = await tilesPlaying();
      check('Alle vier spielen gleichzeitig', run.every(Boolean), JSON.stringify(run));
      d = await dbg();
      check('Nur ein Feld mit Ton', d.mv.tiles.filter((t) => !t.muted).length === 1 && !d.mv.tiles[0].muted, JSON.stringify(d.mv.tiles.map((t) => t.muted)));
      check('Liste markiert alle vier', (await js(`return document.querySelectorAll('.row.playing').length`)) === 4);
      await shot('m3-multiview-4');

      // Ton wechseln
      await js(`document.querySelector('.mv-tile[data-tile="2"] video').click()`);
      await wait(300);
      d = await dbg();
      check('Klick aufs Feld holt den Ton', d.mv.audio === 2 && !d.mv.tiles[2].muted && d.mv.tiles[0].muted);
      // Markiertes Feld ersetzen
      await js(`document.querySelector('.row[data-i="4"]').click()`);
      await wait(2500);
      d = await dbg();
      check('Sender ersetzt markiertes Feld', d.mv.tiles[2].name === 'Prisma', d.mv.tiles[2].name);
      // Feld leeren und neu füllen
      await js(`document.querySelector('.mv-tile[data-tile="3"] [data-mv-act="close"]').click()`);
      await wait(300);
      d = await dbg();
      check('Feld geleert und markiert', !d.mv.tiles[3].name && d.mv.sel === 3);
      await shot('m4-feld-leer');
      await js(`document.querySelector('.row[data-i="5"]').click()`);
      await wait(3000);
      d = await dbg();
      check('Leeres Feld neu gefüllt', d.mv.tiles[3].name && d.mv.tiles[3].name.includes('sehr langen'), d.mv.tiles[3].name);

      // Aufteilungen
      await js(`document.querySelector('[data-mv-layout="1+3"]').click()`);
      await wait(800);
      await shot('m5-1plus3');
      await js(`document.querySelector('[data-mv-layout="2"]').click()`);
      await wait(800);
      d = await dbg();
      check('Aufteilung 2 schließt Feld 3 und 4', d.mv.tiles[0].name && d.mv.tiles[1].name && !d.mv.tiles[2].name && !d.mv.tiles[3].name && d.mv.layout === '2');
      await shot('m6-zwei');

      // Doppelklick: groß ansehen
      const r = await center('.mv-tile[data-tile="1"] video');
      win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 2 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 2 });
      await wait(2500);
      d = await dbg();
      check('Doppelklick zeigt Feld groß', !d.mv.on && d.playingName === 'Kanal Mitte', d.playingName);
      const tAfter = await js(`return document.getElementById('video').currentTime`);
      check('Hauptplayer läuft danach', tAfter > 0.3, `t=${tAfter.toFixed(1)}`);

      // ---------- Verbindungslimit ----------
      await blur();
      await key('V');
      await wait(500);
      await js(`document.querySelector('[data-mv-layout="4"]').click()`);
      await wait(300);
      // Feld 1 hat "Kanal Mitte"; die Limit-Sender liegen am Ende der Liste
      const lim = await js(`return [...document.querySelectorAll('.row')].filter(r=>r.textContent.includes('Limit-Sender')).map(r=>+r.dataset.i)`);
      for (const i of lim.slice(0, 3)) {
        await js(`document.querySelector('.row[data-i="${i}"]').scrollIntoView(); document.querySelector('.row[data-i="${i}"]').click()`);
        await wait(500);
      }
      await wait(5000);
      d = await dbg();
      const errs = d.mv.tiles.filter((t) => t.error).map((t) => t.error);
      check('Verbindungslimit verständlich erklärt', errs.length === 1 && errs[0].includes('Verbindungen gleichzeitig'), JSON.stringify(errs));
      await shot('m7-limit');

      // Vollbild und Beenden
      await key('F');
      await wait(800);
      await shot('m8-vollbild');
      await key('Escape');
      await wait(600);
      await key('Escape');
      await wait(800);
      d = await dbg();
      check('Esc beendet Multiview', !d.mv.on && d.mv.tiles.every((t) => !t.name));
    } catch (e) {
      log.push('E2E ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'mv-log.txt'), log.join('\n') + '\n');
    app.quit();
  });
};
