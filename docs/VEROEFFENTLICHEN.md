# Signal veröffentlichen: Schritt für Schritt

## 1. Vorher kurz prüfen

- [ ] Keine echten Anbieter, Playlisten oder Pay-TV-Marken in Code, Texten oder Bildern
      (die Screenshots in `docs/screenshots/` nutzen nur ausgedachte Sender und Testbilder)
- [ ] Name: „Signal“ ist auch der Name eines bekannten Messengers. README und „Über Signal“ stellen klar, dass
      es keine Verbindung gibt. Im Microsoft Store braucht der Eintrag einen Zusatz (siehe `STORE.md`).
- [ ] Falls du irgendwann Geld damit verdienst: ggf. Nebentätigkeit beim Arbeitgeber klären.

## 2. Auf GitHub hochladen

1. Auf GitHub ein neues, **öffentliches** Repository `signal` anlegen, ohne README und ohne Lizenz
   (beides ist schon da).
2. Im Projektordner deinen GitHub-Namen eintragen:
   ```bash
   npm run set-repo -- DEIN-NAME
   ```
3. Hochladen:
   ```bash
   git init -b main
   git add .
   git commit -m "Signal 1.4.0"
   git remote add origin https://github.com/DEIN-NAME/signal.git
   git push -u origin main
   ```
   Tipp: Wenn deine E-Mail-Adresse nicht öffentlich in der Historie stehen soll, stell sie vorher auf die
   `…@users.noreply.github.com`-Adresse aus deinen GitHub-Einstellungen (Settings → Emails):
   `git config user.email "ID+NAME@users.noreply.github.com"`.
4. Im Repository unter **Settings**:
   - **General → Features:** Issues an, Wiki aus.
   - **Code security → Private vulnerability reporting:** einschalten (für `SECURITY.md`).
   - **Actions → General → Workflow permissions:** „Read and write permissions“, damit der Release-Workflow
     Entwürfe anlegen darf.
5. Auf der Startseite des Repos rechts beim Zahnrad eine Beschreibung und Themen setzen, z. B.
   `iptv`, `m3u`, `epg`, `xmltv`, `electron`, `windows`, `iptv-player`.

## 3. Erstes Release

1. Version in `package.json` und `CHANGELOG.md` prüfen (aktuell `1.4.0`).
2. Tag setzen und hochladen:
   ```bash
   git tag v1.4.0
   git push origin v1.4.0
   ```
3. Unter **Actions** läuft „Release“ (ca. 5–10 Minuten). Danach liegt unter **Releases** ein Entwurf mit
   Installer, portabler Version und Prüfsummen. Text prüfen und **Publish release** klicken.

Für spätere Versionen: Version in `package.json` erhöhen, `CHANGELOG.md` ergänzen, committen, neues Tag pushen.

## 4. Microsoft Store

Der Store signiert die App selbst, damit entfällt die SmartScreen-Warnung.

1. **Konto:** Im [Partner Center](https://partner.microsoft.com/dashboard/registration) als Einzelentwickler
   registrieren. Für Einzelentwickler ist das kostenlos; du brauchst ein Microsoft-Konto und einen Ausweis zur
   Identitätsprüfung.
2. **Namen reservieren:** „Neues Produkt → MSIX- oder PWA-App“, Name aus `STORE.md`.
3. **Paketidentität eintragen:** Unter **Produktverwaltung → Produktidentität** stehen drei Werte. Trag sie in
   `package.json` unter `build.appx` ein:
   | Partner Center | package.json |
   |---|---|
   | Package/Identity/Name | `identityName` |
   | Package/Identity/Publisher | `publisher` (beginnt mit `CN=`) |
   | Package/Properties/PublisherDisplayName | `publisherDisplayName` |
4. **Paket bauen** (unter Windows, mit installiertem
   [Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/)):
   ```bash
   npm run dist:store
   ```
   Ergebnis: `dist/Signal-x.y.z-store.appx`.
5. **Einreichung anlegen:**
   - Preise und Verfügbarkeit: kostenlos, alle Märkte oder nur DACH
   - Eigenschaften: Kategorie und Datenschutz-URL aus `STORE.md`
   - Altersfreigaben: Fragebogen ausfüllen (Hinweis in `STORE.md`)
   - Pakete: die `.appx` hochladen
   - Store-Einträge: Texte aus `STORE.md`, Bildschirmfotos aus `docs/screenshots/`
   - Hinweise für die Zertifizierung: Text aus `STORE.md`
6. Einreichen. Die Prüfung dauert meist einige Tage. Lehnt der Store ab, steht im Bericht der Grund; häufig sind
   es Texte oder fehlende Testmöglichkeiten.

## 5. Danach

- Issues im Blick behalten. Fragen nach Anbietern oder Playlisten freundlich schließen
  (Signal liefert keine Inhalte).
- Jede neue Version: Release auf GitHub und neues Paket im Store einreichen (gleiche Schritte, Version erhöhen).
