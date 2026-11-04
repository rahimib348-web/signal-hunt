import type { Game, Ping, Player } from './types';

/** Phase der Jagd (1 bis 3). Jede Phase ist ein Drittel der Spieldauer. */
export function huntPhase(game: Pick<Game, 'hunt_starts_at' | 'duration_sec'>, now: number): 1 | 2 | 3 {
  if (!game.hunt_starts_at) return 1;
  const elapsed = (now - Date.parse(game.hunt_starts_at)) / 1000;
  const phase = Math.floor(elapsed / (game.duration_sec / 3));
  return (Math.min(2, Math.max(0, phase)) + 1) as 1 | 2 | 3;
}

/** Neuester Ping pro Agent. */
export function latestPingPerTarget(pings: Ping[]): Map<string, Ping> {
  const latest = new Map<string, Ping>();
  for (const ping of pings) {
    const current = latest.get(ping.target_id);
    if (!current || ping.id > current.id) latest.set(ping.target_id, ping);
  }
  return latest;
}

export function countActiveRunners(players: Player[]): number {
  return players.filter((p) => p.role === 'runner' && p.status === 'active').length;
}

export function countRunnersAtStart(players: Player[]): number {
  return players.filter((p) => p.role === 'runner' || p.caught_at !== null).length;
}

export const HEADSTART_OPTIONS_SEC = [60, 180, 300, 600];
export const DURATION_OPTIONS_SEC = [1200, 1800, 2700, 3600, 5400];

/** Wann soll das Handy vor dem nächsten Ping warnen? */
export const PING_WARNING_MS = 30_000;

export const modeLabel = {
  infection: 'Doppelagent',
  elimination: 'Festnahme',
} as const;

export const modeDescription = {
  infection: 'Gefangene Agenten wechseln die Seite und jagen ab sofort mit.',
  elimination: 'Gefangene Agenten scheiden aus und schauen nur noch zu.',
} as const;

export const roleLabel = {
  runner: 'Agent',
  hunter: 'Jäger',
} as const;
