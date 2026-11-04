import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AbilityBar } from '@/components/ability-bar';
import { GameMap, toCoord } from '@/components/game-map';
import { CheckpointMarker, CompassRay, JammedLabel, PingCircle } from '@/components/map-layers';
import { RadarSweep } from '@/components/radar-sweep';
import { Badge, Banner, Button, Row, T } from '@/components/ui';
import { useServerNow, type GameData } from '@/hooks/use-game';
import { ABILITIES, abilitySlots, directionName } from '@/lib/abilities';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { describeEvent, describePing, pickMessage, type Message, type Tone, type Viewer } from '@/lib/event-messages';
import { distanceM, formatDistance, regionFor } from '@/lib/geo';
import { onPositionSent, sendCurrentPosition, startTracking, type TrackingMode } from '@/lib/location';
import {
  BOUNDARY_GRACE_SEC,
  countActiveRunners,
  countRunnersAtStart,
  huntPhase,
  IDLE_PENALTY_SEC,
  IDLE_WARNING_SEC,
  modeLabel,
  openCheckpoints,
  PING_WARNING_MS,
  pingTrails,
} from '@/lib/rules';
import { onMutedChange, playSound, releaseSounds, setMuted } from '@/lib/sound';
import { colors, mono, radius, space } from '@/lib/theme';
import { formatAgo, formatCountdown } from '@/lib/time';
import type { AbilityId, LatLng, Player } from '@/lib/types';

const toneColor: Record<Tone, string> = {
  danger: colors.hunter,
  warning: colors.warning,
  good: colors.signal,
  info: colors.muted,
};

const COMPASS_MS = 10_000;

function KeepAwake() {
  useKeepAwake('signal-hunt-game');
  return null;
}

