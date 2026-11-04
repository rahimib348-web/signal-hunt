import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Polyline } from 'react-native-maps';

import { GameMap, toCoord } from '@/components/game-map';
import { Button, Card, Row, Screen, T } from '@/components/ui';
import type { GameData } from '@/hooks/use-game';
import { ABILITIES } from '@/lib/abilities';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { regionFor } from '@/lib/geo';
import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { formatCountdown } from '@/lib/time';
import type { AbilityId, GameEvent, HistoryPoint, Player } from '@/lib/types';

type Stats = { used: Partial<Record<AbilityId, number>>; fakes: number; drops: number };

/** Wer hat was eingesetzt? Nach dem Spiel sieht jeder alle Ereignisse. */
function statsByPlayer(events: Pick<GameEvent, 'type' | 'actor_id' | 'payload'>[]): Map<string, Stats> {
  const map = new Map<string, Stats>();
  const get = (id: string) => {
    const s = map.get(id) ?? { used: {}, fakes: 0, drops: 0 };
    map.set(id, s);
    return s;
  };
  for (const e of events) {
    if (!e.actor_id) continue;
    if (e.type === 'ability_used') {
      const a = e.payload?.ability as AbilityId;
      const s = get(e.actor_id);
      s.used[a] = (s.used[a] ?? 0) + 1;
    } else if (e.type === 'fake_ping_sent') get(e.actor_id).fakes += 1;
    else if (e.type === 'checkpoint_claimed') get(e.actor_id).drops += 1;
  }
  return map;
}

function statsLine(s: Stats | undefined): string | null {
  if (!s) return null;
  const parts = (Object.entries(s.used) as [AbilityId, number][]).map(([a, n]) => `${ABILITIES[a]?.label ?? a} ${n}×`);
  if (s.fakes > 0) parts.push(s.fakes === 1 ? '1 Fake-Ping hat getäuscht' : `${s.fakes} Fake-Pings haben getäuscht`);
  if (s.drops > 0) parts.push(s.drops === 1 ? '1 Briefkasten geleert' : `${s.drops} Briefkästen geleert`);
  return parts.length ? parts.join(' · ') : null;
}

const PATH_COLORS = ['#2CFF9A', '#3FD5FF', '#B78CFF', '#FFD23F', '#FF8F3F', '#7CFF4F', '#FF6FD8', '#5F8BFF'];

export function Results({ data }: { data: GameData }) {
  const { game, players, pings, isHost } = data;
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [extras, setExtras] = useState<Pick<GameEvent, 'type' | 'actor_id' | 'payload'>[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!game) return;
    void supabase
      .from('position_history')
      .select('user_id, lat, lng, recorded_at')
      .eq('game_id', game.id)
      .order('recorded_at')
      .limit(10000)
      .then(({ data: rows }) => setHistory((rows ?? []) as HistoryPoint[]));
    void supabase
      .from('events')
      .select('type, actor_id, payload')
      .eq('game_id', game.id)
      .in('type', ['ability_used', 'fake_ping_sent', 'checkpoint_claimed'])
      .limit(2000)
      .then(({ data: rows }) => setExtras((rows ?? []) as Pick<GameEvent, 'type' | 'actor_id' | 'payload'>[]));
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const paths = useMemo(() => {
    const byUser = new Map<string, HistoryPoint[]>();
    for (const h of history) {
      const list = byUser.get(h.user_id) ?? [];
      list.push(h);
      byUser.set(h.user_id, list);
    }
    return byUser;
  }, [history]);

  const stats = useMemo(() => statsByPlayer(extras), [extras]);

  if (!game) return null;

  const colorFor = (p: Player, i: number) =>
    p.role === 'hunter' && !p.caught_at ? colors.hunter : PATH_COLORS[i % PATH_COLORS.length];

  const title =
    game.end_reason === 'aborted'
      ? 'Einsatz abgebrochen'
      : game.winner === 'runners'
        ? 'Die Agenten haben gewonnen'
        : 'Die Jäger haben gewonnen';
  const reason =
    {
      all_caught: 'Alle Agenten wurden gefangen.',
      time_up: 'Die Zeit ist abgelaufen, bevor alle Agenten gefangen wurden.',
      aborted: 'Jemand hat den SOS-Knopf gedrückt.',
      no_hunters: 'Alle Jäger haben den Einsatz verlassen.',
    }[game.end_reason ?? 'aborted'] ?? '';

  const huntStart = game.hunt_starts_at ? Date.parse(game.hunt_starts_at) : null;
  const region = game.area ? regionFor(game.area, 1.15) : null;
  const ranked = [...players].sort((a, b) => survival(b) - survival(a));
  function survival(p: Player) {
    if (!huntStart) return 0;
    if (!p.caught_at) return Number.MAX_SAFE_INTEGER;
    return Date.parse(p.caught_at) - huntStart;
  }

  const newRound = async () => {
    setBusy(true);
    try {
      await api.resetGame(game.id);
      await data.refresh();
    } catch (e) {
      Alert.alert('Neue Runde nicht möglich', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const home = async () => {
    await storage.setLastGame(null);
    router.replace('/');
  };

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <T variant="label" color={game.winner === 'hunters' ? colors.hunter : colors.signal}>
          Einsatz beendet
        </T>
        <T variant="title">{title}</T>
        <T variant="muted">{reason}</T>
      </View>

      {region ? (
        <View style={styles.map}>
          <GameMap initialRegion={region} area={game.area} showsUserLocation={false}>
            {players.map((p, i) => {
              const points = paths.get(p.user_id);
              if (!points || points.length < 2) return null;
              return (
                <Polyline key={p.user_id} coordinates={points.map(toCoord)} strokeColor={colorFor(p, i)} strokeWidth={3} />
              );
            })}
          </GameMap>
        </View>
      ) : null}

      <Card>
        <T variant="heading">Auswertung</T>
        {ranked.map((p) => {
          const i = players.indexOf(p);
          const caughtBy = p.caught_by ? players.find((x) => x.user_id === p.caught_by)?.name : null;
          const startedAsRunner = p.role === 'runner' || p.caught_at !== null;
          let line: string;
          if (!startedAsRunner) line = 'Jäger';
          else if (p.caught_at && huntStart)
            line = `gefangen nach ${formatCountdown(Date.parse(p.caught_at) - huntStart)}${caughtBy ? ` von ${caughtBy}` : ''}`;
          else line = 'nicht erwischt';
          const extra = statsLine(stats.get(p.user_id));
          return (
            <View key={p.user_id} style={styles.entry}>
              <Row style={styles.row}>
                <View style={[styles.swatch, { backgroundColor: colorFor(p, i) }]} />
                <T style={{ flex: 1 }} numberOfLines={1}>
                  {p.name}
                </T>
                <T variant="muted">{line}</T>
              </Row>
              {extra ? (
                <T variant="muted" style={styles.extra}>
                  {extra}
                </T>
              ) : null}
            </View>
          );
        })}
        <T variant="muted">
          {pings.length} Pings während der Jagd
          {pings.some((x) => x.kind === 'jammed') ? `, ${pings.filter((x) => x.kind === 'jammed').length} davon gestört` : ''}.
        </T>
      </Card>

      {isHost ? <Button title="Neue Runde mit dieser Gruppe" onPress={newRound} loading={busy} /> : <T variant="muted" center>Der Host kann eine neue Runde starten.</T>}
      <Button title="Zum Start" kind="secondary" onPress={home} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { height: 280, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  entry: { gap: 2 },
  row: { paddingVertical: space.xs, flexWrap: 'nowrap' },
  extra: { paddingLeft: 20, fontSize: 12 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
});
