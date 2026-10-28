# Mitmachen

Schön, dass du helfen willst. Ein paar Punkte, damit es für alle einfach bleibt.

## Fehler melden

- Nutze die Vorlage für Fehlerberichte.
- **Poste niemals Playlist- oder EPG-Links mit Benutzername oder Passwort.** Wenn ein Fehler nur mit einem
  bestimmten Sender auftritt, hilft ein Ausschnitt der `#EXTINF`-Zeile und die Art des Links
  (endet auf `.ts`, `.m3u8`, ohne Endung …) mit unkenntlich gemachten Zugangsdaten.
- Fragen nach Anbietern oder Playlisten werden geschlossen. Signal liefert und empfiehlt keine Inhalte.

## Code beitragen

1. Lies [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md), dort stehen Aufbau, Build und Tests.
2. Größere Änderungen bitte vorher in einem Issue absprechen.
3. Halte dich an den vorhandenen Stil: einfaches JavaScript ohne Framework, deutsche Oberflächentexte
   in ganzen Sätzen, Kommentare auf Deutsch.
4. `npm test` muss durchlaufen. Bei Änderungen an Wiedergabe oder Oberfläche bitte auch die passenden
   Oberflächentests aus der Entwicklerdoku laufen lassen.
5. Beschreibe im Pull Request, was sich für Nutzer ändert.

Mit einem Beitrag erklärst du dich einverstanden, dass er unter der [MIT-Lizenz](LICENSE) veröffentlicht wird.
