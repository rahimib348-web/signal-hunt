import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, mono, radius, space } from '@/lib/theme';

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, style]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'label' | 'mono' | 'big';

export function T({
  children,
  variant = 'body',
  color,
  style,
  center,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  center?: boolean;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[textStyles[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'hunter' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: string;
}) {
  const k = buttonKinds[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: k.bg, borderColor: k.border },
        pressed && !inactive ? { opacity: 0.75 } : null,
        inactive ? { opacity: 0.4 } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={k.text} />
      ) : (
        <Text style={[styles.buttonText, { color: k.text }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const buttonKinds: Record<ButtonKind, { bg: string; border: string; text: string }> = {
  primary: { bg: colors.signal, border: colors.signal, text: colors.black },
  secondary: { bg: colors.surfaceRaised, border: colors.border, text: colors.text },
  danger: { bg: 'transparent', border: colors.hunter, text: colors.hunter },
  hunter: { bg: colors.hunter, border: colors.hunter, text: colors.white },
  ghost: { bg: 'transparent', border: 'transparent', text: colors.muted },
};

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  return <View style={[styles.card, accent ? { borderColor: accent } : null, style]}>{children}</View>;
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={[
        styles.chip,
        selected ? { backgroundColor: colors.signalDim, borderColor: colors.signal } : null,
        disabled && !selected ? { opacity: 0.5 } : null,
      ]}>
      <Text style={[styles.chipText, selected ? { color: colors.signal } : null]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, color = colors.signal }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Banner({ text, color = colors.warning, style }: { text: string; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.banner, { borderColor: color, backgroundColor: `${color}22` }, style]}>
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      <T variant="label">{label}</T>
      <TextInput
        placeholderTextColor={colors.faint}
        selectionColor={colors.signal}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Loading({ text = 'Verbinde …' }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.signal} size="large" />
      <T variant="muted" center>
        {text}
      </T>
    </View>
  );
}

const textStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  mono: { color: colors.text, fontFamily: mono, fontSize: 16 },
  big: { color: colors.text, fontFamily: mono, fontSize: 56, fontWeight: '700', letterSpacing: 2 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: colors.bg },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
  bannerText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
});
