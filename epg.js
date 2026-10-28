// XMLTV-Programmführer laden (Hauptprozess).
// Liest die Datei als Stream (auch .xml.gz), ohne sie ganz in den Speicher zu laden,
// und behält nur Sendungen im Zeitfenster und nur für Sender, die in der Playlist vorkommen.
const zlib = require('zlib');
const { Readable } = require('stream');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

// "20261028201500 +0100" -> Millisekunden (UTC)
function parseTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}):?(\d{2})?/.exec(s || '');
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const sign = m[7][0] === '-' ? -1 : 1;
  const off = sign * (Math.abs(parseInt(m[7], 10)) * 60 + parseInt(m[8] || '0', 10));
  return utc - off * 60000;
}

// Reguläre Ausdrücke einmal anlegen statt pro Sendung (große EPGs haben Hunderttausende)
const ATTR_RE = {};
for (const n of ['id', 'channel', 'start', 'stop']) ATTR_RE[n] = new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
const CHILD_RE = {};
for (const n of ['title', 'desc', 'sub-title', 'display-name']) CHILD_RE[n] = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'g');

const attr = (tag, name) => {
  const m = ATTR_RE[name].exec(tag);
  return m ? decode(m[1] ?? m[2]) : '';
};
const child = (body, name) => {
  const re = CHILD_RE[name];
  re.lastIndex = 0;
  const m = re.exec(body);
  return m ? decode(m[1]) : '';
};
const children = (body, name) => {
  const re = CHILD_RE[name];
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push(decode(m[1]));
  return out;
};

/**
 * @param {string} url             Link zur XMLTV-Datei
 * @param {object} opts
 * @param {string} opts.userAgent
 * @param {number} opts.from       Zeitfenster-Anfang (ms)
 * @param {number} opts.to         Zeitfenster-Ende (ms)
 * @param {Set<string>|null} opts.wantIds    tvg-ids aus der Playlist (klein geschrieben)
 * @param {Set<string>|null} opts.wantNames  normalisierte Sendernamen aus der Playlist
 * @param {(n:string)=>string} opts.normName Normalisierung für Namen
 */
async function loadEpg(url, { userAgent, from, to, wantIds, wantNames, normName }) {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'follow' });
  if (!res.ok) throw new Error(`EPG-Server antwortet mit ${res.status} ${res.statusText}`);

  // gzip an den ersten Bytes erkennen, nicht an der Endung
  const it = Readable.fromWeb(res.body)[Symbol.asyncIterator]();
  const head = await it.next();
  let stream = Readable.from((async function* () {
    if (!head.done) yield head.value;
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      yield r.value;
    }
  })());
  const first = head.done ? null : head.value;
  if (first && first[0] === 0x1f && first[1] === 0x8b) stream = stream.pipe(zlib.createGunzip());

  const channels = {};    // id -> [Anzeigenamen]
  const programmes = {};  // id -> [[start, stop, title, desc, subtitle]]
  let count = 0;
  let buf = '';
  const decoder = new TextDecoder('utf-8');

  // Welche EPG-Sender gebraucht werden, entscheidet sich beim <channel>-Eintrag (id oder Name).
  // Sendungen anderer Sender werden übersprungen, ohne sie auszuwerten.
  const filtering = !!(wantIds || wantNames);
  const wanted = new Set();
  const isWanted = (id, names) => (wantIds && wantIds.has(id.toLowerCase()))
    || (wantNames && names.some((n) => wantNames.has(normName(n))));

  const handleChannel = (block) => {
    const open = block.slice(0, block.indexOf('>') + 1);
    const id = attr(open, 'id');
    if (!id) return;
    const names = children(block, 'display-name');
    channels[id] = names;
    if (filtering && isWanted(id, names)) wanted.add(id);
  };
  const handleProgramme = (src, startIdx, tagEnd, endIdx) => {
    const open = src.slice(startIdx, tagEnd + 1);
    const ch = attr(open, 'channel');
    if (!ch) return;
    // Sender ohne <channel>-Eintrag: nur über die tvg-id prüfbar
    if (filtering && !wanted.has(ch) && !(channels[ch] === undefined && wantIds && wantIds.has(ch.toLowerCase()))) return;
    const start = parseTime(attr(open, 'start'));
    let stop = parseTime(attr(open, 'stop'));
    if (!Number.isFinite(start)) return;
    if (!Number.isFinite(stop)) stop = start + 30 * 60000;
    if (stop < from || start > to) return;
    const block = src.slice(tagEnd + 1, endIdx);
    const desc = child(block, 'desc');
    (programmes[ch] || (programmes[ch] = [])).push([
      start, stop, child(block, 'title') || 'Ohne Titel',
      desc.length > 400 ? desc.slice(0, 397) + '…' : desc,
      child(block, 'sub-title'),
    ]);
    count++;
  };

  const TAG_RE = /<(programme|channel)\b/g;
  const drain = (final) => {
    let pos = 0;
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(buf))) {
      const next = m.index;
      const isProg = m[1] === 'programme';
      const tagEnd = buf.indexOf('>', next);
      if (tagEnd < 0) break;
      let end;
      if (buf[tagEnd - 1] === '/') end = tagEnd + 1;
      else {
        const endTag = isProg ? '</programme>' : '</channel>';
        const e = buf.indexOf(endTag, tagEnd);
        if (e < 0) break;
        end = e + endTag.length;
      }
      if (isProg) handleProgramme(buf, next, tagEnd, end); else handleChannel(buf.slice(next, end));
      pos = end;
      TAG_RE.lastIndex = end;
    }
    buf = final ? '' : buf.slice(pos);
    // Schutz vor Dateien ohne passende Tags: Puffer nicht endlos wachsen lassen
    if (buf.length > 4 * 1024 * 1024) buf = buf.slice(-1024 * 1024);
  };

  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    drain(false);
  }
  buf += decoder.decode();
  drain(true);

  const keep = {};
  for (const id of Object.keys(programmes)) {
    keep[id] = { names: channels[id] || [], list: programmes[id].sort((a, b) => a[0] - b[0]) };
  }
  return { fetchedAt: Date.now(), totalProgrammes: count, channels: keep };
}

module.exports = { loadEpg, parseTime };
