import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Werte aus der Datei .env (siehe .env.example). EXPO_PUBLIC_* landet in der App,
// darf also nur öffentliche Schlüssel enthalten, niemals den Secret-Key.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

export const isConfigured = url.length > 0 && key.length > 0;

export const supabase = createClient(isConfigured ? url : 'http://localhost:54321', isConfigured ? key : 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Token nur erneuern, solange die App im Vordergrund ist.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Meldet das Gerät anonym an (kein Konto nötig) und gibt die Nutzer-ID zurück. */
export async function ensureSignedIn(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.user) throw error ?? new Error('sign_in_failed');
  return signIn.user.id;
}
