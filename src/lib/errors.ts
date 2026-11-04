// Fehlercodes vom Server (siehe supabase/migrations) → verständliche Meldungen.
const messages: Record<string, string> = {
  not_signed_in: 'Anmeldung fehlgeschlagen. Prüfe deine Internetverbindung.',
  game_not_found: 'Kein Einsatz mit diesem Code gefunden.',
  game_already_started: 'Dieser Einsatz läuft schon. Warte auf die nächste Runde.',
  game_full: 'Der Einsatz ist voll (höchstens 20 Spieler).',
  invalid_name: 'Bitte gib einen Namen mit 1 bis 24 Zeichen ein.',
  not_host: 'Das darf nur der Host.',
  wrong_status: 'Das geht im aktuellen Spielabschnitt nicht.',
  invalid_mode: 'Unbekannter Spielmodus.',
  invalid_role: 'Unbekannte Rolle.',
  player_not_found: 'Spieler nicht gefunden.',
  invalid_area: 'Das Einsatzgebiet braucht 3 bis 30 Punkte.',
  area_self_intersects: 'Die Linien des Einsatzgebiets kreuzen sich. Setze die Punkte der Reihe nach rundherum.',
  area_too_small: 'Das Einsatzgebiet ist zu klein (mindestens 0,01 km²).',
  area_too_large: 'Das Einsatzgebiet ist zu groß (höchstens 25 km²).',
  no_area: 'Zeichne zuerst das Einsatzgebiet.',
  not_enough_players: 'Ihr braucht mindestens 2 Spieler.',
  no_runners: 'Es muss mindestens einen Agenten geben.',
  not_member: 'Du bist nicht in diesem Einsatz.',
  invalid_position: 'Ungültiger Standort.',
  not_hunting: 'Fangen geht erst, wenn die Jagd begonnen hat.',
  not_a_hunter: 'Nur Jäger können Agenten fangen.',
  invalid_code: 'Diese Agenten-ID ist ungültig oder wurde schon gefangen.',
  too_far: 'Zu weit weg. Du musst direkt beim Agenten sein.',
  invalid_ability: 'Unbekannte Fähigkeit.',
  wrong_role: 'Diese Fähigkeit gehört zur anderen Rolle.',
  ability_disabled: 'Diese Fähigkeit ist in dieser Runde ausgeschaltet.',
  no_charges: 'Du hast diese Fähigkeit gerade nicht.',
  cooldown: 'Die Fähigkeit lädt noch nach.',
  already_armed: 'Die Fähigkeit ist schon scharf geschaltet.',
  no_position: 'Dein Standort ist unbekannt. Warte kurz, bis das GPS dich findet.',
  no_target: 'Gerade ist kein Agent zu orten.',
  invalid_spots: 'Die Orte für tote Briefkästen sind ungültig.',
};

export function errorMessage(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  if (messages[raw]) return messages[raw];
  if (/^overpass_|abort/i.test(raw)) return 'Die Kartendaten (OpenStreetMap) sind gerade nicht erreichbar. Versuch es gleich noch einmal.';
  if (/network|fetch|failed to fetch/i.test(raw)) return 'Keine Verbindung zum Server. Prüfe dein Internet.';
  return `Etwas ist schiefgelaufen (${raw}).`;
}

export function errorCode(error: unknown): string | null {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : null;
  return raw && messages[raw] ? raw : null;
}
