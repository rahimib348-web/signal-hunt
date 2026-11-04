import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type MapView from 'react-native-maps';
import { Marker, Polygon } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameMap, toCoord } from '@/components/game-map';
import { Banner, Button, Loading, Row, T } from '@/components/ui';
import { useGame } from '@/hooks/use-game';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  formatArea,
  MAX_AREA_M2,
  MIN_AREA_M2,
  polygonAreaM2,
  regionFor,
  regularPolygon,
  selfIntersects,
  suggestedAreaM2,
  type Region,
} from '@/lib/geo';
import { getCurrentPosition, requestForegroundPermission } from '@/lib/location';
import { colors, radius, space } from '@/lib/theme';
import type { LatLng } from '@/lib/types';

const FALLBACK_REGION: Region = { latitude: 51.1657, longitude: 10.4515, latitudeDelta: 6, longitudeDelta: 6 };

export default function AreaEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useGame(id);
  const mapRef = useRef<MapView>(null);
  const [points, setPoints] = useState<LatLng[] | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  const [saving, setSaving] = useState(false);

  const game = data.game;

  // Startausschnitt: bestehendes Gebiet, sonst eigener Standort.
  useEffect(() => {
    if (!game || initialRegion) return;
    void (async () => {
      if (game.area?.length) {
        setPoints(game.area);
        setInitialRegion(regionFor(game.area));
      } else {
        setPoints([]);
      }
      const ok = await requestForegroundPermission();
      const here = ok ? await getCurrentPosition() : null;
      setMe(here);
      if (!game.area?.length) {
        setInitialRegion(here ? { latitude: here.lat, longitude: here.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 } : FALLBACK_REGION);
      }
    })();
  }, [game, initialRegion]);

  const area = useMemo(() => (points ? polygonAreaM2(points) : 0), [points]);
  const crossing = useMemo(() => (points ? selfIntersects(points) : false), [points]);
  const recommended = suggestedAreaM2(Math.max(2, data.players.length));

  if (!game || !points || !initialRegion) return <Loading text="Karte wird geladen …" />;

  if (!data.isHost || game.status !== 'lobby') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ padding: space.lg, gap: space.lg }}>
          <T>Nur der Host kann das Einsatzgebiet vor dem Start ändern.</T>
          <Button title="Zurück" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  let problem: string | null = null;
  if (points.length > 0 && points.length < 3) problem = 'Setze mindestens 3 Punkte.';
  else if (crossing) problem = 'Die Linien kreuzen sich. Setze die Punkte der Reihe nach rundherum.';
  else if (points.length >= 3 && area < MIN_AREA_M2) problem = 'Das Gebiet ist zu klein.';
  else if (area > MAX_AREA_M2) problem = 'Das Gebiet ist zu groß (höchstens 25 km²).';

  const suggest = () => {
    if (!me) {
      Alert.alert('Standort unbekannt', 'Für den Vorschlag braucht die App deinen Standort.');
      return;
    }
    const proposal = regularPolygon(me, recommended, 8);
    setPoints(proposal);
    const r = regionFor(proposal);
    if (r) mapRef.current?.animateToRegion(r, 400);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.setArea(game.id, points);
      router.back();
    } catch (e) {
      Alert.alert('Gebiet nicht gespeichert', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <GameMap ref={mapRef} initialRegion={initialRegion} onPress={(p) => points.length < 30 && setPoints([...points, p])}>
        {points.length >= 3 ? (
          <Polygon
            coordinates={points.map(toCoord)}
            strokeColor={problem ? colors.hunter : colors.signal}
            strokeWidth={3}
            fillColor={problem ? colors.hunterDim : colors.signalDim}
          />
        ) : null}
        {points.map((p, i) => (
          <Marker
            key={`${i}-${p.lat}-${p.lng}`}
            coordinate={toCoord(p)}
            draggable
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onDragEnd={(e) => {
              const next = [...points];
              next[i] = { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude };
              setPoints(next);
            }}>
            <View style={styles.pin}>
              <Text style={styles.pinText}>{i + 1}</Text>
            </View>
          </Marker>
        ))}
      </GameMap>

      <SafeAreaView edges={['top']} style={styles.top}>
        <T variant="label" color={colors.signal}>
          Einsatzgebiet
        </T>
        <T variant="muted">Tippe auf die Karte, um Eckpunkte zu setzen. Halte einen Punkt gedrückt, um ihn zu verschieben.</T>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.panel}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="mono">{points.length >= 3 ? formatArea(area) : `${points.length} Punkte`}</T>
          <T variant="muted">Empfohlen: {formatArea(recommended)}</T>
        </Row>
        {problem ? <Banner text={problem} color={colors.hunter} /> : null}
        <T variant="muted">Nur öffentliche Wege und Plätze. Keine Gleise, Autobahnen oder Privatgelände.</T>
        <Row>
          <Button title="Vorschlag um mich" kind="secondary" style={{ flex: 1 }} onPress={suggest} />
          <Button
            title="Letzten löschen"
            kind="secondary"
            style={{ flex: 1 }}
            onPress={() => setPoints(points.slice(0, -1))}
            disabled={points.length === 0}
          />
        </Row>
        <Row>
          <Button title="Alles löschen" kind="ghost" onPress={() => setPoints([])} disabled={points.length === 0} />
          <Button
            title="Speichern"
            style={{ flex: 1 }}
            onPress={save}
            loading={saving}
            disabled={points.length < 3 || problem !== null}
          />
        </Row>
        <Button title="Abbrechen" kind="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: space.lg,
    gap: space.xs,
    backgroundColor: 'rgba(7,9,11,0.85)',
  },
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
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.signal,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.black,
  },
  pinText: { color: colors.black, fontWeight: '800', fontSize: 12 },
});
