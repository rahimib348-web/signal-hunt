import { StyleSheet, Text, View } from 'react-native';
import { Circle, Marker, Polyline } from 'react-native-maps';

import { toCoord } from '@/components/game-map';
import { offset } from '@/lib/geo';
import { pingKindLabel } from '@/lib/rules';
import { colors, mono, radius } from '@/lib/theme';
import { formatAgo, formatCountdown } from '@/lib/time';
import type { Checkpoint, LatLng, LocatedPing } from '@/lib/types';

/** Ping-Kreis eines Agenten, so wie ihn Jäger und Zuschauer sehen. */
export function PingCircle({ ping, name, now, faded }: { ping: LocatedPing; name: string; now: number; faded?: boolean }) {
  const exact = ping.kind === 'exposed';
  if (faded) {
    return (
      <Circle
        center={toCoord(ping)}
        radius={ping.radius_m}
        strokeColor="rgba(255,59,78,0.35)"
        strokeWidth={1}
        fillColor="rgba(255,59,78,0.05)"
      />
    );
  }
  return (
    <>
      <Circle
        center={toCoord(ping)}
        radius={exact ? 12 : ping.radius_m}
        strokeColor={colors.hunter}
        strokeWidth={exact ? 3 : 2}
        lineDashPattern={ping.kind === 'radar' ? [4, 6] : undefined}
        fillColor={exact ? 'rgba(255,59,78,0.6)' : 'rgba(255,59,78,0.16)'}
      />
      <Marker coordinate={toCoord(ping)} anchor={{ x: 0.5, y: exact ? 1.4 : 0.5 }} tracksViewChanges>
        <View style={styles.pingLabel}>
          <Text style={styles.pingName} numberOfLines={1}>
            {name}
          </Text>
          {ping.kind !== 'regular' ? <Text style={styles.pingKind}>{pingKindLabel[ping.kind]}</Text> : null}
          <Text style={styles.pingAge}>{formatAgo(now - Date.parse(ping.created_at))}</Text>
        </View>
      </Marker>
    </>
  );
}

/** Hinweis am letzten bekannten Kreis, wenn der neueste Ping gestört war. */
export function JammedLabel({ at, name }: { at: LatLng; name: string }) {
  return (
    <Marker coordinate={toCoord(at)} anchor={{ x: 0.5, y: -0.4 }} tracksViewChanges={false}>
      <View style={[styles.pingLabel, { borderColor: colors.muted }]}>
        <Text style={styles.pingName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.pingKind, { color: colors.muted }]}>Signal gestört</Text>
      </View>
    </Marker>
  );
}

/** Toter Briefkasten (gelb) mit Restzeit. */
export function CheckpointMarker({ checkpoint, now }: { checkpoint: Checkpoint; now: number }) {
  const left = Date.parse(checkpoint.expires_at) - now;
  return (
    <>
      <Circle
        center={toCoord(checkpoint)}
        radius={15}
        strokeColor={colors.warning}
        strokeWidth={2}
        fillColor={colors.warningDim}
      />
      <Marker coordinate={toCoord(checkpoint)} anchor={{ x: 0.5, y: 1 }} tracksViewChanges>
        <View style={styles.cpWrap}>
          <View style={styles.cpLabel}>
            <Text style={styles.cpTitle}>Briefkasten</Text>
            <Text style={styles.cpTime}>{formatCountdown(left)}</Text>
          </View>
          <View style={styles.cpPin} />
        </View>
      </Marker>
    </>
  );
}

/** Kompass: ein Strahl in Richtung des nächsten Agenten. Feste Länge, damit er nichts über die Entfernung verrät. */
export function CompassRay({ from, bearingDeg }: { from: LatLng; bearingDeg: number }) {
  const rad = (bearingDeg * Math.PI) / 180;
  const steps = [150, 300, 450, 600];
  const points = [from, ...steps.map((m) => offset(from, m * Math.cos(rad), m * Math.sin(rad)))];
  const tip = points[points.length - 1];
  return (
    <>
      <Polyline coordinates={points.map(toCoord)} strokeColor={colors.hunter} strokeWidth={4} lineDashPattern={[12, 8]} />
      <Marker coordinate={toCoord(tip)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
        <Text style={[styles.arrow, { transform: [{ rotate: `${bearingDeg - 90}deg` }] }]}>➤</Text>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  pingLabel: {
    backgroundColor: 'rgba(7,9,11,0.85)',
    borderColor: colors.hunter,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    maxWidth: 160,
  },
  pingName: { color: colors.text, fontWeight: '800', fontSize: 12 },
  pingKind: { color: colors.hunter, fontSize: 10, fontWeight: '800' },
  pingAge: { color: colors.muted, fontSize: 10 },
  cpWrap: { alignItems: 'center' },
  cpLabel: {
    backgroundColor: 'rgba(7,9,11,0.88)',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  cpTitle: { color: colors.warning, fontWeight: '800', fontSize: 11 },
  cpTime: { color: colors.text, fontFamily: mono, fontSize: 11 },
  cpPin: { width: 10, height: 10, marginTop: 2, backgroundColor: colors.warning, transform: [{ rotate: '45deg' }] },
  arrow: { color: colors.hunter, fontSize: 28, fontWeight: '900' },
});
