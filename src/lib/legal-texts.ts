// Impressum und Datenschutzerklärung für den Bildschirm "Datenschutz und Impressum".
// Entwurf, abgestimmt mit dem Dokument "Signal Hunt – Datenschutz und Impressum".
// Vor der Veröffentlichung die Platzhalter in LEGAL_CONTACT ausfüllen.

export const LEGAL_CONTACT = {
  name: '[Vor- und Nachname]',
  street: '[Straße und Hausnummer]',
  city: '[Postleitzahl und Ort]',
  email: '[E-Mail-Adresse]',
  phone: '[Telefonnummer]',
  authority: '[Name und Anschrift der Datenschutzbehörde des Bundeslandes]',
  logRetention: '[Anzahl]',
  updated: '[Datum der Veröffentlichung]',
} as const;

const c = LEGAL_CONTACT;

export type LegalBlock =
  | { kind: 'text'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'data'; rows: { what: string; why: string; who: string; until: string }[] };

export type LegalSection = { title: string; blocks: LegalBlock[] };

export const IMPRESSUM: LegalSection = {
  title: 'Impressum',
  blocks: [
    { kind: 'text', text: 'Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)' },
    { kind: 'text', text: `${c.name}\n${c.street}\n${c.city}\nDeutschland` },
    { kind: 'text', text: `E-Mail: ${c.email}\nTelefon: ${c.phone}` },
    {
      kind: 'text',
      text: 'Signal Hunt ist ein privates, kostenloses Projekt ohne Werbung und ohne In-App-Käufe.',
    },
  ],
};

