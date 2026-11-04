import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Unser Supabase-Projekt "signal-hunt1" (Frankfurt). Adresse und Publishable key sind
// öffentlich: Sie stecken ohnehin in jeder App, die Daten schützen die Zugriffsregeln
// (RLS) auf dem Server. Der Secret-Key gehört NIEMALS hierher.
// Eine Datei .env (siehe .env.example) kann die Werte überschreiben, z. B. für ein lokales Supabase.
const DEFAULT_URL = 'https://gjzrruxhbqygxhfdlzxd.supabase.co';
const DEFAULT_KEY = 'sb_publishable_QmxZj9RUUDZ52pwJz6B0lQ_s-P5e9T5';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY || DEFAULT_KEY;

export const supabase = createClient(url, key, {
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
