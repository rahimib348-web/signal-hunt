import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import type { SoundName } from './event-messages';

// Kurze Soundeffekte (erzeugt mit scripts/make-sounds.py). Sie respektieren den
// Lautlos-Schalter des Handys und laufen neben Musik anderer Apps weiter.
// Agenten können den Ton im Spiel ausschalten, damit das Handy sie nicht verrät.

const SOURCES: Record<SoundName, number> = {
  ping: require('../../assets/sounds/ping.wav'),
  alarm: require('../../assets/sounds/alarm.wav'),
  glitch: require('../../assets/sounds/glitch.wav'),
  success: require('../../assets/sounds/success.wav'),
  checkpoint: require('../../assets/sounds/checkpoint.wav'),
};

const MUTE_KEY = 'signal-hunt:muted';

let muted = false;
let configured = false;
const players: Partial<Record<SoundName, AudioPlayer>> = {};
const listeners = new Set<(muted: boolean) => void>();

async function configure() {
  if (configured) return;
  configured = true;
  try {
    muted = (await AsyncStorage.getItem(MUTE_KEY)) === '1';
    listeners.forEach((l) => l(muted));
  } catch {
    // Kein Speicher: Ton bleibt an.
  }
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  } catch {
    // Ohne Audio-Modus spielen wir trotzdem, so gut es geht.
  }
}

export function playSound(name: SoundName): void {
  void configure();
  if (muted) return;
  try {
    const player = players[name] ?? (players[name] = createAudioPlayer(SOURCES[name]));
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Ein fehlender Ton darf das Spiel nie stören.
  }
}

export function isMuted(): boolean {
  return muted;
}

export async function setMuted(value: boolean): Promise<void> {
  muted = value;
  listeners.forEach((l) => l(muted));
  try {
    await AsyncStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Nur Komfort.
  }
}

/** Meldet Änderungen am Ton-Schalter (auch den gespeicherten Wert beim Start). */
export function onMutedChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  void configure();
  return () => {
    listeners.delete(listener);
  };
}

/** Gibt die Player frei (nach dem Spiel). */
export function releaseSounds(): void {
  for (const key of Object.keys(players) as SoundName[]) {
    try {
      players[key]?.remove();
    } catch {
      // schon freigegeben
    }
    delete players[key];
  }
}
