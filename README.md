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
- Warnung beim Verlassen des Einsatzgebiets (die Strafe dafür kommt in Schritt 2)
- Fangen per QR-Scan mit Entfernungsprüfung (höchstens 100 m)
- SOS-Knopf beendet die Runde sofort für alle
- Auswertung mit den Wegen aller Spieler auf der Karte, danach eine neue Runde mit derselben Gruppe
- Datenschutz: Spiele samt Standorten werden spätestens nach 24 Stunden gelöscht

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

1. Konto auf [supabase.com](https://supabase.com) anlegen und ein neues Projekt erstellen. Region: **Frankfurt (eu-central-1)**.
2. Im Dashboard unter **Authentication → Sign In / Providers** die Option **Allow anonymous sign-ins** einschalten. Spieler brauchen dann kein Konto.
3. Datenbank einrichten:
   ```bash
   npx supabase login
   npx supabase link --project-ref DEINE-PROJEKT-ID
   npx supabase db push
   ```
4. `.env.example` nach `.env` kopieren und **Project URL** und **Publishable key** eintragen (Project Settings → API).

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

Siehe Fahrplan im Konzept: Schritt 2 bringt Fähigkeiten (Störsender, Fake-Ping, Radar, Kompass), Checkpoints, die Strafe fürs Stillstehen und an der Grenze, Sounds und mehr Agenten-Design.
