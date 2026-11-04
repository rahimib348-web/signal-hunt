# Signal Hunt

Ein Fangspiel in der echten Welt für Android und iOS. Agenten fliehen durch die Stadt, der Jäger folgt ihren Signalen: Alle paar Minuten sieht er einen Kreis, in dem sich ein Agent versteckt. Gefangen ist, wessen Agenten-ID (QR-Code) der Jäger scannt.

Das vollständige Spielkonzept steht im Konzept-Dokument (Claude Docs).

## Stand: Schritt 1 (Grundgerüst)

- Lobby: Einsatz erstellen, per Code oder QR-Code beitreten, Rollen festlegen oder zufällig verteilen
- Einstellungen: Spielmodus (Doppelagent oder Festnahme), Vorsprung, Spieldauer
- Einsatzgebiet auf der Karte zeichnen, mit Größenempfehlung und Vorschlag um den eigenen Standort
- Vorsprung: Der Bildschirm des Jägers ist gesperrt
- Pings: 3 Phasen, die Kreise werden kleiner (250 m → 150 m → 75 m) und die Pings kommen häufiger (5 → 4 → 3 Min.)
- Vorwarnung 30 Sekunden vor jedem Ping für Agenten
- Warnung beim Verlassen des Einsatzgebiets
- Fangen per QR-Scan mit Entfernungsprüfung (höchstens 100 m)
- SOS-Knopf beendet die Runde sofort für alle
- Auswertung mit den Wegen aller Spieler auf der Karte, danach eine neue Runde mit derselben Gruppe
- Datenschutz: Spiele samt Standorten werden spätestens nach 24 Stunden gelöscht

## Stand: Schritt 2 (Spielspaß)

- Fähigkeiten: Jeder startet mit einer zufälligen Fähigkeit seiner Rolle, der Host kann einzelne ausschalten.
  - Agenten: **Störsender** (nächster Ping fällt aus, der Jäger sieht „Signal gestört“) und **Fake-Ping** (nächster Ping zeigt einen falschen Kreis, mindestens 300 m entfernt). Beide lassen sich schon im Vorsprung scharf schalten, Abklingzeit 10 Minuten.
  - Jäger: **Radar** (sofort ein Ping von allen Agenten) und **Kompass** (10 Sekunden Richtung zum nächsten Agenten, ohne Entfernung). Abklingzeit 8 Minuten. Nach jedem Fang gibt es eine neue Fähigkeit.
- Tote Briefkästen: 2 Minuten nach Jagdbeginn und danach alle 7 Minuten erscheint einer, nur auf Fußwegen aus OpenStreetMap (keine Straßenübergänge, Tunnel, Treppen oder privaten Wege). Agenten sehen ihn sofort, der Jäger nach 1 Minute. Wer zuerst bis auf 15 m herankommt, bekommt eine Fähigkeit. Nach 5 Minuten verschwindet er. Wer ihn geleert hat, erfährt der Jäger nicht.
- Strafe fürs Stillstehen: Wer sich 3 Minuten weniger als 20 m bewegt, bekommt einen Extra-Ping. Das Handy warnt nach 2 Minuten.
- Spielfeldgrenze: Wer das Einsatzgebiet verlässt, hat 30 Sekunden Zeit. Danach sieht der Jäger den genauen Standort, bis der Agent zurück ist. Das lässt sich weder stören noch fälschen.
- Sounds (Funkrauschen und Radar-Piepen beim Ping, Glitch beim Störsender, Alarm, Briefkasten-Ton), Vibration bei Warnungen und ein Ton-Schalter im Spiel
- Radar-Animation auf dem gesperrten Jäger-Bildschirm, Decknamen würfeln
- Auswertung zeigt, wer welche Fähigkeiten eingesetzt, Fake-Pings geschickt und Briefkästen geleert hat

## Datenschutz und Rechtliches

- Bildschirm „Datenschutz und Impressum“ (Link auf der Startseite) mit Impressum, Datenschutzerklärung und der eigenen anonymen Nutzer-ID. Die Texte stehen in `src/lib/legal-texts.ts`; vor der Veröffentlichung die Platzhalter in `LEGAL_CONTACT` ausfüllen.
- „Meine Daten löschen“ verlässt laufende Einsätze, gibt den Host ab und löscht das anonyme Konto samt aller Daten.
- Anonyme Nutzer, die 30 Tage lang nicht gespielt haben, löscht der Server jede Nacht automatisch.
- Bevor die App nach dem Standort fragt, erklärt ein deutlicher Hinweis, wofür (verlangt Google Play für den Standort im Hintergrund).

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/app/` | Bildschirme (Expo Router): Start, Beitreten, Spiel, Einsatzgebiet, QR-Scanner |
| `src/features/` | Lobby, Spielkarte und Auswertung |
| `src/lib/` | Server-Verbindung, Standort, Geometrie, Regeln |
| `supabase/migrations/` | Datenbank und alle Spielregeln (der Server entscheidet, nicht die App) |
| `supabase/tests/` | Simulation kompletter Runden mit mehreren Spielern |

Der Jäger bekommt nie die echten Standorte der Agenten. Der Server berechnet die Ping-Kreise und schickt nur diese. Das sichern die Zugriffsregeln (Row Level Security) in der Datenbank ab, und die Tests prüfen es.

## Einrichten

### 1. Supabase-Projekt (Server)

**Erledigt.** Der Server läuft im Supabase-Projekt **signal-hunt1** (Projekt-ID `gjzrruxhbqygxhfdlzxd`, Frankfurt):

- Beide Migrationen sind eingespielt, die anonyme Anmeldung ist an.
- Alle 9 Server-Simulationen laufen gegen den echten Server durch.
- Die App verbindet sich von selbst damit (Adresse und Publishable key stehen in `src/lib/supabase.ts`). Eine `.env` ist nicht nötig.

Neue Migrationen später so einspielen:

```bash
npx supabase login
npx supabase link --project-ref gjzrruxhbqygxhfdlzxd
npx supabase db push
```

### 2. App auf dem Handy testen

Am einfachsten mit **Expo Go** (kostenlos im App Store und bei Google Play):

```bash
npm install
npx expo start --tunnel
```

Den QR-Code im Terminal mit der Handy-Kamera (iPhone) oder mit Expo Go (Android) scannen.

In Expo Go funktioniert das Senden des Standorts nur, solange die App geöffnet ist. Die App lässt den Bildschirm dann automatisch an. Für den Hintergrund-Modus (Handy in der Tasche) braucht ihr einen eigenen Test-Build:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --profile development --platform android
```

### 3. Lokal entwickeln (optional)

Mit Docker läuft der komplette Server auch lokal:

```bash
npx supabase start
npm run test:backend   # spielt komplette Runden mit simulierten Spielern durch
npm test               # Unit-Tests für Geometrie, Zeit und Regeln
npm run typecheck
npm run lint
```

## Nächste Schritte

Siehe Fahrplan im Konzept: Nach Testrunden mit echten Handys folgt Schritt 3, die Veröffentlichung (Datenschutzerklärung, Impressum, Store-Einträge).

Die Sounds erzeugt `python3 scripts/make-sounds.py`, die Icons `python3 scripts/make-icons.py`.
