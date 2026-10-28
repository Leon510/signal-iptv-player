// M3U/M3U8-Parser für IPTV-Playlisten.
// Liest #EXTINF-Attribute (tvg-id, tvg-name, tvg-logo, group-title, tvg-chno),
// #EXTGRP-Gruppen und #EXTVLCOPT-Optionen. Gibt { epgUrl, channels } zurück.
(function () {
  const ATTR_RE = /([\w-]+)="([^"]*)"/g;

  function parseExtinf(line) {
    // "#EXTINF:-1 tvg-id="x" group-title="News, DE",Senderame"
    // Der Name steht nach dem ersten Komma AUSSERHALB von Anführungszeichen.
    const body = line.slice(line.indexOf(':') + 1);
    let inQuote = false;
    let split = -1;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === ',' && !inQuote) { split = i; break; }
    }
    const head = split >= 0 ? body.slice(0, split) : body;
    const name = split >= 0 ? body.slice(split + 1).trim() : '';
    const attrs = {};
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(head))) attrs[m[1].toLowerCase()] = m[2].trim();
    return { attrs, name };
  }

  function parseM3U(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const channels = [];
    let epgUrl = '';
    let pending = null;
    let pendingGroup = '';
    let pendingOpts = {};

    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('#EXTM3U')) {
        const m = line.match(/(?:url-tvg|x-tvg-url)="([^"]*)"/i);
        if (m) epgUrl = m[1].split(',')[0].trim();
        continue;
      }
      if (line.startsWith('#EXTINF')) {
        pending = parseExtinf(line);
        continue;
      }
      if (line.startsWith('#EXTGRP:')) {
        pendingGroup = line.slice(8).trim();
        continue;
      }
      if (line.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        if (eq > 0) pendingOpts[opt.slice(0, eq).trim()] = opt.slice(eq + 1).trim();
        continue;
      }
      if (line.startsWith('#')) continue;

      // Stream-URL
      const a = pending ? pending.attrs : {};
      const name = (pending && pending.name) || a['tvg-name'] || line.split('/').pop() || 'Unbenannt';
      channels.push({
        name,
        url: line,
        logo: a['tvg-logo'] || a['logo'] || '',
        group: a['group-title'] || pendingGroup || 'Ohne Gruppe',
        tvgId: a['tvg-id'] || '',
        chno: a['tvg-chno'] ? parseInt(a['tvg-chno'], 10) || null : null,
        ua: pendingOpts['http-user-agent'] || '',
      });
      pending = null;
      pendingGroup = '';
      pendingOpts = {};
    }

    return { epgUrl, channels };
  }

  // ---------- Inhaltstyp: Live-TV, Film oder Serienfolge ----------
  const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|mpg|mpeg)$/i;
  const LIVE_EXT = /\.(ts|m3u8)$/i;
  const EP_RE = /^(.*?)[\s._\-–|:]*\b[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})\b/;
  const EP_RE_X = /^(.*?)[\s._\-–|:]*\b(\d{1,2})x(\d{1,3})\b/;
  const SERIES_GROUP = /serie|series|staffel|tv[\s-]?shows?|episod/i;

  function classify(c) {
    let path = c.url;
    try { path = new URL(c.url).pathname; } catch {}
    path = path.toLowerCase();
    if (/\/series\//.test(path)) return 'series';
    if (/\/movies?\//.test(path)) return 'movie';
    if (/\/live\//.test(path) || LIVE_EXT.test(path)) return 'live';
    if (!VIDEO_EXT.test(path)) return 'live'; // z. B. Xtream-Live-Links ohne Endung
    if (EP_RE.test(c.name) || EP_RE_X.test(c.name) || SERIES_GROUP.test(c.group)) return 'series';
    return 'movie';
  }

  // "Dark S02 E05 – Titel" -> { show: "Dark", season: 2, episode: 5, title: "Titel" }
  function parseEpisode(name) {
    const m = name.match(EP_RE) || name.match(EP_RE_X);
    if (!m) return { show: name.trim(), season: 1, episode: null, title: '' };
    const show = m[1].replace(/[\s._\-–|:]+$/, '').trim() || name.trim();
    const rest = name.slice(m[0].length).replace(/^[\s._\-–|:]+/, '').trim();
    return { show, season: parseInt(m[2], 10), episode: parseInt(m[3], 10), title: rest };
  }

  // Jahreszahl am Ende als Zusatzinfo bei Filmen: "Inception (2010)"
  function parseMovie(name) {
    const m = name.match(/^(.*?)[\s(\[]*((?:19|20)\d{2})[)\]]*\s*$/);
    return m ? { title: m[1].trim() || name, year: m[2] } : { title: name, year: '' };
  }

  // Sendernamen für den Abgleich mit dem EPG vereinheitlichen:
  // "DE: Das Erste HD" und "Das Erste" -> "daserste"
  function normChannelName(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^\s*(\[[a-z]{2,3}\]|\|?[a-z]{2,3}\s*[|:])\s*/i, '')
      .replace(/\b(uhd|fhd|hd|sd|4k|8k|hevc|h\.?26[45]|50 ?fps|60 ?fps|raw|backup|vip|\+1)\b/g, ' ')
      .replace(/[ᴴᴰ]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  const api = { parseM3U, classify, parseEpisode, parseMovie, normChannelName };
  if (typeof module !== 'undefined') module.exports = api;
  else window.M3U = api;
})();
