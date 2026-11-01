# Änderungen

Alle nennenswerten Änderungen an Signal. Die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

## [1.5.0] – 2026-11-01

### Neu
- **Multiview:** bis zu 4 Sender derselben Playlist gleichzeitig, als 2 nebeneinander, 2×2 oder einer groß und
  drei klein. Das markierte Feld bekommt den nächsten Sender aus der Liste, Ton kommt aus dem Feld mit dem
  Lautsprecher. Doppelklick zeigt ein Feld groß. Lässt der Anbieter keine weitere Verbindung zu, sagt Signal das
  im betroffenen Feld.
- **Verschiebbare Spalten:** Kategorien und Senderliste lassen sich mit der Maus (oder Pfeiltasten) breiter
  und schmaler ziehen, damit lange Sendernamen ganz sichtbar sind. Doppelklick auf den Trenner setzt zurück.

### Verbessert
- Sendernamen nutzen die volle Zeilenbreite; Ausblenden und Favorit erscheinen erst beim Überfahren
- Voller Name und laufende Sendung als Tooltip

## [1.4.0] – 2026-10-28

Erste öffentliche Version.

### Neu
- „Über Signal“ mit Version, Lizenzen aller mitgelieferten Komponenten und Links zum Projekt
- Hinweis im Willkommensbildschirm, dass Signal keine Inhalte enthält
- Installer (mit Startmenü- und Desktop-Verknüpfung) und portable Version, Vorbereitung für den Microsoft Store
- Unit-Tests und Skript zum Erzeugen aller Testmedien

## [1.3.0] – 2026-10-28

### Neu
- Programmführer (XMLTV, auch `.xml.gz`): laufende Sendung mit Fortschritt in der Senderliste, Sendung und
  „Danach“ in der Senderanzeige, Programmübersicht als Zeitraster mit Details
- Playlist-Umschalter mit Menü, `Strg`+`1`–`9`, Umbenennen und eigenem EPG-Link pro Playlist
- Playlisten aktualisieren sich einmal am Tag automatisch
- Live zurückspulen (bis zu 2 Minuten) mit „Live“-Knopf
- Mini-Player, der im Vordergrund bleibt
- Vorheriger Sender per Rücktaste
- Favoriten per Ziehen oder `Alt`+`↑`/`↓` sortieren

## [1.2.0] – 2026-10-28

### Neu
- Tonspur-Auswahl für MPEG-TS, HLS, MP4 und MKV; die gewählte Sprache gilt für alle Sender
- Einstellbarer Live-Puffer

### Verbessert
- Deutlich flüssigere Livestreams: Vorpuffer, adaptives Nachpuffern, kein Springen zur Live-Kante mehr,
  Überspringen kleiner Lücken

### Behoben
- Sender mit Dolby Digital als erster Tonspur starteten nicht
- Bei Zeitstempel-Sprüngen im Stream blieb das Bild dauerhaft stehen (Fehler in mpegts.js, per Patch behoben)

## [1.1.0] – 2026-10-27

### Neu
- Bereiche für Filme und Serien mit Postern, Staffeln, Fortsetzen und automatisch nächster Folge
- Sender und ganze Gruppen ausblenden, mit Rückgängig und Auswahldialog
- Suche über alle Gruppen, mit Treffern aus den anderen Bereichen

## [1.0.0] – 2026-10-27

- Erste Version: M3U-Playlisten per Link oder Datei, Gruppen, Logos, Favoriten, Suche, Senderanzeige,
  Zifferneingabe, HLS- und MPEG-TS-Wiedergabe, „In VLC öffnen“
