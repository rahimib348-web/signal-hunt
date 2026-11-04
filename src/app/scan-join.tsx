import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QrScanner } from '@/components/qr-scanner';
import { Banner, Button, T } from '@/components/ui';
import { parseJoinCode } from '@/lib/links';
import { colors, space } from '@/lib/theme';

export default function ScanJoin() {
  const [hint, setHint] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <QrScanner
        onScan={(data) => {
          const code = parseJoinCode(data);
          if (!code) {
            setHint('Das ist kein Einsatz-Code von Signal Hunt.');
            return false;
          }
          router.replace(`/join/${code}`);
          return true;
        }}
      />
      <SafeAreaView style={styles.top} edges={['top']}>
        <T variant="heading" center>
          Einsatz-QR-Code scannen
        </T>
        <T variant="muted" center>
          Der Host findet ihn in der Einsatzbesprechung.
        </T>
        {hint ? <Banner text={hint} /> : null}
      </SafeAreaView>
      <SafeAreaView style={styles.bottom} edges={['bottom']}>
        <Button title="Abbrechen" kind="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: space.lg, gap: space.sm, backgroundColor: 'rgba(7,9,11,0.8)' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: space.lg },
});
