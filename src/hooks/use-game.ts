import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { onPositionSent } from '@/lib/location';
import { ensureSignedIn, supabase } from '@/lib/supabase';
import { clockOffset } from '@/lib/time';
import type { Checkpoint, CheckpointClaim, Game, GameEvent, Ping, Player, PlayerAbility, Position } from '@/lib/types';

/** Warnungen für den eigenen Agenten, wie der Server sie zuletzt gemeldet hat. */
export type Penalty = {
  /** Sekunden ohne echte Bewegung (nur während der Jagd). */
  idleSec: number | null;
  /** Sekunden außerhalb des Einsatzgebiets, sonst null. */
  outsideSec: number | null;
  /** Wann der Server das gemeldet hat (Handyzeit), zum Weiterzählen. */
  at: number;
};

export type GameData = {
  userId: string | null;
  game: Game | null;
  players: Player[];
  positions: Record<string, Position>;
  pings: Ping[];
  events: GameEvent[];
  /** Nur die eigenen Fähigkeiten (mehr erlaubt der Server nicht). */
  abilities: PlayerAbility[];
  checkpoints: Checkpoint[];
  /** Geleerte Briefkästen. Jäger bekommen diese Liste nie. */
  claims: CheckpointClaim[];
  penalty: Penalty | null;
  secret: string | null;
  me: Player | null;
  isHost: boolean;
  /** Serverzeit minus Handyzeit in ms. */
  offsetMs: number;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refresh: () => Promise<void>;
};

const TICK_MS_PLAYING = 5000;
const TICK_MS_IDLE = 15000;
/** Sicherheitsnetz, falls ein Echtzeit-Update verloren geht. */
const REFETCH_MS_PLAYING = 30000;

function upsertBy<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = { ...next[i], ...item };
  return next;
}

/**
 * Hält alle Daten eines Spiels aktuell: einmal laden, dann über Echtzeit-Updates
 * nachziehen. Zusätzlich ruft die App alle paar Sekunden tick() auf, damit der
 * Server Pings und Zeitablauf auslöst – und als Sicherheitsnetz, falls ein
 * Echtzeit-Update verloren geht.
 */
