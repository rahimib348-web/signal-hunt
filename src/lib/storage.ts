import AsyncStorage from '@react-native-async-storage/async-storage';

const NAME_KEY = 'signal-hunt:name';
const LAST_GAME_KEY = 'signal-hunt:last-game';

async function safeGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // Speichern ist nur Komfort, kein Fehler für den Spieler.
  }
}

export const storage = {
  getName: () => safeGet(NAME_KEY),
  setName: (name: string) => safeSet(NAME_KEY, name),
  getLastGame: () => safeGet(LAST_GAME_KEY),
  setLastGame: (gameId: string | null) => safeSet(LAST_GAME_KEY, gameId),
};
