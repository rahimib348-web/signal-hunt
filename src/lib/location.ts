import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api } from './api';
import type { LatLng } from './types';

// Sendet den Standort an den Server, auch wenn das Handy in der Tasche ist.
// In Expo Go ist das Senden im Hintergrund eingeschränkt; dann senden wir nur,
// solange die App offen ist (Bildschirm bleibt dafür an).

const TASK_NAME = 'signal-hunt-location';
const GAME_KEY = 'signal-hunt:tracking-game';
const MIN_SEND_INTERVAL_MS = 4000;

type Listener = (p: LatLng & { accuracy: number | null }, inside: boolean | null) => void;

let listeners = new Set<Listener>();
let lastSentAt = 0;
let foregroundSub: Location.LocationSubscription | null = null;
let activeGameId: string | null = null;

export type TrackingMode = 'background' | 'foreground' | 'off';

async function send(gameId: string, loc: Location.LocationObject) {
  const now = Date.now();
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;
  lastSentAt = now;
  const p = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  const accuracy = loc.coords.accuracy ?? null;
  try {
    const result = await api.updatePosition(gameId, p, accuracy);
    listeners.forEach((l) => l({ ...p, accuracy }, result.inside));
  } catch {
    // Kein Netz: beim nächsten Standort versuchen wir es wieder.
    lastSentAt = 0;
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

export async function requestForegroundPermission(): Promise<boolean> {
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
  if (!(await requestForegroundPermission())) return 'off';

  if (wantBackground) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
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
