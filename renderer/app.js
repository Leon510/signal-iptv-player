/* Signal – M3U-IPTV-Player (Renderer) */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.api;
  const M3U = window.M3U;
  const ROW_H = 56;
  const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';
  const SECTION_NAMES = { live: 'Live-TV', movie: 'Filme', series: 'Serien' };

  // ---------- Gespeicherter Zustand ----------
  let store = {
    playlists: [],        // { id, name, source: { type, value }, updatedAt, count }
    activeId: null,
    favorites: {},        // pid -> [url]
    recent: {},           // pid -> [url]
    lastChannel: {},      // pid -> url
    lastSection: {},      // pid -> 'live' | 'movie' | 'series'
    hidden: {},           // pid -> { groups: ['live|Gruppe'], items: [url] }
    progress: {},         // pid -> { url: { t, d, at } }
    volume: 0.8,
    muted: false,
    userAgent: DEFAULT_UA,
    buffer: 'normal',     // 'low' | 'normal' | 'high'
    autoRefresh: 'daily', // Playlisten automatisch aktualisieren: 'daily' | 'off'
    epgInfo: {},          // pid -> { fetchedAt, channels, matched, error }
    audioLang: '',        // bevorzugte Sprache für Tonspuren (ISO 639-2), z. B. 'deu'
  };

  // ---------- Laufzeit-Zustand ----------
  let all = [];               // alle Einträge der Playlist, mit .kind
  let liveIdx = [], movieIdx = [];
  let shows = [];             // { name, group, logo, eps: [i], s }
  let showOf = new Map();     // Eintrag -> Serie
  let epInfo = new Map();     // Eintrag -> { season, episode, title }
  let numberOf = new Map(), byNumber = new Map();
  let groupsBy = { live: [], movie: [], series: [] }; // [{ name, count }]

  let section = 'live';
  const filters = { live: 'all', movie: 'all', series: 'all' };
  let query = '';
  let visible = [];           // live/movie: Eintrag-Indizes, series: Serien-Indizes
  let selected = -1;          // Live: ausgewählter Eintrag
  let playing = -1;           // Eintrag, der gerade läuft
  let playingKind = null;     // 'live' | 'vod' | null
  let openShow = -1, openSeason = null;

  const saveStore = debounce(() => api.saveStore(store), 300);

  // ---------- Hilfsfunktionen ----------
  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const n = (x) => x.toLocaleString('de-DE');
  function initials(name) {
    const clean = name.replace(/\b(HD|FHD|UHD|4K|SD|HEVC|DE|AT|CH)\b|[|:\[\]()]/gi, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  let toastTimer;
  function toast(msg, action) {
    const t = $('toast');
    $('toastText').textContent = msg;
    const btn = $('toastAction');
    if (action) {
      btn.hidden = false;
      btn.textContent = action.label;
      btn.onclick = () => { t.classList.remove('show'); action.run(); };
    } else btn.hidden = true;
    t.classList.toggle('has-action', !!action);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2800);
  }

  const pid = () => store.activeId;
  const activePlaylist = () => store.playlists.find((p) => p.id === pid()) || null;
  const favSet = () => new Set(store.favorites[pid()] || []);
  function hiddenState() {
    return store.hidden[pid()] || (store.hidden[pid()] = { groups: [], items: [] });
  }
  let hiddenGroups = new Set(), hiddenItems = new Set();
  function refreshHiddenSets() {
    const h = hiddenState();
    hiddenGroups = new Set(h.groups);
    hiddenItems = new Set(h.items);
  }
  const isHidden = (i) => hiddenItems.has(all[i].url) || hiddenGroups.has(all[i].kind + '|' + all[i].group);
  const showHidden = (s) => hiddenGroups.has('series|' + shows[s].group);
  const progOf = (url) => (store.progress[pid()] || {})[url];
  function progState(url) {
    const p = progOf(url);
    if (!p || !p.d) return null;
    const f = p.t / p.d;
    return { ...p, f, watched: f >= 0.92, inProgress: p.t > 30 && f < 0.92 };
  }

  // ---------- Start ----------
  async function init() {
    const saved = await api.loadStore();
    if (saved) store = Object.assign(store, saved);
    for (const k of ['lastSection', 'hidden', 'progress']) if (!store[k]) store[k] = {};
    if (!store.buffer) store.buffer = 'normal';
    if (!store.autoRefresh) store.autoRefresh = 'daily';
    if (!store.epgInfo) store.epgInfo = {};
    if (!store.audioLang) store.audioLang = canonLang((navigator.language || '').split('-')[0]) || '';
    await api.setUserAgent(store.userAgent);
    document.body.classList.add('platform-' + api.platform);
    bindUI();
    setupPlayerUI();
    if (store.playlists.length) {
      if (!activePlaylist()) store.activeId = store.playlists[0].id;
      await openPlaylist(store.activeId);
    } else {
      showWelcome();
    }
  }

  function showWelcome() {
    $('layout').classList.add('is-welcome');
    $('welcome').hidden = false;
    for (const id of ['rail', 'listPane', 'vodPane', 'stage', 'playlistSwitch', 'searchWrap', 'sections']) $(id).hidden = true;
    player.stop();
    setTimeout(() => $('welcomeUrl').focus(), 50);
  }

  // ---------- Playlisten ----------
  async function addPlaylist({ name, url, file }) {
    let text, source;
    if (file) {
      text = file.text;
      source = { type: 'file', value: file.path };
      name = name || file.name;
    } else {
      text = await api.fetchPlaylist(url);
      source = { type: 'url', value: url };
      if (!name) {
        try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { name = 'Playlist'; }
      }
    }
    const parsed = M3U.parseM3U(text);
    if (!parsed.channels.length) throw new Error('In dieser Datei wurden keine Sender gefunden. Ist es wirklich eine M3U-Playlist?');
    const id = uid();
    await api.saveChannels(id, parsed);
    store.playlists.push({ id, name, source, updatedAt: Date.now(), count: parsed.channels.length });
    store.activeId = id;
    saveStore();
    await openPlaylist(id);
    toast(`${n(parsed.channels.length)} Einträge geladen`);
  }

  async function fetchAndSave(pl) {
    const text = pl.source.type === 'url' ? await api.fetchPlaylist(pl.source.value) : await api.readFile(pl.source.value);
    const parsed = M3U.parseM3U(text);
    if (!parsed.channels.length) throw new Error('Die Playlist ist jetzt leer.');
    await api.saveChannels(pl.id, parsed);
    pl.updatedAt = Date.now();
    pl.count = parsed.channels.length;
    saveStore();
    return parsed;
  }

  async function refreshPlaylist(id) {
    const pl = store.playlists.find((p) => p.id === id);
    if (!pl) return;
    const parsed = await fetchAndSave(pl);
    if (id === pid()) await openPlaylist(id, { keepSection: true });
    return parsed.channels.length;
  }

  // Automatisch im Hintergrund aktualisieren (einmal am Tag). Läuft gerade etwas,
  // wird die neue Liste erst beim nächsten Öffnen übernommen, damit nichts abbricht.
  const refreshing = new Set();
  async function autoRefreshIfStale(id) {
    const pl = store.playlists.find((p) => p.id === id);
    if (!pl || store.autoRefresh === 'off' || pl.source.type !== 'url' || refreshing.has(id)) return;
    if (Date.now() - (pl.updatedAt || 0) < 24 * 3600e3) return;
    refreshing.add(id);
    try {
      const before = pl.count;
      const parsed = await fetchAndSave(pl);
      if (id === pid() && playing < 0 && !document.querySelector('dialog[open]')) {
        await openPlaylist(id, { keepSection: true, skipAutoRefresh: true });
        if (parsed.channels.length !== before) toast(`Playlist aktualisiert: ${n(parsed.channels.length)} Einträge`);
      }
    } catch (e) {
      // still: beim nächsten Start erneut versuchen
    } finally {
      refreshing.delete(id);
    }
  }

  async function removePlaylist(id) {
    store.playlists = store.playlists.filter((p) => p.id !== id);
    for (const k of ['favorites', 'recent', 'lastChannel', 'lastSection', 'hidden', 'progress', 'epgInfo']) delete store[k][id];
    await api.deleteChannels(id);
    await api.deleteEpg(id);
    if (pid() === id) {
      store.activeId = store.playlists[0] ? store.playlists[0].id : null;
      if (pid()) await openPlaylist(pid());
      else showWelcome();
    }
    saveStore();
    renderPlaylistSelect();
  }

  async function openPlaylist(id, { keepSection = false, skipAutoRefresh = false } = {}) {
    const prevSection = section;
    let data = await api.loadChannels(id);
    if (!data) {
      try { await refreshPlaylist(id); return; } catch (e) {
        toast(`Playlist konnte nicht geladen werden: ${e.message}`);
        data = { channels: [] };
      }
    }
    store.activeId = id;
    player.stop();
    playing = -1;
    playingKind = null;
    prevChannel = -1;
    document.body.classList.remove('vod-playing');
    $('osd').classList.remove('show');
    closeGuide(true);
    indexEntries(data.channels || []);
    playlistEpgUrl = data.epgUrl || '';
    const plMeta = activePlaylist();
    if (plMeta) plMeta.counts = sectionCounts();
    refreshHiddenSets();
    filters.live = filters.movie = filters.series = 'all';
    query = '';
    $('search').value = '';
    openShow = -1;

    $('layout').classList.remove('is-welcome');
    $('welcome').hidden = true;
    for (const id2 of ['rail', 'playlistSwitch', 'searchWrap']) $(id2).hidden = false;
    renderPlaylistSelect();
    renderSectionTabs();

    const counts = sectionCounts();
    let sec = keepSection && prevSection ? prevSection : store.lastSection[id];
    if (!sec || !counts[sec]) sec = ['live', 'movie', 'series'].find((s) => counts[s]) || 'live';
    section = null;
    setSection(sec);

    if (sec === 'live') {
      const last = store.lastChannel[id];
      const idx = last ? all.findIndex((c) => c.url === last) : -1;
      selected = idx >= 0 && !isHidden(idx) ? idx : (visible[0] ?? -1);
      scrollToSelected(true);
      renderList();
    }
    saveStore();
    loadEpgFor(id);
    if (!skipAutoRefresh) autoRefreshIfStale(id);
  }

  // Einträge nach Typ aufteilen, Serien bündeln, Sendernummern vergeben
  function indexEntries(entries) {
    all = entries;
    liveIdx = []; movieIdx = [];
    shows = []; showOf = new Map(); epInfo = new Map();
    const showKey = new Map();
    const gmap = { live: new Map(), movie: new Map(), series: new Map() };

    all.forEach((c, i) => {
      c.kind = M3U.classify(c);
      c.s = norm(c.name);
      if (c.kind === 'live') liveIdx.push(i);
      else if (c.kind === 'movie') {
        movieIdx.push(i);
        const m = M3U.parseMovie(c.name);
        c.title = m.title; c.year = m.year;
      } else {
        const ep = M3U.parseEpisode(c.name);
        epInfo.set(i, ep);
        const key = norm(ep.show) + '|' + c.group;
        let s = showKey.get(key);
        if (s === undefined) {
          s = shows.length;
          showKey.set(key, s);
          shows.push({ name: ep.show, group: c.group, logo: c.logo, eps: [], s: norm(ep.show) });
        }
        if (!shows[s].logo && c.logo) shows[s].logo = c.logo;
        shows[s].eps.push(i);
        showOf.set(i, s);
      }
    });
    for (const sh of shows) {
      sh.eps.sort((a, b) => {
        const ea = epInfo.get(a), eb = epInfo.get(b);
        return ea.season - eb.season || (ea.episode ?? 1e9) - (eb.episode ?? 1e9) || a - b;
      });
      sh.seasons = [...new Set(sh.eps.map((i) => epInfo.get(i).season))];
      gmap.series.set(sh.group, (gmap.series.get(sh.group) || 0) + 1);
    }
    for (const i of liveIdx) gmap.live.set(all[i].group, (gmap.live.get(all[i].group) || 0) + 1);
    for (const i of movieIdx) gmap.movie.set(all[i].group, (gmap.movie.get(all[i].group) || 0) + 1);
    for (const k of Object.keys(gmap)) groupsBy[k] = [...gmap[k]].map(([name, count]) => ({ name, count }));

    // Sendernummern: tvg-chno, sonst Position. Bleiben stabil, auch wenn Sender ausgeblendet werden.
    numberOf = new Map(); byNumber = new Map();
    const used = new Set(liveIdx.map((i) => all[i].chno).filter(Boolean));
    let next = 1;
    for (const i of liveIdx) {
      let num = all[i].chno;
      if (!num || byNumber.has(num)) {
        while (used.has(next) || byNumber.has(next)) next++;
        num = next++;
      }
      numberOf.set(i, num);
      byNumber.set(num, i);
    }
  }

  function sectionCounts() {
    return { live: liveIdx.length, movie: movieIdx.length, series: shows.length };
  }

  // ---------- Bereiche ----------
  function renderSectionTabs() {
    const counts = sectionCounts();
    const present = Object.keys(counts).filter((k) => counts[k]);
    $('sections').hidden = present.length < 2;
    $('sections').querySelectorAll('button').forEach((b) => {
      b.hidden = !counts[b.dataset.section];
      b.setAttribute('aria-selected', b.dataset.section === section ? 'true' : 'false');
    });
  }

  function setSection(sec) {
    if (sec === section) return;
    closeGuide(true);
    if (playingKind === 'vod') closeVod();
    if (section === 'live' && sec !== 'live' && playingKind === 'live') {
      player.stop();
      playing = -1;
      playingKind = null;
    }
    section = sec;
    store.lastSection[pid()] = sec;
    openShow = -1;
    $('layout').dataset.section = sec;
    const isLive = sec === 'live';
    $('listPane').hidden = !isLive;
    $('vodPane').hidden = isLive;
    $('stage').hidden = !isLive;
    $('showView').hidden = true;
    $('vodBrowse').hidden = false;
    $('search').placeholder = isLive ? 'Alle Sender durchsuchen' : sec === 'movie' ? 'Alle Filme durchsuchen' : 'Alle Serien durchsuchen';
    $('idle').querySelector('p').textContent = 'Wähle links einen Sender.';
    renderSectionTabs();
    renderRail();
    applyFilter();
    saveStore();
  }

  // ---------- Kategorien links ----------
  function countsLabel(p) {
    const c = p.counts;
    if (!c) return `${n(p.count || 0)} Einträge`;
    const parts = [];
    if (c.live) parts.push(`${n(c.live)} Sender`);
    if (c.movie) parts.push(`${n(c.movie)} ${c.movie === 1 ? 'Film' : 'Filme'}`);
    if (c.series) parts.push(`${n(c.series)} ${c.series === 1 ? 'Serie' : 'Serien'}`);
    return parts.join(', ') || 'leer';
  }

  function renderPlaylistSelect() {
    const pl = activePlaylist();
    $('plName').textContent = pl ? pl.name : 'Playlist';
    if (!$('plMenu').hidden) renderPlaylistMenu();
  }

  function renderPlaylistMenu() {
    const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12.5 4.2 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $('plMenu').innerHTML = '<p class="menu-title">Playlist wechseln</p>' +
      store.playlists.map((p, k) =>
        `<button class="menu-item${p.id === pid() ? ' on' : ''}" data-pl="${esc(p.id)}" role="menuitemradio" aria-checked="${p.id === pid()}">` +
        `<span class="menu-check" aria-hidden="true">${p.id === pid() ? CHECK : ''}</span>` +
        `<span class="menu-label">${esc(p.name)}<small>${esc(countsLabel(p))}</small></span>` +
        (k < 9 ? `<kbd>Strg ${k + 1}</kbd>` : '') + `</button>`).join('') +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item plain" data-pl-action="add"><span class="menu-check" aria-hidden="true">+</span><span class="menu-label">Playlist hinzufügen</span></button>' +
      '<button class="menu-item plain" data-pl-action="manage"><span class="menu-check" aria-hidden="true"></span><span class="menu-label">Playlisten verwalten</span></button>';
  }

  function togglePlaylistMenu(force) {
    const m = $('plMenu');
    const open = force ?? m.hidden;
    if (open) renderPlaylistMenu();
    m.hidden = !open;
    $('plBtn').setAttribute('aria-expanded', String(open));
  }

  async function switchPlaylist(id) {
    togglePlaylistMenu(false);
    if (!id || id === pid()) return;
    await openPlaylist(id);
    toast(`Playlist „${activePlaylist().name}“`);
  }

  const EYE_OFF = '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2-2.5 3.2M6.5 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 10a3 3 0 0 0 4.1 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderRail() {
    const f = filters[section];
    const searching = !!query.trim();
    const item = (key, label, count, groupName) =>
      `<div class="rail-item${!searching && f === key ? ' active' : ''}" data-filter="${esc(key)}" role="button" tabindex="0" title="${esc(label)}">` +
      `<span class="label">${esc(label)}</span><span class="n">${n(count)}</span>` +
      (groupName !== undefined ? `<button class="rail-hide" data-hide-group="${esc(groupName)}" aria-label="Gruppe ${esc(groupName)} ausblenden" title="Gruppe ausblenden">${EYE_OFF}</button>` : '') +
      `</div>`;

    let html = '';
    if (section === 'live') {
      const total = liveIdx.reduce((a, i) => a + (isHidden(i) ? 0 : 1), 0);
      const fav = favSet();
      const favCount = liveIdx.reduce((a, i) => a + (fav.has(all[i].url) && !isHidden(i) ? 1 : 0), 0);
      html += item('all', 'Alle Sender', total) + item('fav', 'Favoriten', favCount) +
        item('recent', 'Zuletzt gesehen', (store.recent[pid()] || []).length);
    } else if (section === 'movie') {
      const total = movieIdx.reduce((a, i) => a + (isHidden(i) ? 0 : 1), 0);
      html += item('all', 'Alle Filme', total) + item('continue', 'Weiterschauen', continueList('movie').length);
    } else {
      const total = shows.reduce((a, _, s) => a + (showHidden(s) ? 0 : 1), 0);
      html += item('all', 'Alle Serien', total) + item('continue', 'Weiterschauen', continueList('series').length);
    }

    const groups = groupsBy[section];
    const shown = groups.filter((g) => !hiddenGroups.has(section + '|' + g.name));
    const hiddenCount = groups.length - shown.length;
    if (groups.length > 1 || hiddenCount) {
      html += `<div class="rail-head"><h3>Gruppen</h3><button class="btn link small" id="railEdit">${hiddenCount ? `${n(hiddenCount)} ausgeblendet` : 'Auswählen'}</button></div>`;
      html += shown.map((g) => item('g:' + g.name, g.name, groupVisibleCount(g.name), g.name)).join('');
    }
    $('rail').innerHTML = html;
  }

  function groupVisibleCount(name) {
    if (section === 'live') return liveIdx.reduce((a, i) => a + (all[i].group === name && !hiddenItems.has(all[i].url) ? 1 : 0), 0);
    return groupsBy[section].find((g) => g.name === name)?.count || 0;
  }

  // ---------- Filtern und Suchen ----------
  function sectionSearch(sec, q) {
    const qn = norm(q);
    if (sec === 'live') {
      const asNum = /^\d+$/.test(q) ? parseInt(q, 10) : null;
      return liveIdx.filter((i) => !isHidden(i) && (all[i].s.includes(qn) || numberOf.get(i) === asNum));
    }
    if (sec === 'movie') return movieIdx.filter((i) => !isHidden(i) && all[i].s.includes(qn));
    return shows.map((_, s) => s).filter((s) => !showHidden(s) && shows[s].s.includes(qn));
  }

  function continueList(kind) {
    const prog = store.progress[pid()] || {};
    if (kind === 'movie') {
      return movieIdx
        .filter((i) => !isHidden(i) && progState(all[i].url)?.inProgress)
        .sort((a, b) => prog[all[b].url].at - prog[all[a].url].at);
    }
    const latest = new Map();
    for (const [s, sh] of shows.entries()) {
      if (showHidden(s)) continue;
      let at = 0;
      for (const i of sh.eps) { const p = prog[all[i].url]; if (p && p.at > at) at = p.at; }
      if (at) latest.set(s, at);
    }
    return [...latest.keys()].filter((s) => nextUp(s) !== null).sort((a, b) => latest.get(b) - latest.get(a));
  }

  function applyFilter() {
    const q = query.trim();
    const f = filters[section];
    let title;
    if (q) {
      visible = sectionSearch(section, q);
      title = `Suche: „${q}“`;
    } else if (section === 'live') {
      title = f === 'all' ? 'Alle Sender' : f === 'fav' ? 'Favoriten' : f === 'recent' ? 'Zuletzt gesehen' : f.slice(2);
      if (f === 'fav') {
        const pos = new Map(liveIdx.map((i) => [all[i].url, i]));
        visible = (store.favorites[pid()] || []).map((u) => pos.get(u)).filter((i) => i !== undefined && !isHidden(i));
      } else if (f === 'recent') {
        const pos = new Map(liveIdx.map((i) => [all[i].url, i]));
        visible = (store.recent[pid()] || []).map((u) => pos.get(u)).filter((i) => i !== undefined && !isHidden(i));
      } else if (f.startsWith('g:')) {
        const g = f.slice(2);
        visible = liveIdx.filter((i) => all[i].group === g && !isHidden(i));
      } else visible = liveIdx.filter((i) => !isHidden(i));
      if (f !== 'recent' && f !== 'fav') visible.sort((a, b) => numberOf.get(a) - numberOf.get(b));
    } else if (section === 'movie') {
      title = f === 'all' ? 'Alle Filme' : f === 'continue' ? 'Weiterschauen' : f.slice(2);
      if (f === 'continue') visible = continueList('movie');
      else if (f.startsWith('g:')) visible = movieIdx.filter((i) => all[i].group === f.slice(2) && !isHidden(i));
      else visible = movieIdx.filter((i) => !isHidden(i));
    } else {
      title = f === 'all' ? 'Alle Serien' : f === 'continue' ? 'Weiterschauen' : f.slice(2);
      if (f === 'continue') visible = continueList('series');
      else if (f.startsWith('g:')) visible = shows.map((_, s) => s).filter((s) => shows[s].group === f.slice(2) && !showHidden(s));
      else visible = shows.map((_, s) => s).filter((s) => !showHidden(s));
    }

    const isLive = section === 'live';
    const unit = isLive ? 'Sender' : section === 'movie' ? 'Filme' : 'Serien';
    $(isLive ? 'listTitle' : 'vodTitle').textContent = title;
    $(isLive ? 'listCount' : 'vodCount').textContent = `${n(visible.length)} ${visible.length === 1 && unit !== 'Sender' ? unit.replace(/e$|n$/, '') : unit}`;

    // Treffer in den anderen Bereichen anbieten
    const also = $(isLive ? 'listAlso' : 'vodAlso');
    $(isLive ? 'vodAlso' : 'listAlso').hidden = true;
    if (q) {
      const counts = sectionCounts();
      const parts = ['live', 'movie', 'series']
        .filter((s) => s !== section && counts[s])
        .map((s) => [s, sectionSearch(s, q).length])
        .filter(([, c]) => c);
      also.hidden = !parts.length;
      also.innerHTML = parts.length ? 'Auch gefunden in ' + parts.map(([s, c]) =>
        `<button class="chip" data-goto="${s}">${SECTION_NAMES[s]} <b>${n(c)}</b></button>`).join(' ') : '';
    } else also.hidden = true;

    const empty = $(isLive ? 'listEmpty' : 'vodEmpty');
    if (!visible.length) {
      empty.hidden = false;
      empty.textContent = q ? 'Hier passt nichts zu deiner Suche.'
        : f === 'fav' ? 'Noch keine Favoriten. Markiere Sender mit dem Stern.'
        : f === 'recent' ? 'Hier erscheinen die Sender, die du zuletzt geschaut hast.'
        : f === 'continue' ? 'Angefangene Filme und Serien erscheinen hier.'
        : 'Hier ist nichts sichtbar. Prüfe, ob du Inhalte ausgeblendet hast.';
    } else empty.hidden = true;

    $('favHint').hidden = !(isLive && f === 'fav' && !q && visible.length > 1);
    if (isLive) {
      $('listSpacer').style.height = visible.length * ROW_H + 'px';
      $('listScroll').scrollTop = 0;
      renderList();
      if (guideOpen) { $('guideScroll').scrollTop = 0; renderGuide(true); }
    } else {
      $('gridScroll').scrollTop = 0;
      renderGrid();
    }
  }

  // ---------- Live: virtuelle Senderliste ----------
  function renderList() {
    if (section !== 'live') return;
    const scroll = $('listScroll');
    const top = scroll.scrollTop;
    const h = scroll.clientHeight || 800;
    const start = Math.max(0, Math.floor(top / ROW_H) - 6);
    const end = Math.min(visible.length, Math.ceil((top + h) / ROW_H) + 6);
    const fav = favSet();
    const nowT = Date.now();
    const favMode = filters.live === 'fav' && !query.trim();
    let html = '';
    for (let pos = start; pos < end; pos++) {
      const i = visible[pos];
      const c = all[i];
      const cls = ['row'];
      if (i === selected) cls.push('selected');
      if (i === playing) cls.push('playing');
      const isFav = fav.has(c.url);
      const logo = c.logo
        ? `<img src="${esc(c.logo)}" alt="" loading="lazy" decoding="async" data-fallback="${esc(initials(c.name))}">`
        : esc(initials(c.name));
      const nn = epgOf.size ? nowNext(i, nowT) : null;
      const sub = nn && nn.now
        ? `<span class="grp epg"><span class="epg-title">${esc(nn.now[2])}</span><span class="epg-bar"><span style="width:${progPct(nn.now, nowT).toFixed(1)}%"></span></span></span>`
        : `<span class="grp">${esc(c.group)}</span>`;
      if (favMode) cls.push('draggable');
      html += `<div class="${cls.join(' ')}" style="top:${pos * ROW_H}px" data-i="${i}" role="button" aria-label="${esc(c.name)} abspielen"${favMode ? ' draggable="true"' : ''}` +
        `${nn && nn.now ? ` title="${esc(hm(nn.now[0]))}–${esc(hm(nn.now[1]))} ${esc(nn.now[2])}${nn.next ? `\nDanach ${esc(hm(nn.next[0]))} ${esc(nn.next[2])}` : ''}"` : ''}>` +
        `<span class="num">${numberOf.get(i)}</span>` +
        `<span class="logo">${logo}</span>` +
        `<span class="meta"><span class="name">${esc(c.name)}</span>${sub}</span>` +
        `<button class="row-btn hide" data-hide="${i}" aria-label="Sender ausblenden" title="Ausblenden (H)">${EYE_OFF}</button>` +
        `<button class="row-btn star${isFav ? ' on' : ''}" data-star="${i}" aria-label="${isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}" title="Favorit (S)">` +
        `<svg viewBox="0 0 24 24" width="16" height="16"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>` +
        `</button></div>`;
    }
    scroll.querySelectorAll('.row').forEach((r) => r.remove());
    scroll.insertAdjacentHTML('beforeend', html);
  }

  function scrollToSelected(center) {
    const pos = visible.indexOf(selected);
    if (pos < 0) return;
    const scroll = $('listScroll');
    const y = pos * ROW_H;
    if (center) scroll.scrollTop = y - scroll.clientHeight / 2 + ROW_H / 2;
    else if (y < scroll.scrollTop) scroll.scrollTop = y;
    else if (y + ROW_H > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW_H - scroll.clientHeight;
  }

  // Favorit an Position "to" der sichtbaren Favoritenliste verschieben
  function moveFavorite(url, to) {
    const order = visible.map((i) => all[i].url);
    const from = order.indexOf(url);
    if (from < 0) return;
    order.splice(from, 1);
    order.splice(to > from ? to - 1 : to, 0, url);
    const rest = (store.favorites[pid()] || []).filter((u) => !order.includes(u));
    store.favorites[pid()] = order.concat(rest);
    saveStore();
    const keep = $('listScroll').scrollTop;
    applyFilter();
    $('listScroll').scrollTop = keep;
    renderList();
  }

  function toggleFavorite(i) {
    const url = all[i].url;
    const list = store.favorites[pid()] || (store.favorites[pid()] = []);
    const at = list.indexOf(url);
    if (at >= 0) list.splice(at, 1); else list.push(url);
    saveStore();
    renderRail();
    if (filters.live === 'fav' && !query) applyFilter(); else renderList();
  }

  // ---------- Aussortieren ----------
  function hideChannel(i) {
    const c = all[i];
    const h = hiddenState();
    if (!h.items.includes(c.url)) h.items.push(c.url);
    refreshHiddenSets();
    const pos = visible.indexOf(i);
    afterHiddenChange();
    if (selected === i) selected = visible[Math.min(pos, visible.length - 1)] ?? -1;
    renderList();
    toast(`„${c.name}“ ausgeblendet`, {
      label: 'Rückgängig',
      run: () => { h.items = h.items.filter((u) => u !== c.url); refreshHiddenSets(); afterHiddenChange(); },
    });
  }

  function hideGroup(sec, name) {
    const key = sec + '|' + name;
    const h = hiddenState();
    if (!h.groups.includes(key)) h.groups.push(key);
    refreshHiddenSets();
    if (filters[sec] === 'g:' + name) filters[sec] = 'all';
    afterHiddenChange();
    toast(`Gruppe „${name}“ ausgeblendet`, {
      label: 'Rückgängig',
      run: () => { h.groups = h.groups.filter((g) => g !== key); refreshHiddenSets(); afterHiddenChange(); },
    });
  }

  function afterHiddenChange() {
    saveStore();
    renderRail();
    const scrollEl = $(section === 'live' ? 'listScroll' : 'gridScroll');
    const keep = scrollEl.scrollTop;
    applyFilter();
    scrollEl.scrollTop = keep;
    if (section === 'live') renderList(); else renderGrid();
  }

  // ---------- Filme & Serien: Poster-Raster ----------
  const CARD_MIN = 168, GAP = 18, PAD = 18;
  let gridGeo = { cols: 1, cardW: CARD_MIN, rowH: 300 };

  function computeGrid() {
    const w = $('gridScroll').clientWidth - PAD * 2;
    const cols = Math.max(2, Math.floor((w + GAP) / (CARD_MIN + GAP)));
    const cardW = (w - GAP * (cols - 1)) / cols;
    gridGeo = { cols, cardW, rowH: Math.round(cardW * 1.5 + 62 + GAP) };
  }

  function posterHtml(title, logo, prog) {
    const img = logo
      ? `<img src="${esc(logo)}" alt="" loading="lazy" decoding="async">`
      : '';
    const ph = `<span class="poster-ph">${esc(title)}</span>`;
    let badge = '';
    if (prog?.watched) badge = '<span class="watched" title="Gesehen"><svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12.5 4.2 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    const bar = prog?.inProgress ? `<span class="pbar"><span style="width:${Math.round(prog.f * 100)}%"></span></span>` : '';
    return `<span class="poster">${ph}${img}${badge}${bar}</span>`;
  }

  function renderGrid() {
    if (section === 'live' || $('vodBrowse').hidden) return;
    computeGrid();
    const { cols, cardW, rowH } = gridGeo;
    const scroll = $('gridScroll');
    const rows = Math.ceil(visible.length / cols);
    $('gridSpacer').style.height = rows * rowH + PAD + 'px';
    const top = scroll.scrollTop, h = scroll.clientHeight || 800;
    const r0 = Math.max(0, Math.floor(top / rowH) - 2);
    const r1 = Math.min(rows, Math.ceil((top + h) / rowH) + 2);
    let html = '';
    for (let r = r0; r < r1; r++) {
      for (let c = 0; c < cols; c++) {
        const pos = r * cols + c;
        if (pos >= visible.length) break;
        const style = `top:${PAD + r * rowH}px;left:${PAD + c * (cardW + GAP)}px;width:${cardW}px`;
        if (section === 'movie') {
          const i = visible[pos], e = all[i];
          const meta = [e.year, e.group].filter(Boolean).join(', ');
          html += `<div class="card" style="${style}" data-movie="${i}" role="button" tabindex="0" aria-label="${esc(e.title)} abspielen">` +
            posterHtml(e.title, e.logo, progState(e.url)) +
            `<span class="card-title">${esc(e.title)}</span><span class="card-meta">${esc(meta)}</span></div>`;
        } else {
          const s = visible[pos], sh = shows[s];
          const up = filters.series === 'continue' ? nextUp(s) : null;
          const meta = up !== null ? `Weiter mit ${epLabel(up)}` : seasonsLabel(sh);
          html += `<div class="card" style="${style}" data-show="${s}" role="button" tabindex="0" aria-label="${esc(sh.name)} öffnen">` +
            posterHtml(sh.name, sh.logo, null) +
            `<span class="card-title">${esc(sh.name)}</span><span class="card-meta">${esc(meta)}</span></div>`;
        }
      }
    }
    scroll.querySelectorAll('.card').forEach((el) => el.remove());
    scroll.insertAdjacentHTML('beforeend', html);
  }

  function seasonsLabel(sh) {
    const s = sh.seasons.length, e = sh.eps.length;
    return `${s} ${s === 1 ? 'Staffel' : 'Staffeln'}, ${e} ${e === 1 ? 'Folge' : 'Folgen'}`;
  }
  function epLabel(i) {
    const ep = epInfo.get(i);
    return ep.episode != null ? `S${ep.season} F${ep.episode}` : all[i].name;
  }

  // Nächste Folge zum Weiterschauen: angefangene Folge, sonst die nach der zuletzt gesehenen
  function nextUp(s) {
    const sh = shows[s];
    const prog = store.progress[pid()] || {};
    let lastAt = 0, lastPos = -1;
    sh.eps.forEach((i, pos) => { const p = prog[all[i].url]; if (p && p.at > lastAt) { lastAt = p.at; lastPos = pos; } });
    if (lastPos < 0) return null;
    const ps = progState(all[sh.eps[lastPos]].url);
    if (ps && !ps.watched) return sh.eps[lastPos];
    return sh.eps[lastPos + 1] ?? null;
  }

  // ---------- Serien-Detailansicht ----------
  function openShowView(s, season) {
    openShow = s;
    const sh = shows[s];
    const up = nextUp(s);
    openSeason = season ?? (up !== null ? epInfo.get(up).season : sh.seasons[0]);
    $('vodBrowse').hidden = true;
    $('showView').hidden = false;
    $('showPoster').innerHTML = posterHtml(sh.name, sh.logo, null);
    $('showTitle').textContent = sh.name;
    $('showMeta').textContent = `${seasonsLabel(sh)}, ${sh.group}`;
    $('showPlay').textContent = up !== null ? `Weiterschauen: ${epLabel(up)}` : 'Ab Folge 1 abspielen';
    $('showPlay').dataset.ep = up !== null ? up : sh.eps[0];
    renderSeason();
    $('showView').scrollTop = 0;
  }

  function renderSeason() {
    const sh = shows[openShow];
    $('seasonTabs').hidden = sh.seasons.length < 2;
    $('seasonTabs').innerHTML = sh.seasons.map((se) =>
      `<button role="tab" data-season="${se}" aria-selected="${se === openSeason}">Staffel ${se}</button>`).join('');
    const eps = sh.eps.filter((i) => epInfo.get(i).season === openSeason);
    $('episodeList').innerHTML = eps.map((i, k) => {
      const ep = epInfo.get(i);
      const ps = progState(all[i].url);
      const num = ep.episode ?? k + 1;
      const title = ep.title || (ep.episode != null ? `Folge ${num}` : all[i].name);
      const state = ps?.watched ? '<span class="ep-state done">Gesehen</span>'
        : ps?.inProgress ? `<span class="ep-state">noch ${fmtTime(ps.d - ps.t)}</span>` : '';
      const bar = ps?.inProgress ? `<span class="pbar"><span style="width:${Math.round(ps.f * 100)}%"></span></span>` : '';
      return `<li class="episode${i === playing ? ' playing' : ''}${ps?.watched ? ' is-watched' : ''}" data-ep="${i}" role="button" tabindex="0">` +
        `<span class="ep-num">${num}</span><span class="ep-title">${esc(title)}${bar}</span>${state}` +
        `<svg class="ep-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg></li>`;
    }).join('');
  }

  function closeShowView() {
    openShow = -1;
    $('showView').hidden = true;
    $('vodBrowse').hidden = false;
    renderRail();
    renderGrid();
  }

  // ---------- Programmführer (EPG) ----------
  let playlistEpgUrl = '';      // url-tvg aus dem Playlist-Kopf
  let epgOf = new Map();        // Eintrag -> [[start, stop, title, desc, subtitle], …]
  let epgLoadToken = 0;

  const effectiveEpgUrl = (id) => {
    const pl = store.playlists.find((p) => p.id === id);
    return (pl && pl.epgUrl) || (id === pid() ? playlistEpgUrl : '');
  };

  // Gespeicherte Daten sofort zeigen, veraltete (über 12 h) im Hintergrund nachladen
  async function loadEpgFor(id, { force = false } = {}) {
    const token = ++epgLoadToken;
    const url = effectiveEpgUrl(id);
    let data = await api.loadEpg(id);
    if (token !== epgLoadToken || id !== pid()) return;
    if (data && (!url || data.url === url)) applyEpg(data);
    else applyEpg(null);
    if (!url) return;
    const stale = !data || data.url !== url || Date.now() - data.fetchedAt > 12 * 3600e3;
    if (!stale && !force) return;
    const want = {
      ids: liveIdx.map((i) => all[i].tvgId).filter(Boolean),
      names: [...new Set(liveIdx.map((i) => M3U.normChannelName(all[i].name)).filter(Boolean))],
    };
    try {
      data = await api.updateEpg(id, url, want);
      if (token !== epgLoadToken || id !== pid()) return;
      applyEpg(data);
      store.epgInfo[id] = { fetchedAt: data.fetchedAt, matched: epgMatchedCount(), channels: Object.keys(data.channels).length };
      if (force) toast(`Programmdaten geladen: ${n(store.epgInfo[id].matched)} Sender`);
    } catch (e) {
      store.epgInfo[id] = { ...(store.epgInfo[id] || {}), error: friendlyLoadError(e).replace(/\.$/, '') };
      if (force) toast(`Programmdaten konnten nicht geladen werden: ${store.epgInfo[id].error}`);
    }
    saveStore();
    if ($('settingsDialog').open) renderManage();
  }

  const epgMatchedCount = () => liveIdx.reduce((a, i) => a + (epgOf.has(i) ? 1 : 0), 0);

  // Sender der Playlist mit EPG-Sendern verbinden: zuerst tvg-id, dann Name
  function applyEpg(data) {
    epgOf = new Map();
    if (data && data.channels) {
      const byId = new Map(), byName = new Map();
      for (const [id, ch] of Object.entries(data.channels)) {
        byId.set(id.toLowerCase(), ch.list);
        for (const nm of ch.names) {
          const k = M3U.normChannelName(nm);
          if (k && !byName.has(k)) byName.set(k, ch.list);
        }
      }
      for (const i of liveIdx) {
        const c = all[i];
        const list = (c.tvgId && byId.get(c.tvgId.toLowerCase())) || byName.get(M3U.normChannelName(c.name));
        if (list && list.length) epgOf.set(i, list);
      }
    }
    if (section === 'live') renderList();
    if (guideOpen) renderGuide(true);
  }

  // Sendung zum Zeitpunkt t (binäre Suche)
  function progIndexAt(list, t) {
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][1] <= t) lo = mid + 1;
      else if (list[mid][0] > t) hi = mid - 1;
      else return mid;
    }
    return -1;
  }
  function nowNext(i, t = Date.now()) {
    const list = epgOf.get(i);
    if (!list) return null;
    const k = progIndexAt(list, t);
    if (k < 0) {
      const nx = list.find((p) => p[0] > t);
      return nx ? { now: null, next: nx } : null;
    }
    return { now: list[k], next: list[k + 1] || null };
  }
  const hm = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const progPct = (p, t = Date.now()) => Math.max(0, Math.min(100, ((t - p[0]) / (p[1] - p[0])) * 100));

  // Fortschrittsbalken in Liste und Senderanzeige jede halbe Minute auffrischen
  setInterval(() => {
    if (!epgOf.size) return;
    if (section === 'live' && !guideOpen) renderList();
    if (guideOpen) updateNowLine();
  }, 30000);

  // ---------- Programmübersicht (Zeitraster) ----------
  const G_HOUR = 300;     // Pixel pro Stunde
  const G_ROW = 56;       // Zeilenhöhe
  const G_CH = 230;       // Breite der Senderspalte
  const G_RULER = 36;     // Höhe der Zeitleiste
  let guideOpen = false;
  let guideStart = 0, guideEnd = 0;
  const gx = (t) => ((t - guideStart) / 3600e3) * G_HOUR;

  function openGuide() {
    if (section !== 'live') return;
    guideOpen = true;
    $('layout').classList.add('guide-open');
    $('guidePane').hidden = false;
    $('listPane').hidden = true;
    $('stage').hidden = true;
    const now = Date.now();
    const start = new Date(now - 2 * 3600e3);
    start.setMinutes(0, 0, 0);
    guideStart = start.getTime();
    guideEnd = guideStart + 4 * 24 * 3600e3;
    $('guideCanvas').style.width = G_CH + gx(guideEnd) + 'px';
    renderGuide(true);
    scrollGuideTo(now - 30 * 60000);
    // Laufender Sender oben sichtbar
    const pos = visible.indexOf(playing >= 0 ? playing : selected);
    if (pos > 3) $('guideScroll').scrollTop = (pos - 2) * G_ROW;
    if (!epgOf.size) {
      $('guideEmpty').hidden = false;
      $('guideEmpty').textContent = effectiveEpgUrl(pid())
        ? 'Die Programmdaten werden geladen oder passen zu keinem Sender dieser Playlist.'
        : 'Diese Playlist bringt keinen Programmführer mit. Trag in den Einstellungen unter „Bearbeiten“ einen EPG-Link ein.';
    } else $('guideEmpty').hidden = true;
  }

  function closeGuide(silent) {
    if (!guideOpen) return;
    guideOpen = false;
    $('layout').classList.remove('guide-open');
    $('guidePane').hidden = true;
    $('guideDetail').hidden = true;
    if (!silent && section === 'live') {
      $('listPane').hidden = false;
      $('stage').hidden = false;
      renderList();
    }
  }

  function scrollGuideTo(t) {
    $('guideScroll').scrollLeft = Math.max(0, gx(t));
    renderGuide();
  }

  function updateNowLine() {
    const x = G_CH + gx(Date.now());
    $('guideNow').style.left = x + 'px';
    $('guideNow').style.height = G_RULER + visible.length * G_ROW + 'px';
  }

  function renderGuide(full) {
    if (!guideOpen) return;
    const sc = $('guideScroll');
    const canvas = $('guideCanvas');
    canvas.style.height = G_RULER + visible.length * G_ROW + 'px';
    const left = sc.scrollLeft, top = sc.scrollTop, w = sc.clientWidth, h = sc.clientHeight;
    const tFrom = guideStart + ((left - 2 * G_HOUR) / G_HOUR) * 3600e3;
    const tTo = guideStart + ((left + w) / G_HOUR) * 3600e3 + 3600e3;
    const r0 = Math.max(0, Math.floor((top - G_RULER) / G_ROW) - 3);
    const r1 = Math.min(visible.length, Math.ceil((top + h) / G_ROW) + 3);
    const now = Date.now();

    // Zeitleiste (klebt oben)
    let ruler = '';
    const firstHalf = Math.floor(tFrom / 1800e3) * 1800e3;
    let lastDay = '';
    for (let t = Math.max(firstHalf, guideStart); t < tTo; t += 1800e3) {
      const d = new Date(t);
      const day = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
      const label = d.getHours() === 0 && d.getMinutes() === 0 && lastDay ? `<b>${esc(day)}</b> ${hm(t)}` : hm(t);
      lastDay = day;
      ruler += `<span class="g-tick${d.getMinutes() ? ' half' : ''}" style="left:${G_CH + gx(t)}px">${label}</span>`;
    }
    const leftDay = new Date(guideStart + (left / G_HOUR) * 3600e3)
      .toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
    ruler += `<span class="g-corner" style="left:${left}px">${esc(leftDay)}</span>`;
    $('guideRuler').innerHTML = ruler;
    $('guideRuler').style.top = top + 'px';

    let html = '';
    for (let r = r0; r < r1; r++) {
      const i = visible[r];
      const c = all[i];
      const y = G_RULER + r * G_ROW;
      const logo = c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" data-fallback="${esc(initials(c.name))}">` : esc(initials(c.name));
      html += `<div class="g-ch${i === playing ? ' playing' : ''}" style="top:${y}px;left:${left}px" data-tune="${i}" title="${esc(c.name)} ansehen">` +
        `<span class="num">${numberOf.get(i)}</span><span class="logo">${logo}</span><span class="g-ch-name">${esc(c.name)}</span></div>`;
      const list = epgOf.get(i);
      if (!list) {
        html += `<div class="g-none" style="top:${y}px;left:${G_CH + Math.max(0, left)}px;width:${w - G_CH}px">Keine Programmdaten</div>`;
        continue;
      }
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        if (p[1] < tFrom) continue;
        if (p[0] > tTo) break;
        const x0 = Math.max(gx(p[0]), 0), x1 = Math.min(gx(p[1]), gx(guideEnd));
        if (x1 <= x0) continue;
        const cls = p[1] <= now ? ' past' : p[0] <= now ? ' now' : '';
        // Ragt die Sendung fast ganz unter die Senderspalte, keinen abgeschnittenen Text zeigen
        if (x1 - left < 70) {
          html += `<div class="g-prog${cls} stub" style="top:${y}px;left:${G_CH + x0}px;width:${x1 - x0}px" data-ch="${i}" data-k="${k}"><span class="g-prog-in"></span></div>`;
          continue;
        }
        // Titel bleibt sichtbar, auch wenn die Sendung links aus dem Bild ragt
        const pad = Math.max(0, left - (G_CH + x0) + G_CH);
        html += `<div class="g-prog${cls}" style="top:${y}px;left:${G_CH + x0}px;width:${x1 - x0}px" data-ch="${i}" data-k="${k}">` +
          `<span class="g-prog-in" style="padding-left:${Math.min(pad, Math.max(0, x1 - x0 - 60)) + 10}px"><span class="g-title">${esc(p[2])}</span><span class="g-time">${hm(p[0])}–${hm(p[1])}</span></span></div>`;
      }
    }
    $('guideRows').innerHTML = html;
    updateNowLine();
    const mid = new Date(guideStart + ((left + w / 2 - G_CH) / G_HOUR) * 3600e3);
    $('guideDay').textContent = mid.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function showGuideDetail(i, k) {
    const p = epgOf.get(i)[k];
    const now = Date.now();
    const running = p[0] <= now && p[1] > now;
    const c = all[i];
    $('guideDetail').innerHTML =
      `<button class="icon-btn g-detail-close" data-act="close" aria-label="Schließen"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` +
      `<p class="g-detail-ch">${esc(c.name)}, ${esc(new Date(p[0]).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>` +
      `<h3>${esc(p[2])}</h3>` +
      `<p class="g-detail-time">${hm(p[0])}–${hm(p[1])}${p[4] ? `, ${esc(p[4])}` : ''}</p>` +
      (running ? `<span class="pbar inline"><span style="width:${progPct(p)}%"></span></span>` : '') +
      (p[3] ? `<p class="g-detail-desc">${esc(p[3])}</p>` : '') +
      `<div class="modal-actions">${running
        ? `<button class="btn primary" data-act="watch" data-ch="${i}">Jetzt ansehen</button>`
        : p[1] <= now ? '<span class="g-detail-note">Bereits gelaufen</span>'
        : `<span class="g-detail-note">Beginnt in ${untilLabel(p[0] - now)}</span><button class="btn ghost" data-act="watch" data-ch="${i}">Sender einschalten</button>`}</div>`;
    $('guideDetail').hidden = false;
  }
  function untilLabel(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60), m = min % 60;
    return h < 24 ? `${h} Std.${m ? ` ${m} Min.` : ''}` : `${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? 'Tag' : 'Tagen'}`;
  }

  function tuneFromGuide(i) {
    closeGuide();
    tune(i);
  }

  // ---------- Live abspielen ----------
  let prevChannel = -1;
  function tune(i, { fromZap = false } = {}) {
    if (i < 0 || i >= all.length) return;
    const c = all[i];
    if (playing >= 0 && playingKind === 'live' && playing !== i) prevChannel = playing;
    playing = i;
    playingKind = 'live';
    selected = i;
    $('screen').classList.remove('is-vod');
    $('errorTitle').textContent = 'Dieser Sender lässt sich hier nicht abspielen.';
    store.lastChannel[pid()] = c.url;
    const rec = (store.recent[pid()] || []).filter((u) => u !== c.url);
    rec.unshift(c.url);
    store.recent[pid()] = rec.slice(0, 30);
    saveStore();
    if (filters.live === 'recent' && !query) applyFilter();
    renderRail();
    scrollToSelected(!fromZap);
    renderList();
    $('nowLabel').textContent = c.name;
    showOsd(numberOf.get(i), c.name, c.group, false, i);
    player.play(c.url, { live: true });
  }

  function zapBack() {
    if (prevChannel < 0 || isHidden(prevChannel)) { toast('Noch kein vorheriger Sender'); return; }
    if (!visible.includes(prevChannel)) { filters.live = 'all'; query = ''; $('search').value = ''; renderRail(); applyFilter(); }
    tune(prevChannel, { fromZap: true });
  }

  function zap(delta) {
    if (!visible.length || section !== 'live') return;
    const base = playing >= 0 && visible.includes(playing) ? playing : selected;
    let pos = visible.indexOf(base);
    pos = pos < 0 ? 0 : (pos + delta + visible.length) % visible.length;
    tune(visible[pos], { fromZap: true });
  }

  // ---------- Filme & Folgen abspielen ----------
  function playVod(i) {
    const e = all[i];
    if (playingKind === 'vod' && playing >= 0) saveProgress(true);
    playing = i;
    playingKind = 'vod';
    document.body.classList.add('vod-playing');
    $('stage').hidden = false;
    $('screen').classList.add('is-vod');
    $('errorTitle').textContent = 'Dieser Titel lässt sich hier nicht abspielen.';
    let title, sub;
    if (e.kind === 'series') {
      const sh = shows[showOf.get(i)], ep = epInfo.get(i);
      title = sh.name;
      sub = [ep.episode != null ? `Staffel ${ep.season}, Folge ${ep.episode}` : '', ep.title].filter(Boolean).join(': ');
    } else {
      title = e.title;
      sub = [e.year, e.group].filter(Boolean).join(', ');
    }
    $('vodNowTitle').textContent = title;
    $('vodNowSub').textContent = sub;
    $('nowLabel').textContent = '';
    $('nextEpBtn').hidden = nextEpisode(i) === null;
    const ps = progState(e.url);
    resumeAt = ps && ps.inProgress ? ps.t : 0;
    player.play(e.url, { live: false });
    wakeUI();
  }

  function nextEpisode(i) {
    if (all[i].kind !== 'series') return null;
    const eps = shows[showOf.get(i)].eps;
    return eps[eps.indexOf(i) + 1] ?? null;
  }

  function closeVod() {
    if (playingKind !== 'vod') return;
    saveProgress(true);
    if (document.body.classList.contains('is-fullscreen')) toggleFullscreen(false);
    player.stop();
    playing = -1;
    playingKind = null;
    document.body.classList.remove('vod-playing');
    $('screen').classList.remove('is-vod');
    if (section !== 'live') $('stage').hidden = true;
    renderRail();
    if (openShow >= 0) openShowView(openShow, openSeason); else renderGrid();
  }

  let resumeAt = 0;
  let lastProgressSave = 0;
  function saveProgress(force) {
    if (playingKind !== 'vod' || playing < 0) return;
    const d = video.duration, t = video.currentTime;
    if (!isFinite(d) || d <= 0 || !player.started) return;
    const now = Date.now();
    if (!force && now - lastProgressSave < 5000) return;
    lastProgressSave = now;
    const map = store.progress[pid()] || (store.progress[pid()] = {});
    map[all[playing].url] = { t: Math.round(t), d: Math.round(d), at: now };
    saveStore();
  }

  // ---------- OSD (Senderanzeige) ----------
  let osdTimer;
  function showOsd(num, name, group, typing = false, entry = -1) {
    const osd = $('osd');
    $('osdNum').textContent = num;
    $('osdName').textContent = name || '';
    $('osdGroup').textContent = group || '';
    const nn = entry >= 0 ? nowNext(entry) : null;
    $('osdEpg').hidden = !nn;
    if (nn) {
      $('osdProg').textContent = nn.now ? `${hm(nn.now[0])}–${hm(nn.now[1])}  ${nn.now[2]}` : '';
      $('osdPbar').parentNode.hidden = !nn.now;
      if (nn.now) $('osdPbar').style.width = progPct(nn.now) + '%';
      $('osdNext').textContent = nn.next ? `Danach ${hm(nn.next[0])}  ${nn.next[2]}` : '';
    }
    osd.classList.toggle('typing', typing);
    osd.classList.toggle('no-text', !name);
    osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd.classList.remove('show'), typing ? 2000 : 4000);
  }

  let digitBuf = '';
  let digitTimer;
  function typeDigit(d) {
    if (digitBuf.length >= 5) digitBuf = '';
    digitBuf += d;
    const i = byNumber.get(parseInt(digitBuf, 10));
    showOsd(digitBuf, i !== undefined && !isHidden(i) ? all[i].name : '', '', true);
    clearTimeout(digitTimer);
    digitTimer = setTimeout(() => {
      const target = byNumber.get(parseInt(digitBuf, 10));
      digitBuf = '';
      if (target !== undefined && !isHidden(target)) {
        if (!visible.includes(target)) { filters.live = 'all'; query = ''; $('search').value = ''; renderRail(); applyFilter(); }
        tune(target);
      } else {
        showOsd('–', 'Diese Sendernummer gibt es nicht', '');
      }
    }, 1300);
  }

  // ---------- Player-Engine ----------
  const video = $('video');
  const canMSE = (t) => { try { return !!window.MediaSource && MediaSource.isTypeSupported(t); } catch { return false; } };
  // Welche Ton-Codecs die eingebaute Wiedergabe auf diesem Rechner kann (wird an mpegts.js übergeben)
  const AUDIO_SUPPORT = {
    aac: canMSE('audio/mp4; codecs="mp4a.40.2"'),
    mp3: canMSE('audio/mpeg') || canMSE('audio/mp4; codecs="mp3"'),
    ac3: canMSE('audio/mp4; codecs="ac-3"'),
    eac3: canMSE('audio/mp4; codecs="ec-3"'),
    opus: canMSE('audio/mp4; codecs="opus"'),
  };
  // Live-Puffer in Sekunden: so viel wird vor dem Start und nach einem Hänger geladen
  const BUFFER_PRESETS = { low: 0.8, normal: 2, high: 5 };
  const CODEC_NAMES = { aac: 'AAC', mp3: 'MPEG', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', opus: 'Opus' };

  // ISO-639-Codes vereinheitlichen (ger/de -> deu usw.)
  const LANG_CANON = { ger: 'deu', de: 'deu', fre: 'fra', fr: 'fra', dut: 'nld', nl: 'nld', en: 'eng', es: 'spa', it: 'ita', tr: 'tur', pl: 'pol', ru: 'rus', ar: 'ara', pt: 'por', cze: 'ces', cs: 'ces', gre: 'ell', el: 'ell', rum: 'ron', ro: 'ron', chi: 'zho', zh: 'zho', ja: 'jpn', sv: 'swe', da: 'dan', no: 'nor', fi: 'fin', hu: 'hun', hr: 'hrv', sr: 'srp', bg: 'bul', uk: 'ukr', fa: 'fas', per: 'fas', ko: 'kor', hi: 'hin', sq: 'sqi', alb: 'sqi', ku: 'kur' };
  const LANG_ALIASES = { deu: ['deu', 'ger', 'de'], fra: ['fra', 'fre', 'fr'], nld: ['nld', 'dut', 'nl'], ces: ['ces', 'cze', 'cs'], ell: ['ell', 'gre', 'el'], ron: ['ron', 'rum', 'ro'], zho: ['zho', 'chi', 'zh'], fas: ['fas', 'per', 'fa'], sqi: ['sqi', 'alb', 'sq'] };
  const canonLang = (code) => {
    const c = String(code || '').toLowerCase().split(/[-_]/)[0];
    return LANG_CANON[c] || c;
  };
  const langAliases = (code) => {
    const c = canonLang(code);
    return c ? (LANG_ALIASES[c] || [c, ...Object.keys(LANG_CANON).filter((k) => LANG_CANON[k] === c)]) : [];
  };
  // Technische Spurnamen ("SoundHandler", "audio_2", "Track 1") nicht anzeigen
  const usefulName = (name, lang) => {
    const n2 = String(name || '').trim();
    if (!n2 || /handler$|^(audio|track|stream|spur)[\s_-]*\d*$|^und$/i.test(n2)) return '';
    return n2 === langName(lang) ? '' : n2;
  };
  let displayNames = null;
  try { displayNames = new Intl.DisplayNames(['de'], { type: 'language' }); } catch {}
  function langName(code) {
    const c = canonLang(code);
    if (!c || ['und', 'mis', 'zxx', 'qaa', 'qad'].includes(c)) return '';
    if (c === 'mul') return 'Mehrsprachig';
    try {
      const n2 = displayNames && displayNames.of(c);
      if (n2 && n2.toLowerCase() !== c) return n2.charAt(0).toUpperCase() + n2.slice(1);
    } catch {}
    return c.toUpperCase();
  }

  const player = {
    hls: null,
    ts: null,
    url: '',
    live: true,
    order: [],
    step: 0,
    started: false,
    token: 0,
    watchdog: null,
    errors: [],
    // Puffer-Steuerung (Live-TS)
    holding: false,
    holdSince: 0,
    internalPause: false,
    userPaused: false,
    bufTarget: 2,
    lastTime: 0,
    lastAdvanceAt: 0,
    reconnects: [],
    // Tonspuren
    audioTracks: [],      // { id, label, detail, supported, selected, lang }
    tsAudioPid: null,
    warnedAudio: false,

    get engine() { return this.order[this.step]; },

    guess(url) {
      const u = url.split('?')[0].toLowerCase();
      if (u.endsWith('.m3u8') || u.includes('/hls/') || u.includes('m3u8')) return ['hls', 'ts', 'native'];
      if (/\.(mp4|mkv|webm|mov|m4v|mp3|aac|avi|wmv|flv|mpg|mpeg)$/.test(u)) return ['native', 'hls', 'ts'];
      return ['ts', 'hls', 'native'];
    },

    destroy() {
      clearTimeout(this.watchdog);
      this.holding = false;
      video.playbackRate = 1;
      if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
      if (this.ts) {
        try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy(); } catch {}
        this.ts = null;
      }
      video.removeAttribute('src');
      try { video.load(); } catch {}
    },

    stop() {
      this.token++;
      this.destroy();
      this.url = '';
      setAudioTracks([]);
      setStatus('idle');
      $('nowLabel').textContent = '';
    },

    play(url, { live = true } = {}) {
      this.token++;
      this.destroy();
      this.url = url;
      this.live = live;
      this.order = this.guess(url);
      this.step = 0;
      this.started = false;
      this.errors = [];
      this.reconnects = [];
      this.tsAudioPid = null;
      this.warnedAudio = false;
      this.userPaused = false;
      this.timeshift = false;
      this.bufTarget = BUFFER_PRESETS[store.buffer] || BUFFER_PRESETS.normal;
      setAudioTracks([]);
      setStatus('loading');
      this.attempt();
    },

    retry() { if (this.url) this.play(this.url, { live: this.live }); },

    // Gleiche Engine neu starten, z. B. nach Wechsel der Tonspur oder einem Hänger
    restart() {
      const token = ++this.token;
      if (!this.live) resumeAt = video.currentTime || resumeAt;
      this.started = false;
      this.destroy();
      setStatus('loading');
      setTimeout(() => { if (token === this.token) this.attempt(); }, 150);
    },

    fail(reason) {
      const token = this.token;
      this.errors.push(reason);
      if (this.started) {
        // Lief schon: neu verbinden (VOD setzt an der letzten Stelle fort).
        // Mehr als 5 Neuverbindungen pro Minute: aufgeben und Fehler zeigen.
        const now = Date.now();
        this.reconnects = this.reconnects.filter((t) => now - t < 60000);
        this.reconnects.push(now);
        if (this.reconnects.length > 5) {
          this.destroy();
          setStatus('error', explain(this.errors.concat('unstable')));
          return;
        }
        if (!this.live) resumeAt = video.currentTime || resumeAt;
        this.started = false;
        this.destroy();
        setStatus('loading');
        setTimeout(() => { if (token === this.token) this.attempt(); }, 600);
        return;
      }
      this.step++;
      this.destroy();
      if (this.step < this.order.length) this.attempt();
      else setStatus('error', explain(this.errors));
    },

    // Bis genug Puffer da ist, wird nicht abgespielt (verhindert Ruckeln direkt nach Start/Hänger)
    hold() {
      this.holding = true;
      this.holdSince = performance.now();
      if (!video.paused) { this.internalPause = true; video.pause(); }
      setStatus('loading');
    },

    release() {
      this.holding = false;
      this.lastAdvanceAt = performance.now();
      this.lastTime = video.currentTime;
      video.play().catch(() => {});
    },

    attempt() {
      const token = this.token;
      const engine = this.engine;
      const failed = (r) => { if (token === this.token) this.fail(r); };
      const langs = langAliases(store.audioLang);

      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => { if (!this.started) failed('timeout'); }, this.live ? 15000 : 25000);

      if (engine === 'hls') {
        if (!window.Hls || !Hls.isSupported()) return failed('hls-unsupported');
        const hls = new Hls({
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          liveSyncDurationCount: 3,
          maxBufferHole: 0.5,
          nudgeMaxRetry: 6,
          startFragPrefetch: true,
          fragLoadingMaxRetry: 6,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
        });
        this.hls = hls;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.started) { hls.recoverMediaError(); return; }
          failed(data.response && data.response.code ? 'http-' + data.response.code : data.details || 'hls');
        });
        const syncTracks = () => {
          setAudioTracks(hls.audioTracks.map((t, i) => ({
            id: i, lang: canonLang(t.lang),
            label: langName(t.lang) || usefulName(t.name) || `Spur ${i + 1}`,
            detail: langName(t.lang) ? usefulName(t.name, t.lang) : '',
            supported: true, selected: i === hls.audioTrack,
          })));
        };
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (langs.length && hls.audioTracks.length > 1) {
            const idx = hls.audioTracks.findIndex((t) => langs.includes(canonLang(t.lang)));
            if (idx >= 0 && idx !== hls.audioTrack) hls.audioTrack = idx;
          }
          syncTracks();
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncTracks);
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, syncTracks);
        hls.loadSource(this.url);
        hls.attachMedia(video);
      } else if (engine === 'ts') {
        if (!window.mpegts || !mpegts.isSupported()) return failed('ts-unsupported');
        const p = mpegts.createPlayer(
          { type: 'mpegts', isLive: this.live, url: this.url },
          {
            isLive: this.live,
            enableWorker: true,
            lazyLoad: !this.live,
            // Kein Nachjagen der Live-Kante: das hat bisher Sprünge und Hänger verursacht
            liveBufferLatencyChasing: false,
            liveSync: false,
            enableStashBuffer: true,
            autoCleanupSourceBuffer: true,
            // Live-Zurückspulen: bis zu ~2 Minuten bleiben im Speicher. Mehr sprengt bei HD-Sendern
            // das Speicherlimit des Browsers für Videopuffer (~150 MB), dann hält die Verbindung an.
            autoCleanupMaxBackwardDuration: this.live ? 150 : 40,
            autoCleanupMinBackwardDuration: this.live ? 120 : 20,
            // Signal-Patch (renderer/vendor/mpegts.js): Tonspur-Auswahl und Zeitstempel-Sprünge
            audioCodecSupport: AUDIO_SUPPORT,
            audioTrackPid: this.tsAudioPid || undefined,
            audioLanguages: langs,
            discontinuityThreshold: 1000,
          }
        );
        this.ts = p;
        p.on(mpegts.Events.ERROR, (type, detail, info) => failed(info && info.code ? 'http-' + info.code : detail || type));
        p.on(mpegts.Events.MEDIA_INFO, (mi) => { if (token === this.token) onTsMediaInfo(mi); });
        p.attachMediaElement(video);
        p.load();
        if (this.live) {
          this.hold();
        } else {
          const r = p.play();
          if (r && r.catch) r.catch(() => {});
        }
      } else {
        video.src = this.url;
        video.play().catch(() => {});
      }
    },
  };

  function onTsMediaInfo(mi) {
    const tracks = mi.audioTracks || [];
    let n2 = 0;
    setAudioTracks(tracks.map((t) => {
      n2++;
      const name = langName(t.language);
      return {
        id: t.pid, lang: canonLang(t.language),
        label: name || `Spur ${n2}`,
        detail: CODEC_NAMES[t.codec] || t.codec.toUpperCase(),
        supported: t.supported, selected: t.selected,
      };
    }));
    // Keine abspielbare Tonspur: einmal Bescheid geben
    if (tracks.length && !tracks.some((t) => t.supported) && !player.warnedAudio) {
      player.warnedAudio = true;
      const codec = CODEC_NAMES[tracks[0].codec] || tracks[0].codec;
      toast(`Der Ton dieses Senders (${codec}) läuft nur in VLC.`, { label: 'In VLC öffnen', run: openInVlc });
    }
  }

  function bufferAhead() {
    const b = video.buffered, t = video.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.05 && b.end(i) > t) return b.end(i) - t;
    }
    return 0;
  }
  // Nächster gepufferter Abschnitt hinter einer Lücke (z. B. nach Sprung im Stream)
  function gapTarget() {
    const b = video.buffered, t = video.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.05 && b.end(i) > t + 0.1) return null; // wir stehen in Daten
    }
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) > t && b.start(i) - t < 6) return b.start(i) + 0.05;
    }
    return null;
  }

  // Wächter für Live-TS: Vorpuffer, Nachpuffern, Lücken überspringen, Hänger lösen
  setInterval(() => {
    if (!player.url || !player.live || player.engine !== 'ts' || !player.ts) return;
    const now = performance.now();
    const ahead = bufferAhead();
    const gap = gapTarget();

    if (player.holding) {
      if (gap !== null && ahead < 0.1) { video.currentTime = gap; return; }
      const waited = now - player.holdSince;
      if (ahead >= player.bufTarget || (waited > 6000 && ahead > 0.4)) player.release();
      else if (player.started && waited > 12000) player.fail('stall');
      return;
    }
    if (video.paused) return; // vom Nutzer pausiert

    if (gap !== null && ahead < 0.1) {
      video.currentTime = gap;
    } else if (ahead < 0.08 && video.readyState < 3) {
      // Puffer leer: lieber kurz sammeln als im Sekundentakt stocken. Bei jedem Hänger
      // wird das Ziel etwas größer (adaptiv), maximal das Dreifache der Einstellung.
      const base = BUFFER_PRESETS[store.buffer] || BUFFER_PRESETS.normal;
      player.bufTarget = Math.min(player.bufTarget + 1, Math.max(base * 3, 3), 8);
      player.hold();
      return;
    }

    if (Math.abs(video.currentTime - player.lastTime) > 0.01) {
      player.lastTime = video.currentTime;
      player.lastAdvanceAt = now;
    } else if (now - player.lastAdvanceAt > 3000) {
      // Bild steht trotz Daten: Decoder anschubsen, notfalls neu verbinden
      if (ahead > 0.5) { video.currentTime = video.currentTime + 0.05; player.lastAdvanceAt = now; }
      else if (now - player.lastAdvanceAt > 10000) player.fail('stall');
    }

    // Aufgestaute Verzögerung sanft abbauen, ohne zu springen (nicht nach Nutzer-Pause)
    if (!player.userPaused && !player.timeshift) {
      if (ahead > player.bufTarget + 20) video.playbackRate = 1.08;
      else if (video.playbackRate !== 1 && ahead < player.bufTarget + 4) video.playbackRate = 1;
    }
  }, 250);

  function explain(errors) {
    const allErr = errors.join(' ');
    const http = allErr.match(/http-(\d{3})/);
    if (http) {
      const code = http[1];
      if (code === '401' || code === '403') return `Der Server verweigert den Zugriff (HTTP ${code}). Oft hilft ein anderer User-Agent in den Einstellungen, oder dein Zugang ist abgelaufen.`;
      if (code === '404') return 'Unter diesem Link gibt es nichts mehr (HTTP 404). Aktualisiere die Playlist in den Einstellungen.';
      if (code.startsWith('5')) return `Der Server des Anbieters hat ein Problem (HTTP ${code}). Versuch es später noch einmal.`;
      return `Der Server antwortet mit HTTP ${code}.`;
    }
    if (allErr.includes('unstable')) return 'Die Verbindung bricht ständig ab. Stell in den Einstellungen den Puffer auf „Hoch“ oder versuch es später noch einmal.';
    if (allErr.includes('timeout')) return player.live
      ? 'Der Stream hat innerhalb von 15 Sekunden kein Bild geliefert. Der Sender ist vielleicht offline.'
      : 'Die Datei hat nicht rechtzeitig geladen. Der Server ist langsam oder der Titel offline.';
    if (/codec|MediaMSE|bufferAppend|manifestIncompatible|MEDIA_ERR_SRC|native/i.test(allErr)) {
      return 'Wahrscheinlich nutzt dieser Titel ein Format, das die eingebaute Wiedergabe nicht kann (z. B. DTS-Ton, HEVC oder MPEG-2). VLC spielt solche Dateien ab.';
    }
    return 'Der Stream konnte nicht geöffnet werden. In VLC klappt es häufig trotzdem.';
  }

  // ---------- Tonspuren ----------
  function setAudioTracks(tracks) {
    player.audioTracks = tracks;
    $('audioBtn').hidden = tracks.length < 2;
    if (!tracks.length) closeAudioMenu();
    else if (!$('audioMenu').hidden) renderAudioMenu();
  }

  // Dateien (MP4/MKV): Chromium liefert die Spuren über video.audioTracks
  function syncNativeTracks() {
    const list = video.audioTracks;
    if (!list || player.engine !== 'native') return;
    const tracks = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      tracks.push({
        id: i, lang: canonLang(t.language),
        label: langName(t.language) || usefulName(t.label) || `Spur ${i + 1}`,
        detail: langName(t.language) ? usefulName(t.label, t.language) : '',
        supported: true, selected: t.enabled,
      });
    }
    setAudioTracks(tracks);
  }
  function pickNativeTrackByLang() {
    const list = video.audioTracks;
    const langs = langAliases(store.audioLang);
    if (!list || list.length < 2 || !langs.length) return;
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (langs.includes(canonLang(list[i].language))) { idx = i; break; }
    if (idx >= 0) for (let i = 0; i < list.length; i++) list[i].enabled = i === idx;
  }

  function selectAudioTrack(id) {
    const t = player.audioTracks.find((x) => x.id === id);
    if (!t || !t.supported) return;
    if (t.lang) { store.audioLang = t.lang; saveStore(); }
    closeAudioMenu();
    if (t.selected) return;
    if (player.engine === 'ts') {
      player.tsAudioPid = id;
      player.restart();
    } else if (player.engine === 'hls' && player.hls) {
      player.hls.audioTrack = id;
    } else if (video.audioTracks) {
      for (let i = 0; i < video.audioTracks.length; i++) video.audioTracks[i].enabled = i === id;
      syncNativeTracks();
    }
    toast(`Tonspur: ${t.label}${t.detail ? ` (${t.detail})` : ''}`);
  }

  function renderAudioMenu() {
    $('audioMenu').innerHTML = '<p class="menu-title">Tonspur</p>' + player.audioTracks.map((t) =>
      `<button class="menu-item${t.selected ? ' on' : ''}" data-track="${t.id}" role="menuitemradio" aria-checked="${t.selected}"${t.supported ? '' : ' disabled'}>` +
      `<span class="menu-check" aria-hidden="true">${t.selected ? '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12.5 4.2 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span>` +
      `<span class="menu-label">${esc(t.label)}<small>${esc(t.detail)}${t.supported ? '' : ', nur in VLC'}</small></span></button>`).join('');
  }
  function toggleAudioMenu() {
    const m = $('audioMenu');
    if (m.hidden) { renderAudioMenu(); m.hidden = false; $('audioBtn').setAttribute('aria-expanded', 'true'); }
    else closeAudioMenu();
  }
  function closeAudioMenu() {
    $('audioMenu').hidden = true;
    $('audioBtn').setAttribute('aria-expanded', 'false');
  }
  function cycleAudioTrack() {
    const ok = player.audioTracks.filter((t) => t.supported);
    if (ok.length < 2) return;
    const cur = ok.findIndex((t) => t.selected);
    selectAudioTrack(ok[(cur + 1) % ok.length].id);
  }

  video.addEventListener('loadedmetadata', () => {
    if (player.engine === 'native') { pickNativeTrackByLang(); syncNativeTracks(); }
    if (!player.live && resumeAt > 0 && isFinite(video.duration) && video.duration > resumeAt + 5) {
      const at = resumeAt;
      video.currentTime = at;
      resumeAt = 0;
      toast(`Fortgesetzt bei ${fmtTime(at)}`, { label: 'Von vorn', run: () => { video.currentTime = 0; } });
    }
    updateSeek();
  });
  if (video.audioTracks) {
    video.audioTracks.addEventListener('addtrack', syncNativeTracks);
    video.audioTracks.addEventListener('change', syncNativeTracks);
  }
  video.addEventListener('playing', () => {
    player.started = true;
    clearTimeout(player.watchdog);
    setStatus('playing');
  });
  video.addEventListener('waiting', () => { if (player.started && !player.holding) setStatus('loading'); });
  video.addEventListener('canplay', () => { if (player.started && !player.holding && !$('spinner').hidden) setStatus('playing'); });
  video.addEventListener('error', () => {
    if (!player.url) return;
    if (player.engine === 'native' && !player.hls && !player.ts) player.fail('native');
  });
  video.addEventListener('pause', () => {
    if (player.internalPause) { player.internalPause = false; return; }
    $('playBtn').classList.add('paused');
    saveProgress(true);
  });
  video.addEventListener('play', () => $('playBtn').classList.remove('paused'));
  video.addEventListener('timeupdate', () => { updateSeek(); saveProgress(false); });
  video.addEventListener('durationchange', updateSeek);
  video.addEventListener('ended', () => {
    if (playingKind !== 'vod') return;
    const map = store.progress[pid()] || (store.progress[pid()] = {});
    map[all[playing].url] = { t: Math.round(video.duration), d: Math.round(video.duration), at: Date.now() };
    saveStore();
    const next = nextEpisode(playing);
    if (next !== null) {
      toast(`Weiter mit ${epLabel(next)}`);
      playVod(next);
    } else closeVod();
  });

  function setStatus(state, detail) {
    $('idle').hidden = state !== 'idle';
    $('spinner').hidden = state !== 'loading';
    $('errorBox').hidden = state !== 'error';
    $('controls').hidden = state === 'idle';
    if (state !== 'playing' && state !== 'loading') closeAudioMenu();
    updateSeek();
    if (state === 'error') $('errorDetail').textContent = detail || '';
  }

  // ---------- Spulen ----------
  let seeking = false;
  // Zeitfenster für Live-Zurückspulen: [ältester gepufferter Moment, Live-Kante]
  function liveWindow() {
    const b = video.buffered;
    if (!b.length || playingKind !== 'live') return null;
    const start = b.start(0), end = b.end(b.length - 1);
    const edge = Math.max(start, end - player.bufTarget);
    return edge - start >= 10 ? { start, edge } : null;
  }
  function goLive() {
    const w = liveWindow();
    if (w) video.currentTime = w.edge;
    player.timeshift = false;
    player.userPaused = false;
    if (video.paused) video.play().catch(() => {});
    updateSeek();
  }

  function updateSeek() {
    const vod = playingKind === 'vod' && isFinite(video.duration) && video.duration > 0;
    const lw = !vod ? liveWindow() : null;
    $('seekRow').hidden = !vod && !lw;
    $('screen').classList.toggle('timeshift', !!lw);
    if (lw) {
      const behind = Math.max(0, lw.edge - video.currentTime);
      const atLive = behind < 3;
      if (atLive && player.timeshift && !video.paused) { player.timeshift = false; player.userPaused = false; }
      $('liveBtn').classList.toggle('on', atLive);
      $('timeDur').textContent = '';
      if (!seeking) {
        $('timeCur').textContent = atLive ? 'Live' : `−${fmtTime(behind)}`;
        $('seek').value = Math.round(((video.currentTime - lw.start) / (lw.edge - lw.start)) * 1000);
      }
      $('seek').style.setProperty('--p', ($('seek').value / 10).toFixed(2) + '%');
      return;
    }
    if (!vod) return;
    $('timeDur').textContent = fmtTime(video.duration);
    if (!seeking) {
      $('timeCur').textContent = fmtTime(video.currentTime);
      $('seek').value = Math.round((video.currentTime / video.duration) * 1000);
    }
    const pct = ($('seek').value / 10).toFixed(2);
    $('seek').style.setProperty('--p', pct + '%');
  }
  function skip(sec) {
    if (playingKind === 'live') {
      const w = liveWindow();
      if (!w) { if (sec < 0) toast('Zurückspulen geht, sobald etwas Puffer da ist'); return; }
      const t = Math.max(w.start + 0.5, Math.min(w.edge, video.currentTime + sec));
      player.timeshift = t < w.edge - 3;
      video.currentTime = t;
      updateSeek();
      wakeUI();
      return;
    }
    if (playingKind !== 'vod' || !isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + sec));
    updateSeek();
    wakeUI();
  }

  // ---------- Player-Bedienung ----------
  let hideTimer;
  function wakeUI() {
    const s = $('screen');
    s.classList.remove('hide-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!video.paused && player.started && !seeking) s.classList.add('hide-ui'); }, 2600);
  }

  function setVolume(v) {
    store.volume = Math.max(0, Math.min(1, v));
    video.volume = store.volume;
    $('volume').value = store.volume;
    if (store.volume > 0 && store.muted) setMuted(false);
    saveStore();
  }
  function setMuted(m) {
    store.muted = m;
    video.muted = m;
    $('muteBtn').classList.toggle('muted', m);
    $('muteBtn').setAttribute('aria-label', m ? 'Ton an' : 'Ton aus');
    saveStore();
  }
  function togglePause() {
    if (!player.url) return;
    if (video.paused) {
      if (player.holding) player.release(); else video.play().catch(() => {});
    } else {
      player.userPaused = true;
      if (player.live) player.timeshift = true;
      video.pause();
    }
    wakeUI();
  }
  async function toggleMini(value) {
    const on = value ?? !document.body.classList.contains('mini');
    if (on && playing < 0) { toast('Starte zuerst einen Sender oder Film'); return; }
    if (on) closeAudioMenu();
    document.body.classList.toggle('mini', on);
    $('miniTitle').textContent = on && playing >= 0 ? (playingKind === 'vod' ? $('vodNowTitle').textContent : all[playing].name) : '';
    await api.mini(on);
    requestAnimationFrame(() => { renderList(); renderGrid(); });
  }

  async function toggleFullscreen(value) {
    const fs = await api.fullscreen(value);
    setFullscreenClass(fs);
  }
  function setFullscreenClass(fs) {
    if (fs && document.body.classList.contains('mini')) { document.body.classList.remove('mini'); api.mini(false); }
    document.body.classList.toggle('is-fullscreen', fs);
    requestAnimationFrame(() => { renderList(); renderGrid(); });
  }
  async function openInVlc() {
    if (playing < 0) return;
    const c = all[playing];
    const r = await api.openInVlc(c.url, c.name, store.audioLang);
    if (r.ok) { video.pause(); toast('Läuft jetzt in VLC'); }
    else toast(r.reason);
  }

  function setupPlayerUI() {
    video.volume = store.volume;
    video.muted = store.muted;
    $('volume').value = store.volume;
    $('muteBtn').classList.toggle('muted', store.muted);
    setStatus('idle');

    $('volume').addEventListener('input', (e) => setVolume(parseFloat(e.target.value)));
    $('muteBtn').addEventListener('click', () => setMuted(!store.muted));
    $('playBtn').addEventListener('click', togglePause);
    $('prevBtn').addEventListener('click', () => zap(-1));
    $('nextBtn').addEventListener('click', () => zap(1));
    $('backTenBtn').addEventListener('click', () => skip(-10));
    $('prevChBtn').addEventListener('click', zapBack);
    $('liveBtn').addEventListener('click', () => { goLive(); wakeUI(); });
    $('miniBtn').addEventListener('click', () => toggleMini());
    $('miniExit').addEventListener('click', () => toggleMini(false));
    $('fwdTenBtn').addEventListener('click', () => skip(10));
    $('nextEpBtn').addEventListener('click', () => { const nx = nextEpisode(playing); if (nx !== null) playVod(nx); });
    $('vodClose').addEventListener('click', closeVod);
    $('fsBtn').addEventListener('click', () => toggleFullscreen());
    $('vlcBtn').addEventListener('click', openInVlc);
    $('errorVlcBtn').addEventListener('click', openInVlc);
    $('retryBtn').addEventListener('click', () => player.retry());
    $('audioBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAudioMenu(); wakeUI(); });
    $('audioMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-track]');
      if (b && !b.disabled) selectAudioTrack(+b.dataset.track);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#audioMenu, #audioBtn')) closeAudioMenu(); });

    const seek = $('seek');
    seek.addEventListener('input', () => {
      seeking = true;
      const lw = liveWindow();
      if (lw) {
        const behind = (1 - seek.value / 1000) * (lw.edge - lw.start);
        $('timeCur').textContent = behind < 3 ? 'Live' : `−${fmtTime(behind)}`;
        seek.style.setProperty('--p', (seek.value / 10) + '%');
        return;
      }
      $('timeCur').textContent = fmtTime((seek.value / 1000) * video.duration);
      seek.style.setProperty('--p', (seek.value / 10) + '%');
    });
    seek.addEventListener('change', () => {
      const lw = liveWindow();
      if (lw) {
        const t = lw.start + (seek.value / 1000) * (lw.edge - lw.start);
        player.timeshift = t < lw.edge - 3;
        video.currentTime = Math.max(lw.start + 0.5, t);
      } else if (isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration;
      seeking = false;
      wakeUI();
    });

    const screen = $('screen');
    screen.addEventListener('mousemove', wakeUI);
    screen.addEventListener('dblclick', (e) => {
      if (e.target.closest('.controls, .error-box, .vod-top, .mini-bar')) return;
      if (document.body.classList.contains('mini')) toggleMini(false); else toggleFullscreen();
    });
    screen.addEventListener('click', (e) => { if (e.target === video) togglePause(); });
    screen.addEventListener('wheel', (e) => { if (player.url) { setVolume(store.volume - Math.sign(e.deltaY) * 0.05); wakeUI(); } }, { passive: true });
    api.onFullscreen(setFullscreenClass);
  }

  // ---------- Dialog: Gruppen und Sender auswählen ----------
  let groupsTab = 'live';
  let groupsDirty = false;

  function openGroupsDialog(tab) {
    const counts = sectionCounts();
    groupsTab = tab || section;
    if (!counts[groupsTab] && groupsTab !== 'items') groupsTab = ['live', 'movie', 'series'].find((s) => counts[s]) || 'live';
    $('groupsFilter').value = '';
    groupsDirty = false;
    renderGroupsDialog();
    $('groupsDialog').showModal();
    $('groupsFilter').focus();
  }

  function renderGroupsDialog() {
    const counts = sectionCounts();
    const h = hiddenState();
    const tabs = ['live', 'movie', 'series'].filter((s) => counts[s]).map((s) => [s, SECTION_NAMES[s]]);
    if (h.items.length) tabs.push(['items', `Einzelne Sender (${n(h.items.length)})`]);
    $('groupsTabs').innerHTML = tabs.map(([k, label]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${k === groupsTab}">${esc(label)}</button>`).join('');

    const filterText = norm($('groupsFilter').value.trim());
    const isItems = groupsTab === 'items';
    $('groupsAllOn').hidden = $('groupsAllOff').hidden = isItems;
    $('groupsFilter').placeholder = isItems ? 'Sender filtern' : 'Gruppen filtern, z. B. „DE“';

    if (isItems) {
      const byUrl = new Map(all.map((c) => [c.url, c]));
      const list = h.items.map((u) => byUrl.get(u) || { name: u, group: 'nicht mehr in der Playlist', url: u })
        .filter((c) => !filterText || norm(c.name).includes(filterText));
      $('groupsHint').textContent = `${n(h.items.length)} einzeln ausgeblendete Sender.`;
      $('groupsList').innerHTML = list.map((c) =>
        `<li><span class="cl-label">${esc(c.name)}<small>${esc(c.group)}</small></span>` +
        `<button class="btn ghost small" data-unhide="${esc(c.url)}">Einblenden</button></li>`).join('') ||
        '<li class="empty">Keine Sender gefunden.</li>';
      return;
    }

    const groups = groupsBy[groupsTab].filter((g) => !filterText || norm(g.name).includes(filterText));
    const visibleCount = groupsBy[groupsTab].filter((g) => !hiddenGroups.has(groupsTab + '|' + g.name)).length;
    const unit = groupsTab === 'live' ? 'Sender' : groupsTab === 'movie' ? 'Filme' : 'Serien';
    $('groupsHint').textContent = `${n(visibleCount)} von ${n(groupsBy[groupsTab].length)} Gruppen sichtbar. Abgewählte Gruppen tauchen nirgends mehr auf, auch nicht in der Suche.`;
    $('groupsList').innerHTML = groups.map((g) => {
      const on = !hiddenGroups.has(groupsTab + '|' + g.name);
      return `<li><label class="cl-label"><input type="checkbox" data-group="${esc(g.name)}"${on ? ' checked' : ''}>` +
        `<span>${esc(g.name)}</span><small>${n(g.count)} ${unit}</small></label></li>`;
    }).join('') || '<li class="empty">Keine Gruppe passt zum Filter.</li>';
  }

  function setGroupVisible(sec, name, on) {
    const key = sec + '|' + name;
    const h = hiddenState();
    h.groups = h.groups.filter((g) => g !== key);
    if (!on) h.groups.push(key);
    groupsDirty = true;
  }

  function closeGroupsDialog() {
    $('groupsDialog').close();
    if (!groupsDirty) return;
    refreshHiddenSets();
    for (const s of ['live', 'movie', 'series']) {
      const f = filters[s];
      if (f.startsWith('g:') && hiddenGroups.has(s + '|' + f.slice(2))) filters[s] = 'all';
    }
    if (openShow >= 0 && showHidden(openShow)) closeShowView();
    afterHiddenChange();
    renderHiddenSummary();
  }

  function renderHiddenSummary() {
    const h = hiddenState();
    const g = h.groups.length, i = h.items.length;
    $('hiddenSummary').textContent = !g && !i ? 'Nichts ausgeblendet.'
      : `${g ? `${n(g)} ${g === 1 ? 'Gruppe' : 'Gruppen'}` : ''}${g && i ? ' und ' : ''}${i ? `${n(i)} ${i === 1 ? 'Sender' : 'Sender'}` : ''} ausgeblendet.`;
  }

  // ---------- Ereignisse ----------
  function bindUI() {
    // Willkommen
    $('welcomeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      $('welcomeError').textContent = '';
      try { await addPlaylist({ url: $('welcomeUrl').value.trim() }); }
      catch (err) { $('welcomeError').textContent = friendlyLoadError(err); }
      finally { if (btn) btn.disabled = false; }
    });
    $('welcomeFile').addEventListener('click', async () => {
      $('welcomeError').textContent = '';
      const file = await api.pickFile();
      if (!file) return;
      try { await addPlaylist({ file }); } catch (err) { $('welcomeError').textContent = friendlyLoadError(err); }
    });

    // Playlist hinzufügen
    const addDlg = $('addDialog');
    $('addBtn').addEventListener('click', () => {
      $('addName').value = ''; $('addUrl').value = ''; $('addError').textContent = '';
      addDlg.showModal();
      $('addUrl').focus();
    });
    $('addCancel').addEventListener('click', () => addDlg.close());
    $('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = $('addUrl').value.trim();
      if (!url) { $('addError').textContent = 'Gib einen Link ein oder öffne eine Datei.'; return; }
      $('addSubmit').disabled = true;
      $('addError').textContent = '';
      try { await addPlaylist({ name: $('addName').value.trim(), url }); addDlg.close(); }
      catch (err) { $('addError').textContent = friendlyLoadError(err); }
      finally { $('addSubmit').disabled = false; }
    });
    $('addFileBtn').addEventListener('click', async () => {
      const file = await api.pickFile();
      if (!file) return;
      try { await addPlaylist({ name: $('addName').value.trim(), file }); addDlg.close(); }
      catch (err) { $('addError').textContent = friendlyLoadError(err); }
    });

    // Einstellungen
    const setDlg = $('settingsDialog');
    $('settingsBtn').addEventListener('click', () => {
      $('uaInput').value = store.userAgent;
      $('bufferSelect').value = store.buffer;
      $('autoRefreshSelect').value = store.autoRefresh;
      editingPl = null;
      renderManage();
      renderHiddenSummary();
      setDlg.showModal();
    });
    $('settingsClose').addEventListener('click', async () => {
      const ua = $('uaInput').value.trim() || DEFAULT_UA;
      if (ua !== store.userAgent) { store.userAgent = ua; await api.setUserAgent(ua); saveStore(); }
      if ($('bufferSelect').value !== store.buffer) { store.buffer = $('bufferSelect').value; saveStore(); }
      if ($('autoRefreshSelect').value !== store.autoRefresh) { store.autoRefresh = $('autoRefreshSelect').value; saveStore(); }
      setDlg.close();
    });
    $('plManage').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.closest('.editing')) { e.preventDefault(); e.target.closest('.editing').querySelector('[data-act="save"]').click(); }
    });
    $('openGroupsFromSettings').addEventListener('click', () => { setDlg.close(); openGroupsDialog(); });
    $('plManage').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'edit') {
        editingPl = id;
        renderManage();
      } else if (b.dataset.act === 'cancel') {
        editingPl = null;
        renderManage();
      } else if (b.dataset.act === 'save') {
        const li = b.closest('li');
        const pl = store.playlists.find((p) => p.id === id);
        const name = li.querySelector('[data-f="name"]').value.trim();
        const epg = li.querySelector('[data-f="epg"]').value.trim();
        if (name) pl.name = name;
        const epgChanged = (pl.epgUrl || '') !== epg;
        pl.epgUrl = epg || undefined;
        editingPl = null;
        saveStore();
        renderPlaylistSelect();
        renderManage();
        if (epgChanged && id === pid()) loadEpgFor(id, { force: true });
      } else if (b.dataset.act === 'refresh') {
        b.disabled = true; b.textContent = 'Lädt …';
        try {
          const cnt = await refreshPlaylist(id);
          if (id === pid()) await loadEpgFor(id, { force: true });
          toast(`Aktualisiert: ${n(cnt)} Einträge`);
        }
        catch (err) { toast(friendlyLoadError(err)); }
        renderManage();
      } else if (b.dataset.act === 'remove') {
        const pl = store.playlists.find((p) => p.id === id);
        if (confirm(`„${pl.name}“ entfernen? Favoriten, Fortschritt und Ausblendungen dieser Playlist gehen verloren.`)) {
          await removePlaylist(id);
          if (!store.playlists.length) setDlg.close(); else renderManage();
        }
      }
    });

    // Über Signal
    $('aboutBtn').addEventListener('click', openAbout);
    $('aboutClose').addEventListener('click', () => $('aboutDialog').close());
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-external]');
      if (!a) return;
      e.preventDefault();
      const base = appInfo && appInfo.homepage;
      const targets = {
        home: base,
        legal: base && base + '#wo-bekomme-ich-legale-playlisten',
        privacy: base && base + '/blob/main/PRIVACY.md',
        issues: base && base + '/issues',
      };
      const url = targets[a.dataset.external];
      if (url && !url.includes('DEIN-GITHUB-NAME')) api.openExternal(url);
      else toast('Der Projekt-Link ist in dieser Version noch nicht eingetragen.');
    });

    // Gruppen-Dialog
    $('groupsTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      groupsTab = b.dataset.tab;
      $('groupsFilter').value = '';
      renderGroupsDialog();
    });
    $('groupsFilter').addEventListener('input', debounce(renderGroupsDialog, 100));
    $('groupsList').addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-group]');
      if (!cb) return;
      setGroupVisible(groupsTab, cb.dataset.group, cb.checked);
      refreshHiddenSets();
      renderGroupsDialog();
    });
    $('groupsList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-unhide]');
      if (!b) return;
      const h = hiddenState();
      h.items = h.items.filter((u) => u !== b.dataset.unhide);
      groupsDirty = true;
      refreshHiddenSets();
      if (!h.items.length) groupsTab = section;
      renderGroupsDialog();
    });
    const bulk = (on) => {
      const filterText = norm($('groupsFilter').value.trim());
      for (const g of groupsBy[groupsTab]) if (!filterText || norm(g.name).includes(filterText)) setGroupVisible(groupsTab, g.name, on);
      refreshHiddenSets();
      renderGroupsDialog();
    };
    $('groupsAllOn').addEventListener('click', () => bulk(true));
    $('groupsAllOff').addEventListener('click', () => bulk(false));
    $('groupsClose').addEventListener('click', closeGroupsDialog);
    $('groupsDialog').addEventListener('cancel', (e) => { e.preventDefault(); closeGroupsDialog(); });

    // Playlist und Bereich wechseln
    $('plBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePlaylistMenu(); });
    $('plMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-pl]');
      if (b) { switchPlaylist(b.dataset.pl); return; }
      const a = e.target.closest('[data-pl-action]');
      if (!a) return;
      togglePlaylistMenu(false);
      if (a.dataset.plAction === 'add') $('addBtn').click(); else $('settingsBtn').click();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#playlistSwitch')) togglePlaylistMenu(false); });
    $('sections').addEventListener('click', (e) => {
      const b = e.target.closest('[data-section]');
      if (b) setSection(b.dataset.section);
    });
    // "Auch gefunden in …": Bereich wechseln, Suchbegriff behalten
    for (const id of ['listAlso', 'vodAlso']) {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('[data-goto]');
        if (b) setSection(b.dataset.goto);
      });
    }

    // Kategorien
    $('rail').addEventListener('click', (e) => {
      const hide = e.target.closest('[data-hide-group]');
      if (hide) { e.stopPropagation(); hideGroup(section, hide.dataset.hideGroup); return; }
      if (e.target.closest('#railEdit')) { openGroupsDialog(); return; }
      const b = e.target.closest('.rail-item');
      if (!b) return;
      filters[section] = b.dataset.filter;
      if (query) { query = ''; $('search').value = ''; }
      if (openShow >= 0) { openShow = -1; $('showView').hidden = true; $('vodBrowse').hidden = false; }
      renderRail();
      applyFilter();
    });
    $('rail').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('rail-item')) { e.preventDefault(); e.target.click(); }
    });

    // Suche: immer über alle Gruppen des Bereichs
    $('search').addEventListener('input', debounce((e) => {
      query = e.target.value;
      if (openShow >= 0 && query.trim()) { openShow = -1; $('showView').hidden = true; $('vodBrowse').hidden = false; }
      renderRail();
      applyFilter();
    }, 120));
    $('search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && visible.length) {
        e.target.blur();
        if (section === 'live') tune(visible[0]);
        else if (section === 'movie') playVod(visible[0]);
        else openShowView(visible[0]);
      }
      if (e.key === 'ArrowDown' && section === 'live') { e.preventDefault(); e.target.blur(); moveSelection(0, true); }
      if (e.key === 'Escape' && e.target.value) {
        e.stopPropagation();
        e.target.value = ''; query = ''; renderRail(); applyFilter();
      }
    });

    // Programmübersicht
    $('guideOpenBtn').addEventListener('click', openGuide);
    $('guideClose').addEventListener('click', () => closeGuide());
    $('guideNowBtn').addEventListener('click', () => scrollGuideTo(Date.now() - 30 * 60000));
    $('guidePrime').addEventListener('click', () => {
      const d = new Date();
      if (d.getHours() >= 22) d.setDate(d.getDate() + 1);
      d.setHours(20, 0, 0, 0);
      scrollGuideTo(d.getTime());
    });
    const guideShift = (h) => { const sc = $('guideScroll'); sc.scrollLeft += h * G_HOUR; renderGuide(); };
    $('guidePrev').addEventListener('click', () => guideShift(-3));
    $('guideNext').addEventListener('click', () => guideShift(3));
    let guideRaf = 0;
    $('guideScroll').addEventListener('scroll', () => {
      if (guideRaf) return;
      guideRaf = requestAnimationFrame(() => { guideRaf = 0; renderGuide(); });
    }, { passive: true });
    $('guideScroll').addEventListener('click', (e) => {
      const ch = e.target.closest('[data-tune]');
      if (ch) { tuneFromGuide(+ch.dataset.tune); return; }
      const pr = e.target.closest('.g-prog');
      if (pr) showGuideDetail(+pr.dataset.ch, +pr.dataset.k);
    });
    $('guideScroll').addEventListener('error', (e) => {
      const img = e.target;
      if (img.tagName === 'IMG') img.parentNode.textContent = img.dataset.fallback || '';
    }, true);
    $('guideDetail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') $('guideDetail').hidden = true;
      else if (b.dataset.act === 'watch') tuneFromGuide(+b.dataset.ch);
    });
    new ResizeObserver(() => renderGuide()).observe($('guideScroll'));

    // Favoriten per Ziehen sortieren
    const scrollEl = $('listScroll');
    let dragUrl = null;
    const dropLine = document.createElement('div');
    dropLine.className = 'drop-line';
    const dropPos = (e) => {
      const r = scrollEl.getBoundingClientRect();
      return Math.max(0, Math.min(visible.length, Math.round((e.clientY - r.top + scrollEl.scrollTop) / ROW_H)));
    };
    scrollEl.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.row.draggable');
      if (!row) { e.preventDefault(); return; }
      dragUrl = all[+row.dataset.i].url;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragUrl);
      row.classList.add('dragging');
    });
    scrollEl.addEventListener('dragover', (e) => {
      if (!dragUrl) return;
      e.preventDefault();
      dropLine.style.top = dropPos(e) * ROW_H - 1 + 'px';
      if (!dropLine.parentNode) scrollEl.appendChild(dropLine);
    });
    scrollEl.addEventListener('dragleave', (e) => { if (!scrollEl.contains(e.relatedTarget)) dropLine.remove(); });
    scrollEl.addEventListener('drop', (e) => {
      if (!dragUrl) return;
      e.preventDefault();
      moveFavorite(dragUrl, dropPos(e));
      dragUrl = null;
      dropLine.remove();
    });
    scrollEl.addEventListener('dragend', () => { dragUrl = null; dropLine.remove(); renderList(); });

    // Senderliste
    const scroll = $('listScroll');
    scroll.addEventListener('scroll', () => requestAnimationFrame(renderList), { passive: true });
    scroll.addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) { e.stopPropagation(); toggleFavorite(+star.dataset.star); return; }
      const hide = e.target.closest('[data-hide]');
      if (hide) { e.stopPropagation(); hideChannel(+hide.dataset.hide); return; }
      const row = e.target.closest('.row');
      if (row) tune(+row.dataset.i);
    });
    const imgFallback = (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG') return;
      if (img.dataset.fallback !== undefined) img.parentNode.textContent = img.dataset.fallback;
      else img.remove(); // Poster: Platzhalter darunter bleibt sichtbar
    };
    scroll.addEventListener('error', imgFallback, true);
    new ResizeObserver(() => renderList()).observe(scroll);

    // Poster-Raster
    const grid = $('gridScroll');
    grid.addEventListener('scroll', () => requestAnimationFrame(renderGrid), { passive: true });
    grid.addEventListener('error', imgFallback, true);
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      if (card.dataset.movie !== undefined) playVod(+card.dataset.movie);
      else openShowView(+card.dataset.show);
    });
    grid.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('card')) e.target.click(); });
    new ResizeObserver(() => renderGrid()).observe(grid);

    // Serien-Detail
    $('showBack').addEventListener('click', closeShowView);
    $('showView').addEventListener('error', imgFallback, true);
    $('showPlay').addEventListener('click', (e) => playVod(+e.currentTarget.dataset.ep));
    $('seasonTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-season]');
      if (b) { openSeason = +b.dataset.season; renderSeason(); }
    });
    $('episodeList').addEventListener('click', (e) => {
      const li = e.target.closest('[data-ep]');
      if (li) playVod(+li.dataset.ep);
    });
    $('episodeList').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.ep) e.target.click(); });

    document.addEventListener('keydown', onKey);
  }

  function moveSelection(delta, absolute = false) {
    if (!visible.length) return;
    let pos = visible.indexOf(selected);
    pos = absolute ? delta : Math.max(0, Math.min(visible.length - 1, (pos < 0 ? 0 : pos + delta)));
    selected = visible[pos];
    scrollToSelected(false);
    renderList();
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    // Strg+1…9: Playlist wechseln (auch während der Suche)
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) && store.playlists.length > 1) {
      const pl = store.playlists[+e.key - 1];
      if (pl) { e.preventDefault(); switchPlaylist(pl.id); }
      return;
    }
    if (e.target.matches('input, select, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (!$('welcome').hidden) return;
    const fs = document.body.classList.contains('is-fullscreen');

    if (e.key === '/') { e.preventDefault(); $('search').focus(); $('search').select(); return; }
    if (e.key === 'Escape' && !$('audioMenu').hidden) { closeAudioMenu(); return; }
    if (e.key === 'Escape' && !$('plMenu').hidden) { togglePlaylistMenu(false); return; }
    if (e.key === 'Escape' && document.body.classList.contains('mini')) { toggleMini(false); return; }
    if (e.key === 'p' || e.key === 'P') { toggleMini(); return; }
    if (e.key === '+' || e.key === '=') { setVolume(store.volume + 0.05); wakeUI(); return; }
    if (e.key === '-') { setVolume(store.volume - 0.05); wakeUI(); return; }
    // Programmübersicht
    if (guideOpen) {
      if (e.key === 'Escape') { if (!$('guideDetail').hidden) $('guideDetail').hidden = true; else closeGuide(); }
      else if (e.key === 'g' || e.key === 'G') closeGuide();
      else if (e.key === 'ArrowRight') { $('guideScroll').scrollLeft += G_HOUR; }
      else if (e.key === 'ArrowLeft') { $('guideScroll').scrollLeft -= G_HOUR; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); $('guideScroll').scrollTop += G_ROW; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); $('guideScroll').scrollTop -= G_ROW; }
      return;
    }

    // Film oder Folge läuft
    if (playingKind === 'vod') {
      switch (e.key) {
        case ' ': case 'k': case 'K': e.preventDefault(); togglePause(); break;
        case 'ArrowLeft': e.preventDefault(); skip(e.shiftKey ? -60 : -10); break;
        case 'ArrowRight': e.preventDefault(); skip(e.shiftKey ? 60 : 10); break;
        case 'ArrowUp': e.preventDefault(); setVolume(store.volume + 0.05); wakeUI(); break;
        case 'ArrowDown': e.preventDefault(); setVolume(store.volume - 0.05); wakeUI(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'm': case 'M': setMuted(!store.muted); break;
        case 'n': case 'N': { const nx = nextEpisode(playing); if (nx !== null) playVod(nx); break; }
        case 'a': case 'A': cycleAudioTrack(); wakeUI(); break;
        case 'Escape': if (fs) toggleFullscreen(false); else closeVod(); break;
      }
      return;
    }

    if (section !== 'live') {
      if (e.key === 'Escape') {
        if (openShow >= 0) closeShowView();
        else if (query) { query = ''; $('search').value = ''; renderRail(); applyFilter(); }
      }
      return;
    }

    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) { typeDigit(e.key); return; }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey && filters.live === 'fav' && selected >= 0) moveFavorite(all[selected].url, Math.max(0, visible.indexOf(selected) - 1));
        else if (fs || e.ctrlKey || document.body.classList.contains('mini')) zap(-1); else moveSelection(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey && filters.live === 'fav' && selected >= 0) moveFavorite(all[selected].url, visible.indexOf(selected) + 2);
        else if (fs || e.ctrlKey || document.body.classList.contains('mini')) zap(1); else moveSelection(1);
        break;
      case 'PageUp': e.preventDefault(); zap(-1); break;
      case 'PageDown': e.preventDefault(); zap(1); break;
      case 'Enter': if (selected >= 0) tune(selected); break;
      case ' ': e.preventDefault(); togglePause(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'Escape':
        if (fs) toggleFullscreen(false);
        else if (query) { query = ''; $('search').value = ''; renderRail(); applyFilter(); }
        break;
      case 'm': case 'M': setMuted(!store.muted); break;
      case 's': case 'S': if (selected >= 0) toggleFavorite(selected); break;
      case 'h': case 'H': if (selected >= 0 && !fs) hideChannel(selected); break;
      case 'ArrowRight': skip(e.shiftKey ? 60 : 10); break;
      case 'ArrowLeft': skip(e.shiftKey ? -60 : -10); break;
      case 'Backspace': e.preventDefault(); zapBack(); break;
      case 'g': case 'G': if (!fs) openGuide(); break;
      case 'a': case 'A': cycleAudioTrack(); wakeUI(); break;
      case 'i': case 'I': if (playing >= 0) showOsd(numberOf.get(playing), all[playing].name, all[playing].group, false, playing); break;
    }
  }

  let editingPl = null;
  const fmtWhen = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

  function epgStatus(p) {
    const info = store.epgInfo[p.id];
    if (!info) return 'Programmdaten: noch nicht geladen';
    if (info.error) return `Programmdaten: Fehler (${info.error})`;
    return `Programmdaten: ${n(info.matched || 0)} Sender zugeordnet, aktualisiert ${fmtWhen(info.fetchedAt)}`;
  }

  function renderManage() {
    const ul = $('plManage');
    if (!store.playlists.length) { ul.innerHTML = '<li class="empty">Keine Playlisten.</li>'; return; }
    ul.innerHTML = store.playlists.map((p) => {
      const isActive = p.id === pid();
      if (editingPl === p.id) {
        const fromPlaylist = isActive ? playlistEpgUrl : '';
        return `<li class="editing" data-edit="${esc(p.id)}">` +
          `<label class="field"><span>Name</span><input data-f="name" type="text" value="${esc(p.name)}"></label>` +
          `<label class="field"><span>Link zum Programmführer (XMLTV, optional)</span>` +
          `<input data-f="epg" type="url" value="${esc(p.epgUrl || '')}" placeholder="${esc(fromPlaylist || 'https://anbieter.example/epg.xml.gz')}">` +
          `<small>${fromPlaylist ? 'Leer lassen, um den Link aus der Playlist zu verwenden.' : 'Viele Anbieter nennen ihn „EPG-URL“ oder „XMLTV“.'}</small></label>` +
          `<div class="modal-actions"><span class="spacer"></span>` +
          `<button class="btn ghost small" data-act="cancel">Abbrechen</button>` +
          `<button class="btn primary small" data-act="save" data-id="${esc(p.id)}">Speichern</button></div></li>`;
      }
      return `<li><div class="pl-info"><span class="pl-name">${esc(p.name)}${isActive ? ' <span class="pill">aktiv</span>' : ''}</span>` +
        `<span class="pl-src" title="${esc(p.source.value)}">${esc(countsLabel(p))}, aktualisiert ${esc(fmtWhen(p.updatedAt))}</span>` +
        `<span class="pl-src">${esc(epgStatus(p))}</span></div>` +
        `<div class="pl-actions">` +
        `<button class="btn ghost small" data-act="edit" data-id="${esc(p.id)}">Bearbeiten</button>` +
        `<button class="btn ghost small" data-act="refresh" data-id="${esc(p.id)}">Aktualisieren</button>` +
        `<button class="btn link small danger" data-act="remove" data-id="${esc(p.id)}">Entfernen</button></div></li>`;
    }).join('');
    const first = ul.querySelector('.editing input');
    if (first) first.focus();
  }

  let appInfo = null;
  api.appInfo().then((i) => { appInfo = i; }).catch(() => {});

  const LICENSE_LABELS = {
    'electron-MIT': 'Electron (MIT)',
    'hls.js-Apache-2.0': 'hls.js (Apache 2.0)',
    'mpegts.js-Apache-2.0': 'mpegts.js, von Signal verändert (Apache 2.0)',
    'es6-promise-MIT': 'es6-promise (MIT)',
    'events-MIT': 'events (MIT)',
    'bricolage-grotesque-OFL-1.1': 'Schrift Bricolage Grotesque (SIL OFL 1.1)',
    'instrument-sans-OFL-1.1': 'Schrift Instrument Sans (SIL OFL 1.1)',
  };
  async function openAbout() {
    if (!appInfo) appInfo = await api.appInfo();
    $('aboutVersion').textContent = `Version ${appInfo.version}, Electron ${appInfo.electron}, Chromium ${appInfo.chrome.split('.')[0]}`;
    $('aboutLicenses').innerHTML = appInfo.licenses.map((l) =>
      `<details><summary>${esc(LICENSE_LABELS[l.name] || l.name)}</summary><pre>${esc(l.text)}</pre></details>`).join('') +
      '<p class="about-small">Electron enthält Chromium; dessen Lizenzen liegen als LICENSES.chromium.html im Programmordner.</p>';
    $('settingsDialog').close();
    $('aboutDialog').showModal();
  }

  function friendlyLoadError(err) {
    const msg = String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (/Invalid URL|Failed to parse URL/i.test(msg)) return 'Das ist kein gültiger Link. Er sollte mit http:// oder https:// beginnen.';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) return 'Der Server ist nicht erreichbar. Prüfe den Link und deine Internetverbindung.';
    return msg;
  }

  // Für den automatischen Test (test/bench.js): Zustand des Players auslesen
  window.__signalDebug = () => ({ tracks: player.audioTracks, bufTarget: player.bufTarget, engine: player.engine, holding: player.holding,
    epgMatched: epgMatchedCount(), playing, playingName: playing >= 0 ? all[playing].name : null, prevChannel, timeshift: !!player.timeshift,
    favorites: (store.favorites[pid()] || []).map((u) => (all.find((c) => c.url === u) || {}).name), playlists: store.playlists.map((p) => p.name) });

  init();
})();
