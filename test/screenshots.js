// Screenshots für README und Store mit den Demo-Daten aus scripts/make-test-media.py
// SIGNAL_SCREENSHOTS=<ordner> SIGNAL_PLAYLIST=<url zu demo.m3u> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.SIGNAL_SCREENSHOTS;
  const playlist = process.env.SIGNAL_PLAYLIST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(`(()=>{${code}})()`, true);
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const move = () => js(`document.getElementById('screen').dispatchEvent(new MouseEvent('mousemove'))`);
  const log = [];

  win.setContentSize(1440, 900);
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(800);
      await shot('00-willkommen');
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(playlist)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(3000);
      // Playlist umbenennen
      await js(`document.getElementById('settingsBtn').click()`);
      await wait(200);
      await js(`document.querySelector('#plManage [data-act="edit"]').click()`);
      await js(`document.querySelector('#plManage [data-f="name"]').value='Zuhause'; document.querySelector('#plManage [data-act="save"]').click();
                document.getElementById('settingsClose').click();`);
      await wait(300);
      for (const i of [0, 2, 6]) await js(`document.querySelector('[data-star="${i}"]').click()`);

      // 1) Live-TV mit laufender Sendung
      await js(`document.querySelector('.row[data-i="1"]').click()`);
      await wait(2500);
      await js(`document.querySelector('.row[data-i="2"]').click()`);
      await wait(1800);
      await move();
      await wait(200);
      await shot('01-live-tv');

      // 2) Programmübersicht mit Details
      await js(`document.getElementById('guideOpenBtn').click()`);
      await wait(800);
      await shot('02-programm');
      await js(`document.querySelectorAll('.g-prog.now')[3].click()`);
      await wait(300);
      await shot('03-programm-details');
      await js(`document.querySelector('#guideDetail [data-act="close"]').click(); document.getElementById('guideClose').click();`);

      // 3) Filme
      await js(`document.querySelector('[data-section="movie"]').click()`);
      await wait(1500);
      await shot('04-filme');

      // 4) Serie
      await js(`document.querySelector('[data-section="series"]').click()`);
      await wait(600);
      await js(`document.querySelector('.card').click()`);
      await wait(800);
      await shot('05-serie');

      // 5) Aussortieren
      await js(`document.querySelector('[data-section="live"]').click()`);
      await wait(400);
      await js(`document.getElementById('railEdit').click()`);
      await wait(400);
      await shot('06-auswahl');
      await js(`document.getElementById('groupsClose').click()`);

      // 6) Über Signal
      await js(`document.getElementById('settingsBtn').click()`);
      await wait(200);
      await js(`document.getElementById('aboutBtn').click()`);
      await wait(400);
      await shot('07-ueber');
    } catch (e) {
      log.push('ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'screenshots-log.txt'), log.join('\n') || 'ok');
    app.quit();
  });
};