export function Play({ data }: { data: GameData }) {
  const { game, players, positions, pings, events, me, userId, secret, abilities, checkpoints, claims, penalty } = data;
  const now = useServerNow(data.offsetMs, 500);
  const deviceNow = now - data.offsetMs;
  const [tracking, setTracking] = useState<TrackingMode | null>(null);
  const [inside, setInside] = useState<boolean | null>(null);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [showId, setShowId] = useState(false);
  const [toast, setToast] = useState<Message | null>(null);
  const [busyAbility, setBusyAbility] = useState<AbilityId | null>(null);
  const [compass, setCompass] = useState<{ bearing: number | null; until: number } | null>(null);
  const [muted, setMutedState] = useState(false);
  const lastEventId = useRef<number | null>(null);
  const lastPingId = useRef<number | null>(null);
  const warnedSeq = useRef<number | null>(null);
  const idleWarned = useRef(false);
  const outsideWarned = useRef(false);

  const viewer: Viewer = me?.status === 'out' ? 'spectator' : me?.role === 'hunter' ? 'hunter' : 'runner';
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.user_id, p.name])), [players]);

  const announce = useCallback((message: Message | null) => {
    if (!message) return;
    setToast(message);
    if (message.sound) playSound(message.sound);
    if (message.tone === 'danger' || message.tone === 'warning') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else if (message.tone === 'good') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  // Standort senden, solange die Runde läuft.
  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    void startTracking(game.id, true).then((mode) => {
      if (!cancelled) setTracking(mode);
    });
    const off = onPositionSent((p, result) => {
      setInside(result.inside);
      setMyPos({ lat: p.lat, lng: p.lng });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onMutedChange(setMutedState), []);
  useEffect(() => () => releaseSounds(), []);

  // Meldungen zu neuen Ereignissen und besonderen Pings (nur neue, nicht die beim Laden).
  useEffect(() => {
    const maxEvent = events.reduce((m, e) => Math.max(m, e.id), 0);
    const maxPing = pings.reduce((m, p) => Math.max(m, p.id), 0);
    if (lastEventId.current === null || lastPingId.current === null) {
      lastEventId.current = maxEvent;
      lastPingId.current = maxPing;
      return;
    }
    const freshEvents = events.filter((e) => e.id > (lastEventId.current ?? 0));
    const freshPings = pings.filter((p) => p.id > (lastPingId.current ?? 0));
    lastEventId.current = Math.max(lastEventId.current, maxEvent);
    lastPingId.current = Math.max(lastPingId.current, maxPing);
    if (freshEvents.length === 0 && freshPings.length === 0) return;
    announce(
      pickMessage([
        ...freshEvents.map((e) => describeEvent(e, names, userId, viewer)),
        ...freshPings.map((p) => describePing(p, names, userId, viewer)),
      ]),
    );
  }, [events, pings, names, userId, viewer, announce]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Kompass nach 10 Sekunden ausblenden.
  useEffect(() => {
    if (!compass) return;
    const id = setTimeout(() => setCompass(null), Math.max(0, compass.until - Date.now()));
    return () => clearTimeout(id);
  }, [compass]);

  // Vorwarnung für Agenten 30 Sekunden vor dem Ping.
  const nextPingIn = game?.next_ping_at ? Date.parse(game.next_ping_at) - now : null;
  const warnNow = viewer === 'runner' && game?.status === 'hunt' && nextPingIn !== null && nextPingIn > 0 && nextPingIn <= PING_WARNING_MS;
  useEffect(() => {
    if (warnNow && game && warnedSeq.current !== game.ping_seq) {
      warnedSeq.current = game.ping_seq;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [warnNow, game]);

  // Strafen: Werte vom Server, hier im Sekundentakt weitergezählt.
  const runnerPlaying = viewer === 'runner' && (game?.status === 'hunt' || game?.status === 'headstart');
  const elapsed = penalty ? (deviceNow - penalty.at) / 1000 : 0;
  const idleSec = runnerPlaying && penalty?.idleSec != null ? penalty.idleSec + elapsed : null;
  const outsideSec = runnerPlaying && penalty?.outsideSec != null ? penalty.outsideSec + elapsed : null;
  const idleWarning = idleSec !== null && idleSec >= IDLE_WARNING_SEC;
  useEffect(() => {
    if (idleWarning && !idleWarned.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    idleWarned.current = idleWarning;
  }, [idleWarning]);
  const isOutside = outsideSec !== null;
  useEffect(() => {
    if (isOutside && !outsideWarned.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      playSound('alarm');
    }
    outsideWarned.current = isOutside;
  }, [isOutside]);

  const areaPoints = game?.area ?? null;
  const region = useMemo(() => (areaPoints ? regionFor(areaPoints, 1.15) : null), [areaPoints]);
  const trails = useMemo(() => pingTrails(pings), [pings]);

  if (!game || !me) return null;

  const headstart = game.status === 'headstart';
  const timeLeft = headstart ? Date.parse(game.hunt_starts_at ?? '') - now : Date.parse(game.ends_at ?? '') - now;
  const phase = huntPhase(game, now);
  const freeRunners = countActiveRunners(players);
  const totalRunners = countRunnersAtStart(players);
  const myTrail = trails.get(me.user_id) ?? null;
  const freeRunnerIds = new Set(players.filter((p) => p.role === 'runner' && p.status === 'active').map((p) => p.user_id));
  const here = myPos ?? (positions[me.user_id] ? { lat: positions[me.user_id].lat, lng: positions[me.user_id].lng } : null);
  const visibleCheckpoints = openCheckpoints(checkpoints, claims, now);
  const nearest = here
    ? visibleCheckpoints
        .map((c) => ({ c, d: distanceM(here, c) }))
        .sort((a, b) => a.d - b.d)[0] ?? null
    : null;
  const slots = viewer === 'spectator' ? [] : abilitySlots(me.role, game.abilities, abilities, now);
  const armed = slots.filter((s) => s.armed);
  const compassOn = compass && compass.until > deviceNow ? compass : null;
  const nextCheckpointIn = game.next_checkpoint_at ? Date.parse(game.next_checkpoint_at) - now : null;

  const sos = () =>
    Alert.alert('Notfall: Runde für alle beenden?', 'Alle Spieler sehen sofort, dass die Runde abgebrochen wurde.', [
      { text: 'Weiterspielen', style: 'cancel' },
      {
        text: 'Runde beenden',
        style: 'destructive',
        onPress: () => api.abortGame(game.id).catch((e) => Alert.alert('Fehler', errorMessage(e))),
      },
    ]);

  const runAbility = async (ability: AbilityId) => {
    setBusyAbility(ability);
    try {
      // Der Kompass rechnet ab deinem Standort: vorher einen frischen schicken.
      if (ability === 'compass') await sendCurrentPosition(game.id);
      const res = await api.activateAbility(game.id, ability);
      if (res.ability === 'compass') {
        setCompass({ bearing: res.bearing_deg, until: Date.now() + COMPASS_MS });
        playSound('ping');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (res.ability === 'radar') {
        announce({
          text: res.targets === 1 ? 'Radar: 1 Agent geortet.' : `Radar: ${res.targets} Agenten geortet.`,
          tone: 'warning',
          sound: 'ping',
          priority: 5,
        });
      }
      // Störsender und Fake-Ping melden sich über das eigene Ereignis.
      await data.refresh();
    } catch (e) {
      Alert.alert('Geht gerade nicht', errorMessage(e));
    } finally {
      setBusyAbility(null);
    }
  };

  const triggerAbility = (ability: AbilityId) => {
    const info = ABILITIES[ability];
    Alert.alert(`${info.label} einsetzen?`, info.description, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Einsetzen', onPress: () => void runAbility(ability) },
    ]);
  };

  const hunterLocked = viewer === 'hunter' && headstart;

  return (
    <View style={styles.root}>
      {tracking === 'foreground' ? <KeepAwake /> : null}

      {region && !hunterLocked ? (
        <GameMap initialRegion={region} area={game.area} areaColor={viewer === 'hunter' ? colors.hunter : colors.signal}>
          {viewer !== 'runner'
            ? [...trails.entries()].filter(([target]) => freeRunnerIds.has(target)).map(([target, trail]) => {
                const name = names[target] ?? 'Agent';
                return (
                  <Fragment key={`trail-${target}`}>
                    {trail.previous ? <PingCircle ping={trail.previous} name={name} now={now} faded /> : null}
                    {trail.located ? <PingCircle ping={trail.located} name={name} now={now} /> : null}
                    {trail.latest.kind === 'jammed' && trail.located ? <JammedLabel at={trail.located} name={name} /> : null}
                  </Fragment>
                );
              })
            : null}
          {viewer === 'runner' && myTrail?.located ? (
            <Circle
              center={toCoord(myTrail.located)}
              radius={myTrail.located.kind === 'exposed' ? 12 : myTrail.located.radius_m}
              strokeColor={colors.hunter}
              strokeWidth={2}
              lineDashPattern={[8, 8]}
              fillColor="rgba(255,59,78,0.08)"
            />
          ) : null}
          {visibleCheckpoints.map((c) => (
            <CheckpointMarker key={`cp-${c.id}`} checkpoint={c} now={now} />
          ))}
          {compassOn && compassOn.bearing !== null && here ? <CompassRay from={here} bearingDeg={compassOn.bearing} /> : null}
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
          <RadarSweep size={180} color={colors.hunter} />
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
            <Row gap={space.xs}>
              <Pressable
                onPress={() => void setMuted(!muted)}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={muted ? 'Ton einschalten' : 'Ton ausschalten'}>
                <Text style={styles.iconButtonText}>{muted ? 'Ton aus' : 'Ton an'}</Text>
              </Pressable>
              <Pressable onPress={sos} style={styles.sos} accessibilityRole="button" accessibilityLabel="Notfall: Runde beenden">
                <Text style={styles.sosText}>SOS</Text>
              </Pressable>
            </Row>
          </Row>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <T variant="label">{headstart ? 'Jagd beginnt in' : 'Restzeit'}</T>
              <Text style={styles.timer}>{formatCountdown(timeLeft)}</Text>
            </View>
            {!headstart && nextPingIn !== null ? (
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="label">Nächster Ping</T>
                <Text style={[styles.timerSmall, warnNow ? { color: colors.warning } : null]}>{formatCountdown(nextPingIn)}</Text>
              </View>
            ) : null}
          </Row>
        </View>

        {headstart && viewer === 'runner' ? <Banner text="Lauf los! Der Jäger sieht dich noch nicht." color={colors.signal} /> : null}
        {warnNow ? <Banner text="Ping in wenigen Sekunden! Wechsle jetzt die Position." /> : null}
        {viewer === 'runner' && outsideSec !== null ? (
          <Banner
            color={colors.hunter}
            text={
              headstart
                ? 'Du bist außerhalb des Einsatzgebiets! Geh zurück, sonst sieht dich der Jäger, sobald die Jagd beginnt.'
                : outsideSec < BOUNDARY_GRACE_SEC
                  ? `Zurück ins Einsatzgebiet! Noch ${Math.ceil(BOUNDARY_GRACE_SEC - outsideSec)} s, dann sieht der Jäger deinen genauen Standort.`
                  : 'Der Jäger sieht deinen genauen Standort, bis du zurück im Einsatzgebiet bist!'
            }
          />
        ) : viewer !== 'runner' && inside === false ? (
          <Banner text="Du bist außerhalb des Einsatzgebiets. Geh zurück." color={colors.hunter} />
        ) : null}
        {idleWarning && idleSec !== null ? (
          <Banner text={`Beweg dich! In ${Math.max(0, Math.ceil(IDLE_PENALTY_SEC - idleSec))} s bekommt der Jäger einen Extra-Ping von dir.`} />
        ) : null}
        {compassOn ? (
          <Banner
            color={colors.hunter}
            text={
              compassOn.bearing === null
                ? 'Kompass: Ein Agent ist ganz in deiner Nähe!'
                : `Kompass: Nächster Agent Richtung ${directionName(compassOn.bearing)} (${Math.round(compassOn.bearing)}°)`
            }
          />
        ) : null}
        {armed.map((s) => (
          <Banner key={`armed-${s.ability}`} color={colors.signal} text={`${ABILITIES[s.ability].label} scharf: ${ABILITIES[s.ability].short}.`} />
        ))}
        {tracking === 'off' ? <Banner text="Kein Standortzugriff! Erlaube ihn in den Einstellungen." color={colors.hunter} /> : null}
        {toast ? <Banner text={toast.text} color={toneColor[toast.tone]} /> : null}
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
              {myTrail?.latest.kind === 'jammed'
                ? 'Dein letzter Ping war gestört. Der Jäger hat keinen neuen Kreis von dir.'
                : myTrail?.located
                  ? `Der Jäger hat dich zuletzt ${formatAgo(now - Date.parse(myTrail.located.created_at))} im roten Kreis gesehen.`
                  : headstart
                    ? 'Nutze den Vorsprung und versteck dich gut.'
                    : 'Noch kein Ping von dir.'}
            </T>
            {nearest ? (
              <T variant="muted" color={colors.warning}>
                Toter Briefkasten {formatDistance(nearest.d)} entfernt
                {Date.parse(nearest.c.hunters_see_at) > now
                  ? ` · Jäger sieht ihn in ${formatCountdown(Date.parse(nearest.c.hunters_see_at) - now)}`
                  : ' · Jäger sieht ihn auch'}
              </T>
            ) : !headstart && nextCheckpointIn !== null && nextCheckpointIn > 0 ? (
              <T variant="muted">Nächster toter Briefkasten in {formatCountdown(nextCheckpointIn)}</T>
            ) : null}
            <AbilityBar slots={slots} accent={colors.signal} busy={busyAbility} onUse={triggerAbility} />
            <Button title="Agenten-ID zeigen" onPress={() => setShowId(true)} disabled={!secret} />
          </>
        ) : null}
        {viewer === 'hunter' ? (
          <>
            <T variant="muted">
              {headstart ? 'Warte, bis der Vorsprung vorbei ist.' : 'Erwischt? Scanne die Agenten-ID auf dem Handy des Agenten.'}
            </T>
            {visibleCheckpoints.length > 0 ? (
              <T variant="muted" color={colors.warning}>
                Ein toter Briefkasten ist aufgetaucht. Agenten wollen dorthin: Lauere ihnen auf!
              </T>
            ) : null}
            <AbilityBar slots={slots} accent={colors.hunter} busy={busyAbility} onUse={triggerAbility} />
            <Button title="Agenten-ID scannen" kind="hunter" onPress={() => router.push(`/game/${game.id}/scan`)} disabled={headstart} />
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
  iconButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  iconButtonText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
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
