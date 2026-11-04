import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ensureSignedIn, supabase } from '@/lib/supabase';
import { clockOffset } from '@/lib/time';
import type { Game, GameEvent, Ping, Player, Position } from '@/lib/types';

export type GameData = {
  userId: string | null;
  game: Game | null;
  players: Player[];
  positions: Record<string, Position>;
  pings: Ping[];
  events: GameEvent[];
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
      const [g, pl, pos, pi, ev, sec] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).maybeSingle(),
        supabase.from('players').select('*').eq('game_id', gameId).order('joined_at'),
        supabase.from('positions').select('*').eq('game_id', gameId),
        supabase.from('pings').select('*').eq('game_id', gameId).order('id').limit(1000),
        supabase.from('events').select('*').eq('game_id', gameId).order('id', { ascending: false }).limit(50),
        supabase.from('player_secrets').select('catch_token').eq('game_id', gameId).maybeSingle(),
      ]);
      const firstError = g.error ?? pl.error ?? pos.error ?? pi.error ?? ev.error ?? sec.error;
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
      .subscribe((status) => {
        // Nach dem (Wieder-)Verbinden alles neu laden, damit nichts verpasst wird.
        if (status === 'SUBSCRIBED') scheduleRefetch();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [gameId, userId, scheduleRefetch]);

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
        if (result.status !== lastStatus.current || (playing && result.ping_seq !== game?.ping_seq)) {
          scheduleRefetch();
        }
      } catch {
        // Kein Netz: nächster Versuch beim nächsten Takt.
      }
    };
    void tick();
    const id = setInterval(tick, playing ? TICK_MS_PLAYING : TICK_MS_IDLE);
    return () => {
      stopped = true;
      clearInterval(id);
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
