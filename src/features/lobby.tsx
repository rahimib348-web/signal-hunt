import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { GameMap } from '@/components/game-map';
import { Badge, Banner, Button, Card, Chip, Row, Screen, T } from '@/components/ui';
import type { GameData } from '@/hooks/use-game';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatArea, polygonAreaM2, regionFor, suggestedAreaM2 } from '@/lib/geo';
import { joinLink } from '@/lib/links';
import { startTracking, type TrackingMode } from '@/lib/location';
import {
  DURATION_OPTIONS_SEC,
  HEADSTART_OPTIONS_SEC,
  modeDescription,
  modeLabel,
  roleLabel,
} from '@/lib/rules';
import { storage } from '@/lib/storage';
import { colors, mono, radius, space } from '@/lib/theme';
import { formatMinutes } from '@/lib/time';
import type { GameMode, Player } from '@/lib/types';

export function Lobby({ data }: { data: GameData }) {
  const { game, players, isHost, userId } = data;
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingMode | null>(null);
  if (!game) return null;

  const hunters = players.filter((p) => p.role === 'hunter');
  const runners = players.filter((p) => p.role === 'runner');
  const area = game.area ?? null;
  const areaM2 = area ? polygonAreaM2(area) : 0;
  const region = area ? regionFor(area) : null;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      await data.refresh();
    } catch (e) {
      Alert.alert('Hat nicht geklappt', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const saveSettings = (mode: GameMode, headstart: number, duration: number) =>
    run('settings', () => api.updateSettings(game.id, mode, headstart, duration));

  const toggleRole = (p: Player) => {
    if (!isHost) return;
    void run(`role-${p.user_id}`, () => api.setRole(game.id, p.user_id, p.role === 'hunter' ? 'runner' : 'hunter'));
  };

  const missing: string[] = [];
  if (!area) missing.push('Einsatzgebiet zeichnen');
  if (players.length < 2) missing.push('mindestens 2 Spieler');
  if (players.length >= 2 && runners.length === 0) missing.push('mindestens 1 Agent');

  const start = () => {
    Alert.alert(
      'Einsatz starten?',
      'Erinnere alle an die Regeln: nicht auf Straßen, Gleise oder Privatgelände laufen und auf den Verkehr achten.' +
        (hunters.length === 0 ? '\n\nNoch kein Jäger gewählt: Die App bestimmt einen zufällig.' : ''),
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Starten', onPress: () => void run('start', () => api.startGame(game.id)) },
      ],
    );
  };

  const leave = () => {
    Alert.alert('Einsatz verlassen?', undefined, [
      { text: 'Bleiben', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () =>
          void run('leave', async () => {
            await api.leaveGame(game.id);
            await storage.setLastGame(null);
            router.replace('/');
          }),
      },
    ]);
  };

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <T variant="label" color={colors.signal}>
          Einsatzbesprechung
        </T>
        <T variant="muted">Teile den Code mit deinen Freunden. Sie scannen den QR-Code oder tippen den Code ein.</T>
      </View>

      <Card style={styles.codeCard}>
        <View style={styles.qr}>
          <QRCode value={joinLink(game.code)} size={132} backgroundColor={colors.white} color={colors.black} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <T variant="label">Einsatz-Code</T>
          <T variant="big" style={styles.code} numberOfLines={1}>
            {game.code}
          </T>
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">Spieler ({players.length})</T>
          <T variant="muted">
            {hunters.length} Jäger · {runners.length} Agenten
          </T>
        </Row>
        {players.map((p) => (
          <Pressable
            key={p.user_id}
            onPress={() => toggleRole(p)}
            disabled={!isHost || busy !== null}
            style={styles.playerRow}
            accessibilityHint={isHost ? 'Tippen wechselt die Rolle' : undefined}>
            <T style={{ flex: 1 }} numberOfLines={1}>
              {p.name}
              {p.user_id === userId ? '  (du)' : ''}
              {p.user_id === game.host_id ? '  ★' : ''}
            </T>
            <Badge label={roleLabel[p.role]} color={p.role === 'hunter' ? colors.hunter : colors.signal} />
          </Pressable>
        ))}
        {isHost ? (
          <>
            <T variant="muted">Tippe auf einen Spieler, um seine Rolle zu wechseln.</T>
            <Row>
              <Button
                title="1 Jäger zufällig"
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() => void run('shuffle', () => api.shuffleRoles(game.id, 1))}
                disabled={busy !== null || players.length < 2}
              />
              {players.length >= 6 ? (
                <Button
                  title="2 Jäger zufällig"
                  kind="secondary"
                  style={{ flex: 1 }}
                  onPress={() => void run('shuffle', () => api.shuffleRoles(game.id, 2))}
                  disabled={busy !== null}
                />
              ) : null}
            </Row>
          </>
        ) : null}
      </Card>

      <Card>
        <T variant="heading">Spielmodus</T>
        <Row>
          {(['infection', 'elimination'] as const).map((m) => (
            <Chip
              key={m}
              label={modeLabel[m]}
              selected={game.mode === m}
              disabled={!isHost || busy !== null}
              onPress={isHost ? () => void saveSettings(m, game.headstart_sec, game.duration_sec) : undefined}
            />
          ))}
        </Row>
        <T variant="muted">{modeDescription[game.mode]}</T>

        <T variant="label">Vorsprung</T>
        <Row>
          {HEADSTART_OPTIONS_SEC.map((s) => (
            <Chip
              key={s}
              label={formatMinutes(s)}
              selected={game.headstart_sec === s}
              disabled={!isHost || busy !== null}
              onPress={isHost ? () => void saveSettings(game.mode, s, game.duration_sec) : undefined}
            />
          ))}
        </Row>

        <T variant="label">Spieldauer</T>
        <Row>
          {DURATION_OPTIONS_SEC.map((s) => (
            <Chip
              key={s}
              label={formatMinutes(s)}
              selected={game.duration_sec === s}
              disabled={!isHost || busy !== null}
              onPress={isHost ? () => void saveSettings(game.mode, game.headstart_sec, s) : undefined}
            />
          ))}
        </Row>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">Einsatzgebiet</T>
          {area ? <T variant="mono">{formatArea(areaM2)}</T> : null}
        </Row>
        {area && region ? (
          <View style={styles.mapPreview} pointerEvents="none">
            <GameMap initialRegion={region} area={area} interactive={false} showsUserLocation={false} />
          </View>
        ) : (
          <T variant="muted">
            {isHost
              ? `Noch kein Gebiet. Empfohlen für ${players.length} Spieler: etwa ${formatArea(suggestedAreaM2(players.length))}.`
              : 'Der Host zeichnet gleich das Einsatzgebiet.'}
          </T>
        )}
        {isHost ? (
          <Button
            title={area ? 'Gebiet ändern' : 'Einsatzgebiet zeichnen'}
            kind={area ? 'secondary' : 'primary'}
            onPress={() => router.push(`/game/${game.id}/area`)}
          />
        ) : null}
      </Card>

      <Card>
        <T variant="heading">Standort</T>
        <T variant="muted">
          Während der Runde sendet die App deinen Standort an das Spiel. Erlaube den Zugriff am besten „immer“, dann kannst du
          das Handy in die Tasche stecken.
        </T>
        {tracking === 'background' ? <Banner text="Standort freigegeben, auch im Hintergrund" color={colors.signal} /> : null}
        {tracking === 'foreground' ? (
          <Banner text="Standort nur bei offener App: Lass die App während der Runde geöffnet." />
        ) : null}
        {tracking === 'off' ? <Banner text="Kein Standortzugriff. Ohne Standort kannst du nicht mitspielen." color={colors.hunter} /> : null}
        {tracking !== 'background' ? (
          <Button
            title="Standort freigeben"
            kind="secondary"
            onPress={async () => setTracking(await startTracking(game.id, true))}
          />
        ) : null}
      </Card>

      <Card accent={colors.warning}>
        <T variant="label" color={colors.warning}>
          Sicherheitsregeln
        </T>
        <T variant="muted">• Nicht auf Straßen, Bahngleise oder Privatgelände laufen.</T>
        <T variant="muted">• Auf den Verkehr achten. Kein Spiel ist es wert, angefahren zu werden.</T>
        <T variant="muted">• Im Dunkeln an beleuchteten Orten bleiben.</T>
        <T variant="muted">• Im Notfall beendet der SOS-Knopf die Runde sofort für alle.</T>
      </Card>

      {isHost ? (
        <View style={{ gap: space.sm }}>
          {missing.length > 0 ? <T variant="muted" center>Noch nötig: {missing.join(', ')}</T> : null}
          <Button title="Einsatz starten" onPress={start} loading={busy === 'start'} disabled={missing.length > 0 || busy !== null} />
        </View>
      ) : (
        <Banner text="Warte auf den Host …" color={colors.muted} />
      )}

      <Button title="Einsatz verlassen" kind="ghost" onPress={leave} disabled={busy !== null} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  qr: { padding: space.sm, backgroundColor: colors.white, borderRadius: radius.md },
  code: { fontSize: 34, letterSpacing: 4, fontFamily: mono },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mapPreview: { height: 180, borderRadius: radius.md, overflow: 'hidden' },
});
