import type { Checkpoint, CheckpointClaim, Game, LocatedPing, Ping, PingKind, Player } from './types';

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

export function isLocated(ping: Ping): ping is LocatedPing {
  return ping.lat !== null && ping.lng !== null;
}

export type PingTrail = {
  /** Neuester Ping, auch wenn er gestört war. */
  latest: Ping;
  /** Neuester Ping mit Ort. */
  located: LocatedPing | null;
  /** Der Ping mit Ort davor (wird blass angezeigt). */
  previous: LocatedPing | null;
};

/** Pro Agent: neuester Ping, neuester mit Ort und der davor. */
export function pingTrails(pings: Ping[]): Map<string, PingTrail> {
  const byTarget = new Map<string, Ping[]>();
  for (const ping of pings) {
    const list = byTarget.get(ping.target_id) ?? [];
    list.push(ping);
    byTarget.set(ping.target_id, list);
  }
  const trails = new Map<string, PingTrail>();
  for (const [target, list] of byTarget) {
    const sorted = [...list].sort((a, b) => b.id - a.id);
    const located = sorted.filter(isLocated);
    trails.set(target, { latest: sorted[0], located: located[0] ?? null, previous: located[1] ?? null });
  }
  return trails;
}

export const pingKindLabel: Record<PingKind, string> = {
  regular: 'Ping',
  radar: 'Radar',
  idle: 'Stillstand',
  exposed: 'Außerhalb: genauer Standort',
  jammed: 'Signal gestört',
};

/** Tote Briefkästen, die gerade offen sind (Geleerte kennen nur Agenten). */
export function openCheckpoints(checkpoints: Checkpoint[], claims: CheckpointClaim[], now: number): Checkpoint[] {
  const claimed = new Set(claims.map((c) => c.checkpoint_id));
  return checkpoints.filter(
    (c) => !claimed.has(c.id) && Date.parse(c.appears_at) <= now && Date.parse(c.expires_at) > now,
  );
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

// Strafen und Briefkästen (Werte wie im Backend).
export const IDLE_WARNING_SEC = 120;
export const IDLE_PENALTY_SEC = 180;
export const BOUNDARY_GRACE_SEC = 30;
export const CHECKPOINT_REACH_M = 15;

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