export const PRIVACY: LegalSection[] = [
  {
    title: '1. Auf einen Blick',
    blocks: [
      {
        kind: 'text',
        text: 'Signal Hunt braucht während einer Runde deinen Standort, sonst funktioniert das Spiel nicht. Alles andere ist auf das Nötigste beschränkt.',
      },
      { kind: 'text', text: `Verantwortlich ist ${c.name}, ${c.street}, ${c.city}, E-Mail: ${c.email}.` },
      {
        kind: 'bullets',
        items: [
          'Kein Konto: Du meldest dich nicht mit E-Mail, Telefonnummer oder Passwort an. Die App bekommt eine zufällige, anonyme Nutzer-ID.',
          'Kein echter Name nötig: Du wählst einen Agentennamen, zum Beispiel „Falke-07“.',
          'Keine Werbung und kein Tracking: keine Analyse- oder Tracking-Werkzeuge. Daten werden weder verkauft noch für Werbung genutzt.',
          'Automatisch gelöscht: Ein Spiel wird samt aller Standorte 24 Stunden nach dem Erstellen gelöscht, eine beendete Runde schon 6 Stunden nach dem Ende.',
        ],
      },
    ],
  },
  {
    title: '2. Welche Daten im Spiel anfallen',
    blocks: [
      {
        kind: 'text',
        text: 'Alle Daten liegen auf unserem Server bei Supabase in Frankfurt. Die Spielregeln laufen auf dem Server: Er entscheidet, wer was sehen darf.',
      },
      {
        kind: 'data',
        rows: [
          {
            what: 'Anonyme Nutzer-ID und Anmeldesitzung (mit IP-Adresse und Gerätetyp)',
            why: 'Damit der Server dich ohne Konto wiedererkennt',
            who: 'Der Server; Mitspieler nur die ID als technische Kennung',
            until: 'Nach 30 Tagen ohne Nutzung oder sofort mit „Meine Daten löschen“',
          },
          { what: 'Agentenname', why: 'Anzeige im Spiel', who: 'Mitspieler im selben Einsatz', until: 'Mit dem Spiel' },
          {
            what: 'Einsatz: Code, Einstellungen, Einsatzgebiet, Rollen, Ergebnis',
            why: 'Ablauf der Runde',
            who: 'Mitspieler im selben Einsatz',
            until: 'Mit dem Spiel',
          },
          {
            what: 'Aktueller Standort (Koordinaten, Genauigkeit, Uhrzeit), während der Runde etwa alle 4 bis 5 Sekunden, nach der Freigabe auch schon in der Lobby',
            why: 'Pings, Spielfeldgrenze, Entfernungsprüfung beim Fangen, tote Briefkästen',
            who: 'Du selbst. In der Lobby und nach der Runde alle Mitspieler. Während der Runde sehen Jäger nur andere Jäger und ausgeschiedene Spieler alle. Den Standort eines Agenten sieht der Jäger nie direkt.',
            until: 'Mit dem Spiel, bei „Neue Runde“ sofort',
          },
          {
            what: 'Wegeverlauf (höchstens alle 10 Sekunden ein Punkt)',
            why: 'Auswertung auf der Karte nach der Runde',
            who: 'Du selbst, nach der Runde alle Mitspieler',
            until: 'Mit dem Spiel, bei „Neue Runde“ sofort',
          },
          {
            what: 'Pings: ein Kreis um deinen ungefähren Standort; wer das Einsatzgebiet länger als 30 Sekunden verlässt, auch der genaue Standort',
            why: 'Kern des Spiels',
            who: 'Jäger, Zuschauer und du selbst, nach der Runde alle',
            until: 'Mit dem Spiel, bei „Neue Runde“ sofort',
          },
          {
            what: 'Spielereignisse und Fähigkeiten (z. B. gefangen, Radar eingesetzt, Briefkasten geleert)',
            why: 'Meldungen im Spiel und Auswertung',
            who: 'Je nach Ereignis alle, nur Agenten oder nur du; nach der Runde alle',
            until: 'Mit dem Spiel',
          },
          {
            what: 'Agenten-ID (zufälliger QR-Code, nur für eine Runde)',
            why: 'Fang bestätigen',
            who: 'Nur du, bis ein Jäger sie scannt',
            until: 'Am Ende der Runde',
          },
          {
            what: 'Auf deinem Handy: Agentenname, zuletzt gespielter Einsatz, Ton-Einstellung, Anmelde-Schlüssel',
            why: 'Komfort und Anmeldung',
            who: 'Nur auf deinem Gerät',
            until: 'Wenn du die App löschst',
          },
        ],
      },
      {
        kind: 'text',
        text: '„Mit dem Spiel“ heißt: 24 Stunden nach dem Erstellen des Einsatzes, eine beendete Runde nach 6 Stunden. Die Kamera nutzt die App nur zum Scannen von QR-Codes. Bilder werden weder gespeichert noch gesendet.',
      },
    ],
  },
  {
    title: '3. Dienste anderer Anbieter',
    blocks: [
      {
        kind: 'text',
        text: `Server: Datenbank, Anmeldung und Echtzeit-Übertragung laufen bei Supabase in einem Rechenzentrum in Frankfurt am Main (AWS-Region eu-central-1). Supabase verarbeitet die Daten in unserem Auftrag (Art. 28 DSGVO). Für Zugriffe aus Ländern außerhalb der EU, etwa den USA oder Singapur für Support und Betrieb, nennt Supabase die EU-Standardvertragsklauseln als Grundlage. Technische Protokolle wie IP-Adresse und Zeitpunkt einer Anfrage speichert Supabase für ${c.logRetention} Tage.`,
      },
      {
        kind: 'text',
        text: 'Karten: Auf dem iPhone zeigt die App Karten von Apple, auf Android von Google. Beim Laden der Karte erfahren Apple bzw. Google deine IP-Adresse und den gezeigten Kartenausschnitt, also ungefähr, wo du bist. Es gelten die Datenschutzrichtlinie von Apple (apple.com/legal/privacy) und die Datenschutzerklärung von Google (policies.google.com/privacy) mit den Zusätzlichen Nutzungsbedingungen für Google Maps.',
      },
      {
        kind: 'text',
        text: 'Wege für tote Briefkästen: Wenn der Host das Einsatzgebiet speichert, fragt die App beim Server overpass-api.de nach Fußwegen im Gebiet. Dabei gehen die Eckpunkte des Gebiets und die IP-Adresse des Host-Handys an den Betreiber, den FOSSGIS e.V. in Deutschland. Die Wegdaten stammen von den OpenStreetMap-Mitwirkenden (Lizenz ODbL).',
      },
      {
        kind: 'text',
        text: 'App-Stores: Für das Herunterladen gelten die Datenschutzregeln von Google bzw. Apple. Wir bekommen von den Stores nur zusammengefasste Statistiken und Absturzberichte, wenn du das auf deinem Handy erlaubt hast. Weitere Dienste nutzt die App nicht: keine Werbenetzwerke, keine Analyse-Dienste, keine Push-Nachrichten.',
      },
    ],
  },
  {
    title: '4. Berechtigungen auf deinem Handy',
    blocks: [
      {
        kind: 'bullets',
        items: [
          'Standort (genau): nötig, um mitzuspielen. Vor der Abfrage erklärt die App, wofür sie den Standort nutzt.',
          'Standort im Hintergrund („immer“): freiwillig. Dann sammelt Signal Hunt während einer laufenden Runde deinen Standort auch, wenn die App geschlossen ist oder du sie nicht nutzt. Auf Android zeigt eine Benachrichtigung „Signal Hunt läuft“, solange das passiert. Mit dem Ende der Runde hört das Senden automatisch auf.',
          'Kamera: nur zum Scannen von QR-Codes. Das Bild wird auf dem Handy ausgewertet und weder gespeichert noch gesendet.',
          'Keinen Zugriff braucht die App auf Mikrofon, Kontakte, Fotos, Dateien oder Bluetooth.',
        ],
      },
      { kind: 'text', text: 'Du kannst jede Berechtigung jederzeit in den Einstellungen deines Handys entziehen.' },
    ],
  },
  {
    title: '5. Rechtsgrundlagen, Speicherdauer und deine Rechte',
    blocks: [
      {
        kind: 'bullets',
        items: [
          'Art. 6 Abs. 1 lit. b DSGVO: alles, was nötig ist, damit du das Spiel nutzen kannst, das du startest.',
          'Art. 6 Abs. 1 lit. f DSGVO: technische Protokolle für einen sicheren Betrieb und die Suche nach Fußwegen bei OpenStreetMap, damit tote Briefkästen nur an sicheren Orten liegen.',
          '§ 25 Abs. 2 Nr. 2 TDDDG: Die App speichert den Anmelde-Schlüssel und deine Einstellungen auf deinem Handy, weil sie sonst nicht funktioniert.',
        ],
      },
      {
        kind: 'text',
        text: 'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15 bis 21 DSGVO). Weil es kein Konto gibt, finden wir deine Daten nur über deine anonyme Nutzer-ID oben auf dieser Seite. Mit „Meine Daten löschen“ löschst du alles sofort selbst.',
      },
      {
        kind: 'text',
        text: `Du kannst dich bei jeder Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel bei der für uns zuständigen: ${c.authority}.`,
      },
      {
        kind: 'text',
        text: 'Ohne Standort kannst du nicht mitspielen, ohne Agentennamen keinem Einsatz beitreten. Automatisierte Entscheidungen mit rechtlicher Wirkung (Art. 22 DSGVO) gibt es nicht.',
      },
      { kind: 'text', text: `Stand: ${c.updated}` },
    ],
  },
];

/** Noch nicht ausgefüllte Platzhalter (für einen Hinweis in Testversionen). */
export function hasPlaceholders(): boolean {
  return Object.values(LEGAL_CONTACT).some((v) => v.startsWith('['));
}
