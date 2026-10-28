# Drittanbieter-Komponenten / Third-party notices

Signal enthält oder verwendet die folgenden Komponenten. Die vollständigen Lizenztexte liegen im Ordner
[`licenses/`](licenses/) und werden mit der App ausgeliefert (sichtbar unter „Über Signal“).

| Komponente | Version | Lizenz | Copyright | Verwendung |
|---|---|---|---|---|
| [Electron](https://www.electronjs.org/) | 45 | MIT | Electron contributors, GitHub Inc. | Laufzeitumgebung. Electron enthält Chromium und weitere Komponenten; deren Lizenzen liefert Electron selbst als `LICENSES.chromium.html` im Programmordner mit. |
| [hls.js](https://github.com/video-dev/hls.js) | 1.7.3 | Apache-2.0 | Dailymotion, Brightcove | Wiedergabe von HLS-Streams (`.m3u8`) |
| [mpegts.js](https://github.com/xqq/mpegts.js) | 1.8.2, **verändert** | Apache-2.0 | Bilibili, magicxqq | Wiedergabe von MPEG-TS-Livestreams |
| [es6-promise](https://github.com/stefanpenner/es6-promise) | 4.2.8 | MIT | Yehuda Katz, Tom Dale, Stefan Penner u. a. | in mpegts.js enthalten |
| [events](https://github.com/browserify/events) | 3.3.0 | MIT | Joyent, Inc. and other Node contributors | in mpegts.js enthalten |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | 5.3.0 (Fontsource) | SIL OFL 1.1 | The Bricolage Grotesque Project Authors | Schrift |
| [Instrument Sans](https://github.com/Instrument/instrument-sans) | 5.3.0 (Fontsource) | SIL OFL 1.1 | The Instrument Sans Project Authors | Schrift |

## Änderungen an mpegts.js

Die mitgelieferte Datei `renderer/vendor/mpegts.js` ist gegenüber mpegts.js 1.8.2 verändert
(Apache-2.0, Abschnitt 4b). Die Änderungen stehen vollständig in
[`patches/mpegts.js-1.8.2-signal.patch`](patches/mpegts.js-1.8.2-signal.patch):

- Alle Tonspuren aus der PMT werden mit PID, Codec und Sprache gemeldet; gewählt wird die gewünschte Spur,
  sonst die bevorzugte Sprache, sonst die erste abspielbare. DVB-AC-3/E-AC-3 wird erkannt.
- Zeitstempel-Sprünge in Livestreams werden zu einer durchgehenden Zeitachse geglättet.

Die geänderte Fassung steht wie das Original unter der Apache License 2.0.
