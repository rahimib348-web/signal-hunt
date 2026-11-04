import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Alert } from 'react-native';

import { api, type PositionResult } from './api';
import type { LatLng } from './types';

// Sendet den Standort an den Server, auch wenn das Handy in der Tasche ist.
// In Expo Go ist das Senden im Hintergrund eingeschränkt; dann senden wir nur,
// solange die App offen ist (Bildschirm bleibt dafür an).

const TASK_NAME = 'signal-hunt-location';
const GAME_KEY = 'signal-hunt:tracking-game';
const MIN_SEND_INTERVAL_MS = 4000;

type Listener = (p: LatLng & { accuracy: number | null }, result: PositionResult) => void;

let listeners = new Set<Listener>();
let lastSentAt = 0;
let foregroundSub: Location.LocationSubscription | null = null;
let activeGameId: string | null = null;

export type TrackingMode = 'background' | 'foreground' | 'off';

async function send(gameId: string, loc: Location.LocationObject, force = false): Promise<PositionResult | null> {
  const now = Date.now();
  if (!force && now - lastSentAt < MIN_SEND_INTERVAL_MS) return null;
  lastSentAt = now;
  const p = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  const accuracy = loc.coords.accuracy ?? null;
  try {
    const result = await api.updatePosition(gameId, p, accuracy);
    listeners.forEach((l) => l({ ...p, accuracy }, result));
    return result;
  } catch {
    // Kein Netz: beim nächsten Standort versuchen wir es wieder.
    lastSentAt = 0;
    return null;
  }
}

/**
 * Holt sofort einen frischen Standort und schickt ihn. Wer stillsteht, sendet
 * sonst nichts (das GPS meldet sich erst nach ein paar Metern), z. B. vor dem Kompass.
 */
export async function sendCurrentPosition(gameId: string): Promise<PositionResult | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return await send(gameId, loc, true);
  } catch {
    return null;
  }
}

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK_NAME, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const gameId = activeGameId ?? (await AsyncStorage.getItem(GAME_KEY));
    if (!gameId) return;
    const latest = data.locations[data.locations.length - 1];
    await send(gameId, latest);
  });
}

export function onPositionSent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Deutlicher Hinweis, bevor das Handy nach dem Standort fragt (verlangt Google Play
// für den Hintergrund-Standort, ist aber auch sonst fair).
const DISCLOSURE = {
  foreground:
    'Signal Hunt nutzt deinen Standort, um das Einsatzgebiet um dich herum vorzuschlagen und während einer Runde Pings, Spielfeldgrenze und Fangen zu berechnen. Wer deinen Standort sieht, steht unter „Datenschutz und Impressum“.',
  background:
    'Signal Hunt sammelt während einer laufenden Runde deinen Standort, auch wenn die App geschlossen ist oder nicht verwendet wird. So funktionieren Pings, Spielfeldgrenze und Fangen, während dein Handy in der Tasche steckt. Nach der Runde nicht mehr. Wer deinen Standort sieht, steht unter „Datenschutz und Impressum“.',
} as const;

let openDisclosure: Promise<boolean> | null = null;

function showDisclosure(kind: keyof typeof DISCLOSURE): Promise<boolean> {
  if (openDisclosure) return openDisclosure;
  openDisclosure = new Promise<boolean>((resolve) => {
    Alert.alert(
      'Dein Standort im Spiel',
      DISCLOSURE[kind],
      [
        { text: 'Nicht jetzt', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Weiter', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  }).finally(() => {
    openDisclosure = null;
  });
  return openDisclosure;
}

export async function requestForegroundPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  if (!(await showDisclosure('foreground'))) return false;
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentPosition(): Promise<LatLng | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    const last = await Location.getLastKnownPositionAsync();
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
  }
}

async function startForeground(gameId: string) {
  foregroundSub?.remove();
  foregroundSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 3 },
    (loc) => void send(gameId, loc),
  );
}

/**
 * Startet das Senden des Standorts. Versucht zuerst den Hintergrund-Modus
 * (Handy darf in die Tasche), sonst nur bei offener App.
 */
export async function startTracking(gameId: string, wantBackground: boolean): Promise<TrackingMode> {
  activeGameId = gameId;
  await AsyncStorage.setItem(GAME_KEY, gameId);

  // Ein Hinweis vor allen Abfragen, nicht zwei hintereinander.
  const fg = await Location.getForegroundPermissionsAsync();
  let bgGranted = false;
  let mayAskBackground = false;
  if (wantBackground) {
    try {
      const bg = await Location.getBackgroundPermissionsAsync();
      bgGranted = bg.granted;
      mayAskBackground = !bg.granted && bg.canAskAgain;
    } catch {
      // Hintergrund nicht verfügbar (z. B. Expo Go): nur Vordergrund.
    }
  }
  if (!fg.granted && !fg.canAskAgain) return 'off';
  if (!fg.granted || mayAskBackground) {
    const ok = await showDisclosure(wantBackground ? 'background' : 'foreground');
    if (!ok) {
      if (!fg.granted) return 'off';
      mayAskBackground = false;
    }
  }
  if (!fg.granted) {
    const res = await Location.requestForegroundPermissionsAsync();
    if (res.status !== 'granted') return 'off';
  }

  if (wantBackground) {
    try {
      const bg = bgGranted || !mayAskBackground ? { status: bgGranted ? 'granted' : 'denied' } : await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted' && (await TaskManager.isAvailableAsync())) {
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 5,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          activityType: Location.ActivityType.Fitness,
          foregroundService: {
            notificationTitle: 'Signal Hunt läuft',
            notificationBody: 'Dein Standort wird an die laufende Runde gesendet.',
            notificationColor: '#2CFF9A',
          },
        });
        foregroundSub?.remove();
        foregroundSub = null;
        return 'background';
      }
    } catch {
      // z. B. in Expo Go auf Android: weiter mit dem Vordergrund-Modus.
    }
  }

  await startForeground(gameId);
  return 'foreground';
}

export async function stopTracking(): Promise<void> {
  activeGameId = null;
  foregroundSub?.remove();
  foregroundSub = null;
  await AsyncStorage.removeItem(GAME_KEY);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch {
    // Nichts zu stoppen.
  }
}

/** Nur für Tests. */
export function __resetForTests() {
  listeners = new Set();
  lastSentAt = 0;
}
