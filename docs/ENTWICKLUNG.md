# Signal entwickeln

Technische Dokumentation für alle, die an Signal mitarbeiten oder es selbst bauen wollen.
Für Nutzer ist die [README](../README.md) gedacht.

## Loslegen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

## Bauen

| Befehl | Ergebnis | Wo ausführen |
|---|---|---|
| `npm run dist` | Installer (`Signal-Setup-x.y.z.exe`) und portable `.exe` | Windows |
| `npm run dist:zip` | ZIP mit dem Programmordner | Windows, Linux, macOS |
| `npm run dist:store` | MSIX-Paket für den Microsoft Store | Windows (siehe [VEROEFFENTLICHEN.md](VEROEFFENTLICHEN.md)) |

Die Ergebnisse landen in `dist/`. Releases baut der GitHub-Workflow `.github/workflows/release.yml`
automatisch, sobald ein Tag wie `v1.4.0` gepusht wird.

## Aufbau

```
main.js             Hauptprozess: Fenster, Dateien, Netzwerk (CORS/User-Agent), EPG, Mini-Player, VLC
epg.js              XMLTV-Programmführer streamend laden (auch .gz), auf die Playlist filtern
preload.js          sichere Brücke zwischen Oberfläche und Hauptprozess
renderer/
  index.html        Oberfläche
  app.js            Listen, Raster, Programmübersicht, Player-Logik, Puffer-Wächter, Tonspuren
  m3u.js            M3U-Parser, Erkennung von Live/Film/Serie, Namensabgleich fürs EPG
  styles.css        Design
  vendor/mpegts.js  gepatchte mpegts.js (siehe unten)
licenses/           Lizenztexte der mitgelieferten Komponenten (werden mit ausgeliefert)
patches/            Patch für mpegts.js
scripts/            Build-Skript für den Patch, Testmedien, Repo-Name eintragen
test/               Unit-Tests, Oberflächentests, Wiedergabe-Messung, Testserver
build/              Icons für Installer und Store
```

Daten liegen pro Nutzer unter `%APPDATA%\Signal`: `store.json` (Einstellungen, Favoriten, Fortschritt),
`playlists/<id>.json` (zwischengespeicherte Playlisten) und `epg/<id>.json` (Programmführer).

### Sicherheit

Der Renderer läuft mit `contextIsolation`, `sandbox` und ohne `nodeIntegration`. Er spricht nur über die
Funktionen in `preload.js` mit dem Hauptprozess. Die Content-Security-Policy erlaubt Skripte nur aus der App
selbst. Externe Links öffnet der Hauptprozess ausschließlich, wenn sie mit `https://` beginnen.

Weil viele IPTV-Server keine CORS-Header senden, ergänzt der Hauptprozess sie für Antworten (`main.js`,
`setupNetwork`). Das ist nötig, damit hls.js und mpegts.js Streams lesen dürfen.

## Live-Wiedergabe und mpegts.js-Patch

Live-MPEG-TS läuft über [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.2 mit einem eigenen Patch
(`patches/mpegts.js-1.8.2-signal.patch`, gebaut nach `renderer/vendor/mpegts.js`):

- **Tonspuren:** Alle Spuren aus der PMT werden mit Sprache und Codec gemeldet. Gewählt wird die gewünschte Spur,
  sonst die bevorzugte Sprache, sonst die erste abspielbare. Nicht abspielbare Spuren (z. B. Dolby Digital ohne
  Decoder) werden übersprungen, statt den Sender zu blockieren. DVB-AC-3/E-AC-3 wird erkannt.
- **Zeitstempel-Sprünge** (Encoder-Neustart, Werbung, Endlosschleifen) werden zu einer durchgehenden Zeitachse
  geglättet. Vorher verwarf die Bibliothek danach allen Ton, und das Bild blieb stehen.

In `app.js` sorgt ein Wächter für Vorpuffer vor dem Start, Nachpuffern bei leerem Puffer (das Ziel wächst nach
jedem Aussetzer), Überspringen kleiner Lücken, Anschubsen eines stehenden Decoders und sanftes Aufholen per
Wiedergabegeschwindigkeit statt harter Sprünge.

Patch neu bauen (nur nach einem Update von mpegts.js nötig, braucht Git): `npm run build:mpegts`

## Tests

```bash
npm test                      # Unit-Tests (Parser, EPG), laufen auch in der CI
```

Die Oberflächen- und Wiedergabetests starten die echte App gegen einen lokalen Testserver mit synthetischen
Medien (Testbilder, Sinustöne, ausgedachte Sender). Dafür werden ffmpeg und Python mit Pillow gebraucht:

```bash
npm run test:media                          # erzeugt test-media/ (dauert ca. 1–2 Minuten)
python3 test/testserver.py test-media       # Testserver auf http://127.0.0.1:8099, eigenes Terminal

# Jeweils in einem zweiten Terminal (Windows: Variablen mit "set" bzw. $env: setzen)
SIGNAL_E2E=out SIGNAL_PLAYLIST=http://127.0.0.1:8099/full.m3u npm start              # Oberfläche, Filme, Serien
SIGNAL_FEATURES_E2E=out SIGNAL_PLAYLIST=http://127.0.0.1:8099/epg_a.m3u \
  SIGNAL_PLAYLIST_B=http://127.0.0.1:8099/epg_b.m3u npm start                         # EPG, Playlisten, Mini-Player
SIGNAL_AUDIO_E2E=out SIGNAL_PLAYLIST=http://127.0.0.1:8099/audio.m3u npm start       # Tonspuren
SIGNAL_BENCH=out/bench.json SIGNAL_PLAYLIST=http://127.0.0.1:8099/bench2.m3u npm start  # Hänger messen
SIGNAL_SCREENSHOTS=docs/screenshots SIGNAL_PLAYLIST=http://127.0.0.1:8099/demo.m3u npm start  # Screenshots
```

Jeder Test schreibt ein Protokoll (`OK`/`FAIL` pro Prüfung) und Screenshots in den angegebenen Ordner und
beendet die App danach. Der Testserver simuliert typisches IPTV-Verhalten: `?jitter=1` (Aussetzer),
`?burst=<s>` (Anfangsburst) und `?loop=1` (Zeitstempel-Sprünge), siehe `test/testserver.py`.

## Technische Grenzen

- Chromium kann kein DTS-Audio und kein MPEG-2-Video, Dolby Digital (AC3/E-AC3) nur mit passendem
  Windows-Decoder, kein MPEG-1 Layer II (MP2). Signal prüft die Codecs beim Start (`AUDIO_SUPPORT` in `app.js`).
- Live-Zurückspulen ist auf etwa 2 Minuten begrenzt: Chromium erlaubt für Videopuffer nur rund 150 MB.
- In MKV/MP4 eingebettete Untertitel stellt Chromium nicht bereit.
- `#EXTVLCOPT`-Optionen pro Sender werden eingelesen, aber noch nicht angewendet; der User-Agent gilt global.
