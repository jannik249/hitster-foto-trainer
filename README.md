# 🎴 Hitster Foto-Trainer

Fotografiere deine echten Hitster-Karten, lade sie in Kartensets hoch und lerne damit.
Die App kennt keine Antworten – du deckst die Karte auf und bewertest dich selbst (✓ / ✗).

## Funktionen

- **Kartensets** (z. B. „Hitster Bingo“, „Hitster Rock“) – beliebig viele, jederzeit erweiterbar
- **Mehrere Fotos auf einmal** hochladen
- **Jahr erraten** – mittleres Drittel der Karte ist verdeckt
- **Interpret erraten** – oberes Drittel der Karte ist verdeckt
- Falsch (✗) → die Karte kommt 3–7 Karten später in derselben Runde nochmal
- **Nach jeder Runde:** Prozent der Karten, die beim ersten Versuch richtig waren
- **Schwierige Karten** (3. Modus, set-übergreifend): fragt automatisch alle Karten aus *allen*
  Kartensets ab, für die du zuletzt 2 oder mehr Versuche gebraucht hast
  (der Wert wird bei jedem Durchgang der Karte aktualisiert – eine Karte, die du dann gleich
  beim ersten Versuch richtig hast, fliegt wieder raus)
- Sichern / Wiederherstellen als JSON-Datei (inkl. Fotos und Versuchs-Historie)
- Hell-/Dunkel-Modus

## Als Android-App (APK)

Die APK wird automatisch von GitHub gebaut (Capacitor + GitHub Actions), du brauchst dafür
weder Android Studio noch einen PC.

1. Dieses Repo auf GitHub hochladen (Branch `main`).
2. Unter **Actions → Build Android APK** läuft der Build (ca. 5–10 Minuten).
   Manuell starten geht über „Run workflow“.
3. Danach unter **Releases → „Hitster Foto-Trainer (neuester Stand)“** die Datei
   `hitster-foto-trainer.apk` auf dem Handy herunterladen und installieren
   (Android fragt einmalig nach „Installation aus unbekannter Quelle“ für den Browser/Dateimanager).

### Warum die Daten in der App dauerhaft bleiben

- Fotos und Fortschritt liegen im privaten App-Speicher (IndexedDB der App-Webansicht),
  nicht im Browser-Cache – „Browserdaten löschen“ trifft sie nicht.
- Updates: Die APK wird immer mit demselben Schlüssel (`signing/debug.keystore`) signiert.
  Dadurch lässt sich eine neue Version **über die alte drüberinstallieren, ohne dass Daten verloren gehen**.
  Die App nicht deinstallieren, bevor du eine Sicherung gemacht hast!
- Trotzdem regelmäßig **„📤 Sichern“** nutzen: In der App öffnet sich der Android-Teilen-Dialog,
  dort z. B. in Google Drive speichern.

> Der Schlüssel in `signing/` ist ein reiner Debug-Schlüssel für den privaten Gebrauch und liegt
> bewusst im Repo. Das Repo daher am besten **privat** lassen. Für eine Veröffentlichung im Play Store
> bräuchte es einen eigenen, geheimen Release-Schlüssel.

## Als Einzeldatei im Browser

```
npm run build:standalone      # oder: python3 tools/build-standalone.py
```

erzeugt `dist/hitster-foto-trainer.html` (eine Datei, Doppelklick genügt).
Hinweis: Im Browser liegen die Daten im Browser-Speicher und sind dort weniger dauerhaft als in der App.

## Projektstruktur

```
www/                       Die eigentliche App (index.html, style.css, app.js)
capacitor.config.json      Android-Wrapper-Einstellungen
package.json               Capacitor-Abhängigkeiten
signing/debug.keystore     Fester Signaturschlüssel (für Updates ohne Datenverlust)
tools/build-standalone.py  Baut die Ein-Datei-Version
.github/workflows/         GitHub-Actions-Build der APK
```

Das Android-Projekt (`android/`) wird bei jedem Build mit `npx cap add android` frisch erzeugt
und ist deshalb nicht im Repo.

## Lokal ändern

Alles liegt in `www/`. Zum Testen `www/index.html` im Browser öffnen.
Änderungen auf `main` pushen → die APK wird automatisch neu gebaut.
