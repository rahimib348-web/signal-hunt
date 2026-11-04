import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ABILITIES, type AbilitySlot } from '@/lib/abilities';
import { colors, mono, radius, space } from '@/lib/theme';
import { formatCountdown } from '@/lib/time';
import type { AbilityId } from '@/lib/types';

/** Knöpfe für die Fähigkeiten der eigenen Rolle: Ladungen, Abklingzeit, scharf geschaltet. */
export function AbilityBar({
  slots,
  accent,
  busy,
  onUse,
}: {
  slots: AbilitySlot[];
  accent: string;
  busy: AbilityId | null;
  onUse: (ability: AbilityId) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <View style={styles.row}>
      {slots.map((slot) => {
        const info = ABILITIES[slot.ability];
        const status = slot.armed
          ? 'scharf'
          : slot.cooldownMs > 0
            ? formatCountdown(slot.cooldownMs)
            : slot.charges === 0
              ? 'leer'
              : `${slot.charges}×`;
        const disabled = !slot.usable || busy !== null;
        return (
          <Pressable
            key={slot.ability}
            onPress={() => onUse(slot.ability)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${info.label}: ${status}`}
            accessibilityHint={info.short}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [
              styles.button,
              { borderColor: slot.armed ? colors.signal : slot.usable ? accent : colors.border },
              slot.armed ? { backgroundColor: colors.signalDim } : null,
              pressed && !disabled ? { opacity: 0.7 } : null,
              !slot.usable && !slot.armed ? { opacity: 0.55 } : null,
            ]}>
            <Text style={[styles.icon, { color: slot.usable ? accent : colors.muted }]}>{info.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.label} numberOfLines={1}>
                {info.label}
              </Text>
              <Text style={[styles.status, slot.armed ? { color: colors.signal } : null]}>
                {busy === slot.ability ? '…' : status}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.surfaceRaised,
    minHeight: 52,
  },
  icon: { fontSize: 22, fontWeight: '900', width: 24, textAlign: 'center' },
  label: { color: colors.text, fontWeight: '800', fontSize: 14 },
  status: { color: colors.muted, fontFamily: mono, fontSize: 12 },
});