export function useGame(gameId: string | undefined): GameData {
  const [userId, setUserId] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [pings, setPings] = useState<Ping[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [abilities, setAbilities] = useState<PlayerAbility[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [claims, setClaims] = useState<CheckpointClaim[]>([]);
  const [penalty, setPenalty] = useState<Penalty | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatus = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!gameId) return;
    try {
      const [g, pl, pos, pi, ev, sec, ab, cp, cl] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).maybeSingle(),
        supabase.from('players').select('*').eq('game_id', gameId).order('joined_at'),
        supabase.from('positions').select('*').eq('game_id', gameId),
        supabase.from('pings').select('*').eq('game_id', gameId).order('id').limit(1000),
        supabase.from('events').select('*').eq('game_id', gameId).order('id', { ascending: false }).limit(50),
        supabase.from('player_secrets').select('catch_token').eq('game_id', gameId).maybeSingle(),
        supabase.from('player_abilities').select('*').eq('game_id', gameId),
        supabase.from('checkpoints').select('*').eq('game_id', gameId).order('id'),
        supabase.from('checkpoint_claims').select('*').eq('game_id', gameId),
      ]);
      const firstError =
        g.error ?? pl.error ?? pos.error ?? pi.error ?? ev.error ?? sec.error ?? ab.error ?? cp.error ?? cl.error;
      if (firstError) throw firstError;
      if (!g.data) {
        setNotFound(true);
        setGame(null);
        return;
      }
      setNotFound(false);
      setGame(g.data as Game);
      lastStatus.current = (g.data as Game).status;
      setPlayers((pl.data ?? []) as Player[]);
      setPositions(Object.fromEntries(((pos.data ?? []) as Position[]).map((p) => [p.user_id, p])));
      setPings((pi.data ?? []) as Ping[]);
      setEvents(((ev.data ?? []) as GameEvent[]).reverse());
      setSecret((sec.data as { catch_token: string } | null)?.catch_token ?? null);
      setAbilities((ab.data ?? []) as PlayerAbility[]);
      setCheckpoints((cp.data ?? []) as Checkpoint[]);
      setClaims((cl.data ?? []) as CheckpointClaim[]);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void fetchAll(), 250);
  }, [fetchAll]);

  // Anmelden und erstes Laden.
  useEffect(() => {
    let cancelled = false;
    ensureSignedIn()
      .then((id) => {
        if (!cancelled) setUserId(id);
      })
      .then(fetchAll)
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  // Echtzeit-Updates.
  useEffect(() => {
    if (!gameId || !userId) return;
    const filter = `game_id=eq.${gameId}`;
    const channel = supabase
      .channel(`game:${gameId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, (msg) => {
        if (msg.eventType === 'DELETE') {
          setNotFound(true);
          return;
        }
        const next = msg.new as Game;
        const statusChanged = next.status !== lastStatus.current;
        setGame((prev) => ({ ...(prev ?? next), ...next }));
        lastStatus.current = next.status;
        // Bei Statuswechsel ändern sich Zugriffsrechte (z. B. nach dem Spiel alles sichtbar).
        if (statusChanged) scheduleRefetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter }, () => scheduleRefetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter }, (msg) => {
        if (msg.eventType === 'DELETE') return;
        const p = msg.new as Position;
        setPositions((prev) => ({ ...prev, [p.user_id]: p }));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings', filter }, (msg) => {
        const p = msg.new as Ping;
        setPings((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter }, (msg) => {
        const e = msg.new as GameEvent;
        setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev.slice(-49), e]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_abilities', filter }, (msg) => {
        if (msg.eventType === 'DELETE') {
          scheduleRefetch();
          return;
        }
        const a = msg.new as PlayerAbility;
        setAbilities((prev) => upsertBy(prev, a, (x) => x.ability === a.ability && x.user_id === a.user_id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkpoints', filter }, (msg) => {
        if (msg.eventType === 'DELETE') {
          scheduleRefetch();
          return;
        }
        const c = msg.new as Checkpoint;
        setCheckpoints((prev) => upsertBy(prev, c, (x) => x.id === c.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkpoint_claims', filter }, (msg) => {
        const c = msg.new as CheckpointClaim;
        setClaims((prev) => (prev.some((x) => x.checkpoint_id === c.checkpoint_id) ? prev : [...prev, c]));
      })
      .subscribe((status) => {
        // Nach dem (Wieder-)Verbinden alles neu laden, damit nichts verpasst wird.
        if (status === 'SUBSCRIBED') scheduleRefetch();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [gameId, userId, scheduleRefetch]);

  // Warnungen aus den Standort-Antworten übernehmen (kommen öfter als der Takt).
  useEffect(
    () =>
      onPositionSent((_p, result) => {
        if (result.status === 'hunt' || result.status === 'headstart') {
          setPenalty({ idleSec: result.idle_sec ?? null, outsideSec: result.outside_sec ?? null, at: Date.now() });
        }
      }),
    [],
  );

  // Zurück in die App: neu laden.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') scheduleRefetch();
    });
    return () => sub.remove();
  }, [scheduleRefetch]);

  // Takt: Server weiterzählen lassen und Uhrzeit abgleichen.
  const status = game?.status;
  useEffect(() => {
    if (!gameId || !userId || !status || status === 'ended') return;
    const playing = status === 'headstart' || status === 'hunt';
    let stopped = false;
    const tick = async () => {
      const started = Date.now();
      try {
        const result = await api.tick(gameId);
        if (stopped) return;
        setOffsetMs(clockOffset(result.server_now, started, Date.now()));
        setPenalty({ idleSec: result.idle_sec ?? null, outsideSec: result.outside_sec ?? null, at: Date.now() });
        if (result.status !== lastStatus.current || (playing && result.ping_seq !== game?.ping_seq)) {
          scheduleRefetch();
        }
      } catch {
        // Kein Netz: nächster Versuch beim nächsten Takt.
      }
    };
    void tick();
    const id = setInterval(tick, playing ? TICK_MS_PLAYING : TICK_MS_IDLE);
    const safety = playing ? setInterval(scheduleRefetch, REFETCH_MS_PLAYING) : null;
    return () => {
      stopped = true;
      clearInterval(id);
      if (safety) clearInterval(safety);
    };
  }, [gameId, userId, status, game?.ping_seq, scheduleRefetch]);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  const me = useMemo(() => players.find((p) => p.user_id === userId) ?? null, [players, userId]);

  return {
    userId,
    game,
    players,
    positions,
    pings,
    events,
    abilities,
    checkpoints,
    claims,
    penalty,
    secret,
    me,
    isHost: !!game && game.host_id === userId,
    offsetMs,
    loading,
    error,
    notFound,
    refresh: fetchAll,
  };
}

/** Aktuelle Serverzeit, aktualisiert im angegebenen Takt. */
export function useServerNow(offsetMs: number, everyMs = 500): number {
  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setDeviceNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return deviceNow + offsetMs;
}
