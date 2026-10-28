// Unit-Tests ohne Electron: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const M3U = require('../renderer/m3u.js');
const { loadEpg, parseTime } = require('../epg.js');

test('M3U: Attribute, Name mit Komma in Gruppe, VLC-Optionen', () => {
  const r = M3U.parseM3U(`﻿#EXTM3U url-tvg="http://e/epg.xml"
#EXTINF:-1 tvg-id="das.de" tvg-logo="http://l/a.png" group-title="DE | News, Info",Das Erste HD
#EXTVLCOPT:http-user-agent=Foo
http://s/1.m3u8
#EXTINF:-1,Ohne Attribute
#EXTGRP:Sport
http://s/2.ts
http://s/3`);
  assert.equal(r.epgUrl, 'http://e/epg.xml');
  assert.equal(r.channels.length, 3);
  assert.deepEqual(
    { name: r.channels[0].name, group: r.channels[0].group, tvgId: r.channels[0].tvgId, ua: r.channels[0].ua },
    { name: 'Das Erste HD', group: 'DE | News, Info', tvgId: 'das.de', ua: 'Foo' },
  );
  assert.equal(r.channels[1].group, 'Sport');
  assert.equal(r.channels[2].group, 'Ohne Gruppe');
});

test('Erkennung von Live, Film und Serie', () => {
  const k = (name, url, group = '') => M3U.classify({ name, url, group });
  assert.equal(k('Das Erste', 'http://h:8080/u/p/123'), 'live');
  assert.equal(k('Sky Cinema', 'http://h/live/u/p/5.ts', 'Sky Cinema'), 'live');
  assert.equal(k('Inception (2010)', 'http://h/movie/u/p/77.mkv'), 'movie');
  assert.equal(k('Film', 'http://h/x/film.mp4', 'Kino'), 'movie');
  assert.equal(k('Dark S02 E05', 'http://h/series/u/p/9.mp4'), 'series');
  assert.equal(k('The Office 3x07', 'http://h/v/1.mkv', 'Comedy'), 'series');
});

test('Folgen und Filmtitel zerlegen', () => {
  assert.deepEqual(M3U.parseEpisode('Dark S02 E05 - Geheimnisse'), { show: 'Dark', season: 2, episode: 5, title: 'Geheimnisse' });
  assert.deepEqual(M3U.parseEpisode('The Office 3x07'), { show: 'The Office', season: 3, episode: 7, title: '' });
  assert.deepEqual(M3U.parseMovie('Inception (2010)'), { title: 'Inception', year: '2010' });
});

test('Sendernamen für den EPG-Abgleich', () => {
  const n = M3U.normChannelName;
  assert.equal(n('DE: Das Erste HD'), n('Das Erste'));
  assert.equal(n('DE | ZDF FHD'), 'zdf');
  assert.equal(n('[DE] RTL ᴴᴰ'), 'rtl');
  assert.equal(n('arte HEVC'), 'arte');
});

test('XMLTV-Zeitangaben mit Zeitzone', () => {
  assert.equal(parseTime('20261028201500 +0100'), Date.UTC(2026, 9, 28, 19, 15));
  assert.equal(parseTime('20261028201500 -0200'), Date.UTC(2026, 9, 28, 22, 15));
  assert.ok(Number.isNaN(parseTime('kaputt')));
});

test('EPG laden: gzip, Filter nach id und Name, Zeitfenster, Entities', async () => {
  const now = Date.now();
  const t = (ms) => {
    const d = new Date(ms);
    const z = (x) => String(x).padStart(2, '0');
    return `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}00 +0000`;
  };
  const xml = `<?xml version="1.0"?><tv>
<channel id="a.de"><display-name>Sender A</display-name></channel>
<channel id="b.de"><display-name>DE: Sender B HD</display-name></channel>
<channel id="c.de"><display-name>Fremd</display-name></channel>
<programme start="${t(now - 3600e3)}" stop="${t(now + 3600e3)}" channel="a.de"><title>Jetzt &amp; hier</title><desc>Eine &lt;Beschreibung&gt;</desc></programme>
<programme start="${t(now - 30 * 24 * 3600e3)}" stop="${t(now - 29 * 24 * 3600e3)}" channel="a.de"><title>Zu alt</title></programme>
<programme start="${t(now)}" stop="${t(now + 1800e3)}" channel="b.de"><title>B läuft</title></programme>
<programme start="${t(now)}" stop="${t(now + 1800e3)}" channel="c.de"><title>Nicht gewollt</title></programme>
</tv>`;
  const body = zlib.gzipSync(Buffer.from(xml));
  const server = http.createServer((_q, res) => res.end(body)).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const d = await loadEpg(`http://127.0.0.1:${server.address().port}/epg.xml.gz`, {
      userAgent: 'test', from: now - 6 * 3600e3, to: now + 24 * 3600e3,
      wantIds: new Set(['a.de']), wantNames: new Set([M3U.normChannelName('Sender B')]),
      normName: M3U.normChannelName,
    });
    assert.deepEqual(Object.keys(d.channels).sort(), ['a.de', 'b.de']);
    assert.equal(d.channels['a.de'].list.length, 1);
    assert.equal(d.channels['a.de'].list[0][2], 'Jetzt & hier');
    assert.equal(d.channels['a.de'].list[0][3], 'Eine <Beschreibung>');
  } finally {
    server.close();
  }
});
