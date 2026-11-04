import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameMap, toCoord } from '@/components/game-map';
import { Badge, Banner, Button, Row, T } from '@/components/ui';
import { useServerNow, type GameData } from '@/hooks/use-game';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { regionFor } from '@/lib/geo';
import { onPositionSent, startTracking, type TrackingMode } from '@/lib/location';
import { countActiveRunners, countRunnersAtStart, huntPhase, latestPingPerTarget, modeLabel, PING_WARNING_MS } from '@/lib/rules';
import { colors, mono, radius, space } from '@/lib/theme';
import { formatAgo, formatCountdown } from '@/lib/time';
import type { GameEvent, Ping, Player } from '@/lib/types';

type Viewer = 'runner' | 'hunter' | 'spectator';

function KeepAwake() {
  useKeepAwake('signal-hunt-game');
  return null;
}

export function Play({ data }: { data: GameData }) {
  const { game, players, positions, pings, events, me, userId, secret } = data;
  const now = useServerNow(data.offsetMs, 500);
  const [tracking, setTracking] = useState<TrackingMode | null>(null);
  const [inside, setInside] = useState<boolean | null>(null);
  const [showId, setShowId] = useState(false);
  const [toast, setToast] = useState<{ text: string; color: string } | null>(null);
  const lastEventId = useRef<number | null>(null);
  const warnedSeq = useRef<number | null>(null);

  const viewer: Viewer = me?.status === 'out' ? 'spectator' : me?.role === 'hunter' ? 'hunter' : 'runner';
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.user_id, p.name])), [players]);

  // Standort senden, solange die Runde läuft.
  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    void startTracking(game.id, true).then((mode) => {
      if (!cancelled) setTracking(mode);
    });
    const off = onPositionSent((_p, isInside) => setInside(isInside));
    return () => {
      cancelled = true;
      off();
    };
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meldungen zu neuen Ereignissen (nur Ereignisse ab jetzt, nicht die alten).
  useEffect(() => {
    if (events.length === 0) return;
    const newest = events[events.length - 1];
    if (lastEventId.current === null) {
      lastEventId.current = newest.id;
      return;
    }
    const fresh = events.filter((e) => e.id > (lastEventId.current ?? 0));
    lastEventId.current = newest.id;
    const message = fresh.map((e) => describeEvent(e, names, userId, viewer)).filter(Boolean).pop();
    if (message) {
      setToast(message);
      void Haptics.notificationAsync(
        message.color === colors.hunter ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      );
    }
  }, [events, names, userId, viewer]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Vorwarnung für Agenten 30 Sekunden vor dem Ping.
  const nextPingIn = game?.next_ping_at ? Date.parse(game.next_ping_at) - now : null;
  const warnNow = viewer === 'runner' && game?.status === 'hunt' && nextPingIn !== null && nextPingIn > 0 && nextPingIn <= PING_WARNING_MS;
  useEffect(() => {
    if (warnNow && game && warnedSeq.current !== game.ping_seq) {
      warnedSeq.current = game.ping_seq;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [warnNow, game]);

  const areaPoints = game?.area ?? null;
  const region = useMemo(() => (areaPoints ? regionFor(areaPoints, 1.15) : null), [areaPoints]);

  if (!game || !me) return null;

  const headstart = game.status === 'headstart';
  const timeLeft = headstart
    ? Date.parse(game.hunt_starts_at ?? '') - now
    : Date.parse(game.ends_at ?? '') - now;
  const phase = huntPhase(game, now);
  const freeRunners = countActiveRunners(players);
  const totalRunners = countRunnersAtStart(players);
  const latest = latestPingPerTarget(pings);
  const myPing = latest.get(me.user_id) ?? null;

  const sos = () =>
    Alert.alert('Notfall: Runde für alle beenden?', 'Alle Spieler sehen sofort, dass die Runde abgebrochen wurde.', [
      { text: 'Weiterspielen', style: 'cancel' },
      {
        text: 'Runde beenden',
        style: 'destructive',
        onPress: () => api.abortGame(game.id).catch((e) => Alert.alert('Fehler', errorMessage(e))),
      },
    ]);

  const hunterLocked = viewer === 'hunter' && headstart;

  return (
    <View style={styles.root}>
      {tracking === 'foreground' ? <KeepAwake /> : null}

      {region && !hunterLocked ? (
        <GameMap initialRegion={region} area={game.area} areaColor={viewer === 'hunter' ? colors.hunter : colors.signal}>
          {viewer !== 'runner'
            ? [...latest.values()].map((p) => (
                <PingLayer key={p.id} ping={p} name={names[p.target_id] ?? 'Agent'} now={now} />
              ))
            : null}
          {viewer !== 'runner'
            ? pings
                .filter((p) => latest.get(p.target_id)?.id !== p.id && latest.get(p.target_id)!.seq - p.seq === 1)
                .map((p) => (
                  <Circle
                    key={`old-${p.id}`}
                    center={toCoord(p)}
                    radius={p.radius_m}
                    strokeColor="rgba(255,59,78,0.35)"
                    strokeWidth={1}
                    fillColor="rgba(255,59,78,0.05)"
                  />
                ))
            : null}
          {viewer === 'runner' && myPing ? (
            <Circle
              center={toCoord(myPing)}
              radius={myPing.radius_m}
              strokeColor={colors.hunter}
              strokeWidth={2}
              lineDashPattern={[8, 8]}
              fillColor="rgba(255,59,78,0.08)"
            />
          ) : null}
          {Object.values(positions)
            .filter((pos) => pos.user_id !== me.user_id)
            .map((pos) => {
              const player = players.find((p) => p.user_id === pos.user_id);
              if (!player) return null;
              return (
                <Marker key={pos.user_id} coordinate={toCoord(pos)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <PlayerDot player={player} />
                </Marker>
              );
            })}
        </GameMap>
      ) : null}

      {hunterLocked ? (
        <View style={styles.lock}>
          <T variant="label" color={colors.hunter}>
            Ermittler-Terminal gesperrt
          </T>
          <T variant="big" center>
            {formatCountdown(timeLeft)}
          </T>
          <T variant="muted" center>
            Die Agenten tauchen unter. Sobald der Vorsprung vorbei ist, bekommst du den ersten Ping.
          </T>
          <T variant="muted" center>
            Modus: {modeLabel[game.mode]} · {freeRunners} Agenten
          </T>
        </View>
      ) : null}

      <SafeAreaView edges={['top']} style={styles.hud} pointerEvents="box-none">
        <View style={styles.hudCard}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge
              label={viewer === 'spectator' ? 'Zuschauer' : viewer === 'hunter' ? 'Jäger' : 'Agent'}
              color={viewer === 'hunter' ? colors.hunter : viewer === 'spectator' ? colors.muted : colors.signal}
            />
            <T variant="label">{headstart ? 'Vorsprung' : `Phase ${phase} von 3`}</T>
            <Pressable onPress={sos} style={styles.sos} accessibilityLabel="Notfall: Runde beenden">
              <Text style={styles.sosText}>SOS</Text>
            </Pressable>
          </Row>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <T variant="label">{headstart ? 'Jagd beginnt in' : 'Restzeit'}</T>
              <Text style={styles.timer}>{formatCountdown(timeLeft)}</Text>
            </View>
            {!headstart && nextPingIn !== null ? (
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="label">Nächster Ping</T>
                <Text style={[styles.timerSmall, warnNow ? { color: colors.warning } : null]}>
                  {formatCountdown(nextPingIn)}
                </Text>
              </View>
            ) : null}
          </Row>
        </View>

        {headstart && viewer === 'runner' ? <Banner text="Lauf los! Der Jäger sieht dich noch nicht." color={colors.signal} /> : null}
        {warnNow ? <Banner text="Ping in wenigen Sekunden! Wechsle jetzt die Position." /> : null}
        {inside === false ? <Banner text="Du bist außerhalb des Einsatzgebiets! Geh sofort zurück." color={colors.hunter} /> : null}
        {tracking === 'off' ? <Banner text="Kein Standortzugriff! Erlaube ihn in den Einstellungen." color={colors.hunter} /> : null}
        {toast ? <Banner text={toast.text} color={toast.color} /> : null}
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.panel}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">
            {freeRunners} von {totalRunners} Agenten frei
          </T>
          <T variant="muted">{modeLabel[game.mode]}</T>
        </Row>
        {viewer === 'runner' ? (
          <>
            <T variant="muted">
              {myPing
                ? `Der Jäger hat dich zuletzt ${formatAgo(now - Date.parse(myPing.created_at))} im roten Kreis gesehen.`
                : headstart
                  ? 'Nutze den Vorsprung und versteck dich gut.'
                  : 'Noch kein Ping von dir.'}
            </T>
            <Button title="Agenten-ID zeigen" onPress={() => setShowId(true)} disabled={!secret} />
          </>
        ) : null}
        {viewer === 'hunter' ? (
          <>
            <T variant="muted">
              {headstart
                ? 'Warte, bis der Vorsprung vorbei ist.'
                : 'Erwischt? Scanne die Agenten-ID auf dem Handy des Agenten.'}
            </T>
            <Button
              title="Agenten-ID scannen"
              kind="hunter"
              onPress={() => router.push(`/game/${game.id}/scan`)}
              disabled={headstart}
            />
          </>
        ) : null}
        {viewer === 'spectator' ? (
          <T variant="muted">Du bist raus und siehst jetzt alle Spieler live. Verrate niemandem etwas!</T>
        ) : null}
      </SafeAreaView>

      <Modal visible={showId} animationType="slide" onRequestClose={() => setShowId(false)}>
        <AgentId name={me.name} token={secret} onClose={() => setShowId(false)} />
      </Modal>
    </View>
  );
}

function PingLayer({ ping, name, now }: { ping: Ping; name: string; now: number }) {
  return (
    <>
      <Circle
        center={toCoord(ping)}
        radius={ping.radius_m}
        strokeColor={colors.hunter}
        strokeWidth={2}
        fillColor="rgba(255,59,78,0.16)"
      />
      <Marker coordinate={toCoord(ping)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges>
        <View style={styles.pingLabel}>
          <Text style={styles.pingName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.pingAge}>{formatAgo(now - Date.parse(ping.created_at))}</Text>
        </View>
      </Marker>
    </>
  );
}

function PlayerDot({ player }: { player: Player }) {
  const color = player.role === 'hunter' ? colors.hunter : colors.signal;
  return (
    <View style={styles.dotWrap}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.dotName, { color }]} numberOfLines={1}>
        {player.name}
      </Text>
    </View>
  );
}

function AgentId({ name, token, onClose }: { name: string; token: string | null; onClose: () => void }) {
  useKeepAwake('signal-hunt-agent-id');
  return (
    <SafeAreaView style={styles.idRoot}>
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <T variant="label" color={colors.black}>
          Agenten-ID
        </T>
        <Text style={styles.idName}>{name}</Text>
      </View>
      {token ? (
        <QRCode value={token} size={260} backgroundColor={colors.white} color={colors.black} />
      ) : (
        <T color={colors.black}>Keine Agenten-ID vorhanden.</T>
      )}
      <Text style={styles.idHint}>Wurdest du erwischt? Zeig diesen Code dem Jäger. Erst sein Scan zählt als Fang.</Text>
      <Button title="Schließen" kind="secondary" onPress={onClose} style={{ alignSelf: 'stretch' }} />
    </SafeAreaView>
  );
}

function describeEvent(
  e: GameEvent,
  names: Record<string, string>,
  userId: string | null,
  viewer: Viewer,
): { text: string; color: string } | null {
  const actor = e.actor_id ? (names[e.actor_id] ?? 'Jemand') : 'Jemand';
  const target = e.target_id ? (names[e.target_id] ?? 'Ein Agent') : 'Ein Agent';
  switch (e.type) {
    case 'hunt_started':
      return { text: viewer === 'hunter' ? 'Die Jagd beginnt! Erster Ping ist da.' : 'Die Jagd beginnt! Der Jäger ist unterwegs.', color: colors.hunter };
    case 'ping':
      return viewer === 'runner'
        ? { text: 'Ping! Der Jäger sieht jetzt deinen Kreis.', color: colors.hunter }
        : { text: 'Neuer Ping empfangen.', color: colors.warning };
    case 'caught':
      if (e.target_id === userId) {
        return e.payload.mode === 'infection'
          ? { text: 'Du wurdest gefangen! Ab jetzt jagst du mit.', color: colors.hunter }
          : { text: 'Du wurdest gefangen und bist raus.', color: colors.hunter };
      }
      return { text: `${target} wurde von ${actor} gefangen!`, color: colors.hunter };
    case 'left':
      return { text: `${actor} hat den Einsatz verlassen.`, color: colors.muted };
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  lock: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  hud: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, gap: space.sm },
  hudCard: {
    backgroundColor: 'rgba(14,19,23,0.94)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
    marginTop: space.sm,
  },
  timer: { color: colors.text, fontFamily: mono, fontSize: 40, fontWeight: '700' },
  timerSmall: { color: colors.text, fontFamily: mono, fontSize: 24, fontWeight: '700' },
  sos: {
    borderWidth: 1,
    borderColor: colors.hunter,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  sosText: { color: colors.hunter, fontWeight: '900', letterSpacing: 1 },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: space.lg,
    gap: space.sm,
    backgroundColor: 'rgba(14,19,23,0.96)',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  pingLabel: {
    backgroundColor: 'rgba(7,9,11,0.85)',
    borderColor: colors.hunter,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    maxWidth: 140,
  },
  pingName: { color: colors.text, fontWeight: '800', fontSize: 12 },
  pingAge: { color: colors.muted, fontSize: 10 },
  dotWrap: { alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.black },
  dotName: { fontSize: 11, fontWeight: '800', maxWidth: 100 },
  idRoot: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    padding: space.xl,
  },
  idName: { color: colors.black, fontSize: 28, fontWeight: '800' },
  idHint: { color: '#333', fontSize: 16, textAlign: 'center' },
});
