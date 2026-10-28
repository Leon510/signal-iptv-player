// Test der Tonspur-Auswahl: SIGNAL_AUDIO_E2E=<ausgabeordner> SIGNAL_PLAYLIST=<url> electron .
// Erwartet eine Playlist mit: Mehrspur-TS (live), HLS mit Audio-Renditions, MP4 und MKV mit zwei Tonspuren.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.SIGNAL_AUDIO_E2E;
  const playlist = process.env.SIGNAL_PLAYLIST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(`(()=>{${code}})()`, true);
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const log = [];
  const check = (label, ok, extra = '') => log.push(`${ok ? 'OK  ' : 'FAIL'} ${label} ${extra}`);
  const dbg = () => js(`return window.__signalDebug()`);
  const abytes = () => js(`return document.getElementById('video').webkitAudioDecodedByteCount`);
  const sel = (d) => (d.tracks.find((t) => t.selected) || {});

  // Tonspur über das Menü wählen, wie ein Nutzer
  async function pick(label, detail) {
    await js(`document.getElementById('screen').dispatchEvent(new MouseEvent('mousemove'));
              document.getElementById('audioBtn').click();`);
    await wait(300);
    return js(`const b=[...document.querySelectorAll('#audioMenu [data-track]')].find(b=>b.textContent.includes(${JSON.stringify(label)}) && b.textContent.includes(${JSON.stringify(detail)}));
               if(!b) return false; b.click(); return true;`);
  }

  async function verifySwitch(name, label, detail, waitMs) {
    const ok = await pick(label, detail);
    await wait(waitMs);
    const d = await dbg();
    const b1 = await abytes();
    await wait(1500);
    const b2 = await abytes();
    check(`${name}: auf ${label} ${detail} gewechselt`, ok && sel(d).label === label && (!detail || sel(d).detail === detail), JSON.stringify(sel(d)));
    check(`${name}: Ton läuft nach Wechsel`, b2 > b1, `${b1} -> ${b2}`);
  }

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(800);
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(playlist)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(2000);

      // 1) Live-TS mit drei Spuren, davon eine AC-3
      await js(`document.querySelector('.row[data-i="0"]').click()`);
      await wait(5000);
      let d = await dbg();
      check('TS: drei Spuren erkannt', d.tracks.length === 3, JSON.stringify(d.tracks.map((t) => [t.label, t.detail, t.supported])));
      check('TS: Tonspur-Knopf sichtbar', !(await js(`return document.getElementById('audioBtn').hidden`)));
      await js(`document.getElementById('audioBtn').click()`);
      await wait(300);
      await shot('a1-ts-menu');
      await js(`document.getElementById('audioBtn').click()`);
      await verifySwitch('TS', 'Deutsch', 'AAC', 5000);

      // 2) HLS mit Audio-Renditions: bevorzugte Sprache (Deutsch) zuerst
      await js(`document.querySelector('.row[data-i="1"]').click()`);
      await wait(5000);
      d = await dbg();
      check('HLS: zwei Spuren', d.tracks.length === 2, JSON.stringify(d.tracks.map((t) => [t.label, t.selected])));
      check('HLS: Deutsch automatisch gewählt', sel(d).label === 'Deutsch');
      await verifySwitch('HLS', 'Englisch', '', 4000);

      // 3) Filme: MP4 und MKV mit zwei Spuren
      await js(`document.querySelector('[data-section="movie"]').click()`);
      await wait(500);
      for (const [i, name] of [[2, 'MP4'], [3, 'MKV']]) {
        await js(`document.querySelector('[data-movie="${i}"]').click()`);
        await wait(4000);
        d = await dbg();
        check(`${name}: zwei Spuren`, d.tracks.length === 2, JSON.stringify(d.tracks.map((t) => [t.label, t.selected])) + ' engine=' + d.engine);
        // Erwartet: die zuletzt gewählte Sprache (HLS: Englisch, danach MP4: Deutsch)
        const expected = name === 'MP4' ? 'Englisch' : 'Deutsch';
        check(`${name}: zuletzt gewählte Sprache übernommen`, sel(d).label === expected, sel(d).label);
        await verifySwitch(name, expected === 'Deutsch' ? 'Englisch' : 'Deutsch', '', 1500);
        if (name === 'MP4') await shot('a2-movie-menu-after');
        await js(`document.getElementById('vodClose').click()`);
        await wait(500);
      }
    } catch (e) {
      log.push('E2E ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'audio-log.txt'), log.join('\n'));
    app.quit();
  });
};
