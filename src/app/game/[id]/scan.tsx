import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QrScanner } from '@/components/qr-scanner';
import { Banner, Button, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { isCatchToken } from '@/lib/links';
import { colors, space } from '@/lib/theme';

export default function CatchScanner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(data: string): Promise<boolean> {
    if (!isCatchToken(data)) {
      setResult({ ok: false, text: 'Das ist keine Agenten-ID von Signal Hunt.' });
      return false;
    }
    setBusy(true);
    try {
      const caught = await api.catchRunner(id, data.trim());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({
        ok: true,
        text:
          caught.mode === 'infection'
            ? `${caught.name} ist gefangen und jagt ab sofort mit dir!`
            : `${caught.name} ist gefangen und scheidet aus!`,
      });
      setTimeout(() => router.back(), 2200);
      return true;
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setResult({ ok: false, text: errorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <QrScanner onScan={handle} paused={result?.ok === true} frameColor={colors.hunter} />
      <SafeAreaView edges={['top']} style={styles.top}>
        <T variant="label" color={colors.hunter} center>
          Fang bestätigen
        </T>
        <T variant="heading" center>
          Scanne die Agenten-ID
        </T>
        <T variant="muted" center>
          Der Agent zeigt sie auf seinem Handy unter „Agenten-ID zeigen“.
        </T>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        {busy ? <Banner text="Prüfe Agenten-ID …" color={colors.muted} /> : null}
        {result ? <Banner text={result.text} color={result.ok ? colors.signal : colors.hunter} /> : null}
        <Button title="Zurück zur Karte" kind="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: space.lg, gap: space.xs, backgroundColor: 'rgba(7,9,11,0.8)' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: space.lg, gap: space.sm },
});
