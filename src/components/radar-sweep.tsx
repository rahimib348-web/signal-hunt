import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors } from '@/lib/theme';

/** Radarschirm mit kreisendem Strahl, z. B. für den gesperrten Jäger-Bildschirm. */
export function RadarSweep({ size = 200, color = colors.signal }: { size?: number; color?: string }) {
  const angle = useSharedValue(0);

  useEffect(() => {
    angle.set(withRepeat(withTiming(360, { duration: 2600, easing: Easing.linear }), -1, false));
  }, [angle]);

  const sweep = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  const half = size / 2;

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 0.66, 0.33].map((f) => (
        <View
          key={f}
          style={[
            styles.ring,
            {
              width: size * f,
              height: size * f,
              borderRadius: (size * f) / 2,
              left: half - (size * f) / 2,
              top: half - (size * f) / 2,
              borderColor: `${color}55`,
            },
          ]}
        />
      ))}
      <View style={[styles.cross, { width: size, top: half, backgroundColor: `${color}33` }]} />
      <View style={[styles.cross, { height: size, left: half, width: 1, backgroundColor: `${color}33` }]} />
      <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
        <View style={[styles.beam, { height: half, left: half - 1, backgroundColor: color }]} />
        <View style={[styles.glow, { height: half, left: half - 14, backgroundColor: `${color}22` }]} />
      </Animated.View>
      <View style={[styles.dot, { left: half - 4, top: half - 4, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 1 },
  cross: { position: 'absolute', height: 1 },
  beam: { position: 'absolute', top: 0, width: 2, borderRadius: 1 },
  glow: { position: 'absolute', top: 0, width: 14, borderTopLeftRadius: 14 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
});
