// Muss früh geladen werden, damit das Senden des Standorts im Hintergrund registriert ist.
import '@/lib/location';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen, T } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.signal, text: colors.text },
};

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <View style={styles.root}>
          {isConfigured ? (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          ) : (
            <MissingConfig />
          )}
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function MissingConfig() {
  return (
    <Screen>
      <T variant="title">Signal Hunt</T>
      <T>Die Verbindung zum Server ist noch nicht eingerichtet.</T>
      <T variant="muted">
        Lege eine Datei .env an (Vorlage: .env.example) und trage EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_KEY ein.
        Danach die App neu starten.
      </T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
