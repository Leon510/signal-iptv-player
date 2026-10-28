// Wiedergabe-Messung: SIGNAL_BENCH=<ausgabe.json> SIGNAL_PLAYLIST=<url> [SIGNAL_BENCH_SECONDS=45] electron .
// Spielt jeden Sender der Playlist nacheinander und misst Hänger, Sprünge, Ton und Bildrate.
const fs = require('fs');
const { app } = require('electron');

module.exports = (win) => {
  const outFile = process.env.SIGNAL_BENCH;
  const playlist = process.env.SIGNAL_PLAYLIST;
  const seconds = +(process.env.SIGNAL_BENCH_SECONDS || 45);
  const only = process.env.SIGNAL_BENCH_ONLY ? process.env.SIGNAL_BENCH_ONLY.split(',').map(Number) : null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(`(()=>{${code}})()`, true);

  const MONITOR = `
    const v = document.getElementById('video');
    if (window.__mon) clearInterval(window.__mon.timer);
    const m = window.__mon = { stalls: 0, stallTime: 0, seeks: 0, waiting: 0, firstFrame: null, start: performance.now(),
      inStall: false, last: v.currentTime, lastWall: performance.now(), maxStall: 0, curStall: 0 };
    v.addEventListener('seeking', () => m.seeks++);
    v.addEventListener('waiting', () => m.waiting++);
    m.timer = setInterval(() => {
      const now = performance.now(), dt = (now - m.lastWall) / 1000;
      const adv = v.currentTime - m.last;
      if (m.firstFrame === null && v.currentTime > 0 && v.readyState >= 2) m.firstFrame = (now - m.start) / 1000;
      if (m.firstFrame !== null && !v.paused) {
        const stalled = adv < dt * 0.3; // Bild steht (oder fast)
        if (stalled) {
          if (!m.inStall) { m.stalls++; m.inStall = true; m.curStall = 0; }
          m.stallTime += dt; m.curStall += dt; m.maxStall = Math.max(m.maxStall, m.curStall);
        } else m.inStall = false;
      }
      m.last = v.currentTime; m.lastWall = now;
    }, 200);
  `;
  const RESULT = `
    const v = document.getElementById('video'), m = window.__mon;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    let ahead = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) > v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
    return { firstFrame: m.firstFrame, stalls: m.stalls, stallTime: +m.stallTime.toFixed(2), maxStall: +m.maxStall.toFixed(2),
      seeks: m.seeks, waitingEvents: m.waiting, frames: q.totalVideoFrames, dropped: q.droppedVideoFrames,
      audioBytes: v.webkitAudioDecodedByteCount, currentTime: +v.currentTime.toFixed(1), bufferAhead: +ahead.toFixed(2),
      error: !document.getElementById('errorBox').hidden ? document.getElementById('errorDetail').textContent : null,
      debug: window.__signalDebug ? window.__signalDebug() : null };
  `;

  win.webContents.once('did-finish-load', async () => {
    const results = [];
    try {
      await wait(800);
      await js(`document.getElementById('welcomeUrl').value=${JSON.stringify(playlist)};
                document.getElementById('welcomeForm').requestSubmit(document.querySelector('#welcomeForm button'));`);
      await wait(2000);
      const names = await js(`return [...document.querySelectorAll('.row')].map(r => [+r.dataset.i, r.querySelector('.name').textContent])`);
      for (const [i, name] of names) {
        if (only && !only.includes(i)) continue;
        await js(MONITOR);
        await js(`document.querySelector('.row[data-i="${i}"]').click()`);
        await wait(seconds * 1000);
        const r = await js(RESULT);
        results.push({ name, ...r });
        await js(`document.querySelector('.row[data-i="${i}"]') && 0`);
      }
    } catch (e) {
      results.push({ error: e.stack });
    }
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    app.quit();
  });
};
