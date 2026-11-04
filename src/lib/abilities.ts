import type { AbilityId, PlayerAbility, Role } from './types';

type AbilityInfo = {
  label: string;
  role: Role;
  /** Kurz für Knöpfe und Meldungen. */
  short: string;
  /** Für die Lobby und die Erklärung im Spiel. */
  description: string;
  icon: string;
  cooldownSec: number;
};

// Werte wie im Backend (supabase/migrations/20261104020000_abilities_checkpoints.sql).
export const ABILITIES: Record<AbilityId, AbilityInfo> = {
  jammer: {
    label: 'Störsender',
    role: 'runner',
    short: 'Nächster Ping fällt aus',
    description: 'Dein nächster Ping fällt aus. Der Jäger sieht nur „Signal gestört“.',
    icon: '≋',
    cooldownSec: 600,
  },
  fake_ping: {
    label: 'Fake-Ping',
    role: 'runner',
    short: 'Nächster Ping zeigt einen falschen Ort',
    description: 'Dein nächster Ping zeigt einen falschen Kreis, mindestens 300 m von dir entfernt. Der Jäger merkt es nicht.',
    icon: '◎',
    cooldownSec: 600,
  },
  radar: {
    label: 'Radar',
    role: 'hunter',
    short: 'Sofort ein Ping von allen Agenten',
    description: 'Löst sofort einen Ping von allen Agenten aus. Die Agenten bekommen eine Warnung.',
    icon: '◉',
    cooldownSec: 480,
  },
  compass: {
    label: 'Kompass',
    role: 'hunter',
    short: '10 s Richtung zum nächsten Agenten',
    description: 'Zeigt 10 Sekunden lang die Richtung zum nächsten Agenten, aber nicht die Entfernung.',
    icon: '➤',
    cooldownSec: 480,
  },
};

export const ALL_ABILITIES: AbilityId[] = ['jammer', 'fake_ping', 'radar', 'compass'];

export function abilitiesForRole(role: Role): AbilityId[] {
  return ALL_ABILITIES.filter((a) => ABILITIES[a].role === role);
}

export type AbilitySlot = {
  ability: AbilityId;
  charges: number;
  armed: boolean;
  /** Restliche Abklingzeit in ms (0 = bereit). */
  cooldownMs: number;
  usable: boolean;
};

/**
 * Was der Spieler gerade einsetzen kann: alle erlaubten Fähigkeiten seiner Rolle,
 * auch die ohne Ladung (damit man sieht, was es an toten Briefkästen zu holen gibt).
 */
export function abilitySlots(
  role: Role,
  allowed: AbilityId[],
  owned: PlayerAbility[],
  now: number,
): AbilitySlot[] {
  return abilitiesForRole(role)
    .filter((a) => allowed.includes(a))
    .map((ability) => {
      const row = owned.find((o) => o.ability === ability);
      const charges = row?.charges ?? 0;
      const armed = row?.armed ?? false;
      const cooldownMs = row?.cooldown_until ? Math.max(0, Date.parse(row.cooldown_until) - now) : 0;
      return { ability, charges, armed, cooldownMs, usable: charges > 0 && cooldownMs === 0 && !armed };
    });
}

const DIRECTIONS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];

/** 0° → "Norden", 100° → "Osten" */
export function directionName(bearingDeg: number): string {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return DIRECTIONS[i];
}

/** Woher kam eine neue Fähigkeit? Für Meldungen. */
export function gainedText(ability: AbilityId, source: string | undefined): string {
  const name = ABILITIES[ability]?.label ?? ability;
  switch (source) {
    case 'checkpoint':
      return `Toter Briefkasten geleert: ${name} erhalten!`;
    case 'catch':
      return `Belohnung für den Fang: ${name}`;
    case 'converted':
      return `Neue Ausrüstung als Jäger: ${name}`;
    default:
      return `Deine Fähigkeit für diese Runde: ${name}`;
  }
}
