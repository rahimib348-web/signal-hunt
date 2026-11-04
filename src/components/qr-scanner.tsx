import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Loading, Screen, T } from '@/components/ui';
import { colors, radius } from '@/lib/theme';

/**
 * Kamera mit QR-Erkennung. onScan wird pro erkanntem Code nur einmal aufgerufen;
 * gibt onScan false zurück, wird der nächste Code wieder angenommen.
 */
export function QrScanner({
  onScan,
  paused,
  frameColor = colors.signal,
}: {
  onScan: (data: string) => Promise<boolean> | boolean;
  paused?: boolean;
  frameColor?: string;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const busy = useRef(false);
  const lastData = useRef<string | null>(null);

  if (!permission) return <Loading text="Kamera wird vorbereitet …" />;

  if (!permission.granted) {
    return (
      <Screen>
        <T variant="heading">Kamera erlauben</T>
        <T variant="muted">Zum Scannen der QR-Codes braucht Signal Hunt Zugriff auf die Kamera.</T>
        {permission.canAskAgain ? (
          <Button title="Kamera erlauben" onPress={requestPermission} />
        ) : (
          <Button title="Einstellungen öffnen" onPress={() => void Linking.openSettings()} />
        )}
      </Screen>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          paused
            ? undefined
            : async ({ data }) => {
                if (busy.current || data === lastData.current) return;
                busy.current = true;
                lastData.current = data;
                try {
                  const done = await onScan(data);
                  if (!done) {
                    // Gleichen Code erst nach kurzer Pause erneut versuchen.
                    setTimeout(() => {
                      lastData.current = null;
                    }, 2500);
                  }
                } finally {
                  busy.current = false;
                }
              }
        }
      />
      <View pointerEvents="none" style={styles.overlay}>
        <View style={[styles.frame, { borderColor: frameColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 260, height: 260, borderWidth: 3, borderRadius: radius.lg },
});
