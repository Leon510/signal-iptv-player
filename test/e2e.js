// Automatischer Oberflächentest: SIGNAL_E2E=<Ausgabeordner> SIGNAL_PLAYLIST=<url> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = (win) => {
  const out = process.env.SIGNAL_E2E;
  const playlist = process.env.SIGNAL_PLAYLIST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(`(()=>{${code}})()`, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  };
  const log = [];
  const check = (label, ok, extra = '') => log.push(`${ok ? 'OK  ' : 'FAIL'} ${label} ${extra}`);
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) log.push(`[console] ${e.message}`); });
  const text = (id) => js(`return document.getElementById('${id}').textContent`);
  const vt = () => js(`return document.getElementById('video').currentTime`);
  const search = (q) => js(`const s=document.getElementById('search'); s.value=${JSON.stringify(q)}; s.dispatchEvent(new Event('input'));`);

  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(800);
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(playlist)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(2500);
      check('Bereiche sichtbar', !(await js(`return document.getElementById('sections').hidden`)));
      await shot('01-live');

      // Sender ausblenden
      const before = await text('listCount');
      await js(`document.querySelector('[data-hide="4"]').click()`);
      await wait(300);
      const after = await text('listCount');
      check('Sender ausgeblendet', before !== after, `${before} -> ${after}`);
      await js(`document.querySelector('.row[data-i="0"]').click()`);
      await wait(1500);
      check('Live spielt', (await vt()) > 0.3);
      await shot('02-hidden-toast');

      // Gruppe ausblenden
      await js(`document.querySelector('[data-hide-group="Nachrichten"]').click()`);
      await wait(300);
      check('Gruppe weg', !(await js(`return !!document.querySelector('[data-filter="g:Nachrichten"]')`)), await text('listCount'));

      // Universelle Suche aus einer Gruppe heraus
      await js(`document.querySelector('[data-filter="g:Sport"]').click()`);
      await wait(200);
      await search('Sender 1');
      await wait(400);
      const groups = await js(`return [...new Set([...document.querySelectorAll('.row .grp')].map(x=>x.textContent))]`);
      check('Suche über Gruppen', groups.length > 1 && !groups.includes('Nachrichten'), JSON.stringify(groups));
      await search('Test');
      await wait(400);
      const chips = await js(`return [...document.querySelectorAll('#listAlso .chip')].map(c=>c.textContent)`);
      check('Treffer in anderen Bereichen', chips.length === 2, JSON.stringify(chips));
      await shot('03-search');
      await js(`document.querySelector('#listAlso [data-goto="movie"]').click()`);
      await wait(600);
      check('Wechsel zu Filme mit Suche', (await text('vodTitle')).includes('Test'), await text('vodCount'));
      await shot('04-movie-search');

      // Film-Raster
      await search('');
      await wait(500);
      await shot('05-movies');

      // Film abspielen, spulen, schließen, fortsetzen
      const movieIdx = await js(`return +[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Der Testlauf')).dataset.movie`);
      await js(`document.querySelector('[data-movie="${movieIdx}"]').click()`);
      await wait(3500);
      const t1 = await vt();
      check('Film spielt', t1 > 0.5, 't=' + t1.toFixed(1));
      await js(`document.getElementById('video').currentTime = 50`);
      await wait(1500);
      await js(`document.getElementById('screen').dispatchEvent(new MouseEvent('mousemove'))`);
      await wait(200);
      await shot('06-movie-player');
      await js(`document.getElementById('vodClose').click()`);
      await wait(600);
      check('Fortschritt am Poster', await js(`return !!document.querySelector('[data-movie="${movieIdx}"] .pbar')`));
      check('Weiterschauen zählt', (await js(`return document.querySelector('[data-filter="continue"] .n').textContent`)) === '1');
      await shot('07-movies-progress');
      await js(`document.querySelector('[data-movie="${movieIdx}"]').click()`);
      await wait(3500);
      const t2 = await vt();
      check('Fortsetzen', t2 >= 49, 't=' + t2.toFixed(1));
      await shot('08-resume-toast');
      await js(`document.getElementById('vodClose').click()`);
      await wait(400);

      // MKV
      const mkv = await js(`return +[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Farbbalken')).dataset.movie`);
      await js(`document.querySelector('[data-movie="${mkv}"]').click()`);
      await wait(4000);
      const t3 = await vt();
      check('MKV spielt', t3 > 0.5, 't=' + t3.toFixed(1) + ' err=' + !(await js(`return document.getElementById('errorBox').hidden`)));
      await js(`document.getElementById('vodClose').click()`);
      await wait(400);

      // Serien
      await js(`document.querySelector('[data-section="series"]').click()`);
      await wait(600);
      await shot('09-series');
      await js(`[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Testserie')).click()`);
      await wait(500);
      check('Staffeln', (await js(`return document.querySelectorAll('#seasonTabs button').length`)) === 2);
      await shot('10-show');
      await js(`document.querySelector('#episodeList [data-ep]').click()`);
      await wait(3000);
      check('Folge spielt', (await vt()) > 0.5, await text('vodNowSub'));
      await js(`document.getElementById('video').currentTime = 18.5`);
      await wait(4500);
      const sub = await text('vodNowSub');
      check('Nächste Folge automatisch', sub.includes('Folge 2'), sub);
      await shot('11-next-episode');
      await js(`document.getElementById('vodClose').click()`);
      await wait(500);
      check('Folge 1 als gesehen', await js(`return document.querySelector('#episodeList li').classList.contains('is-watched')`));
      await shot('12-show-progress');

      // Auswahl-Dialog
      await js(`document.getElementById('showBack').click()`);
      await js(`document.querySelector('[data-section="live"]').click()`);
      await wait(400);
      await js(`document.getElementById('railEdit').click()`);
      await wait(400);
      await shot('13-groups-dialog');
      await js(`document.querySelector('[data-tab="items"]').click()`);
      await wait(200);
      await shot('14-groups-items');
      await js(`document.getElementById('groupsClose').click()`);
      await wait(300);
      await js(`document.getElementById('settingsBtn').click()`);
      await wait(300);
      check('Zusammenfassung', true, await text('hiddenSummary'));
      await shot('15-settings');
    } catch (e) {
      log.push('E2E ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n'));
    app.quit();
  });
};
