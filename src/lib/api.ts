import { supabase } from './supabase';
import type { AbilityId, GameMode, LatLng, Role } from './types';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type TickResult = {
  status: 'lobby' | 'headstart' | 'hunt' | 'ended';
  server_now: string;
  hunt_starts_at: string | null;
  ends_at: string | null;
  next_ping_at: string | null;
  ping_seq: number;
  /** Nur für freie Agenten: Sekunden seit der letzten echten Bewegung (über 20 m). */
  idle_sec: number | null;
  /** Nur für freie Agenten: Sekunden außerhalb des Einsatzgebiets, sonst null. */
  outside_sec: number | null;
};

export type PositionResult = {
  status: 'lobby' | 'headstart' | 'hunt' | 'ended';
  inside: boolean | null;
  idle_sec?: number | null;
  outside_sec?: number | null;
  /** Fähigkeit aus einem toten Briefkasten, den du gerade geleert hast. */
  claimed?: AbilityId | 'none' | null;
};

export type AbilityResult =
  | { ability: 'jammer' | 'fake_ping'; armed: true }
  | { ability: 'radar'; targets: number }
  | { ability: 'compass'; bearing_deg: number | null; until: string };

export const api = {
  createGame: (name: string) => call<string>('create_game', { p_name: name }),
  joinGame: (code: string, name: string) => call<string>('join_game', { p_code: code, p_name: name }),
  leaveGame: (gameId: string) => call<void>('leave_game', { p_game: gameId }),
  updateSettings: (gameId: string, mode: GameMode, headstartSec: number, durationSec: number) =>
    call<void>('update_settings', {
      p_game: gameId,
      p_mode: mode,
      p_headstart_sec: headstartSec,
      p_duration_sec: durationSec,
    }),
  setRole: (gameId: string, userId: string, role: Role) =>
    call<void>('set_role', { p_game: gameId, p_user: userId, p_role: role }),
  shuffleRoles: (gameId: string, hunters: number) => call<void>('shuffle_roles', { p_game: gameId, p_hunters: hunters }),
  setArea: (gameId: string, points: LatLng[]) => call<{ area_m2: number }>('set_area', { p_game: gameId, p_points: points }),
  startGame: (gameId: string) => call<void>('start_game', { p_game: gameId }),
  resetGame: (gameId: string) => call<void>('reset_game', { p_game: gameId }),
  tick: (gameId: string) => call<TickResult>('tick', { p_game: gameId }),
  updatePosition: (gameId: string, p: LatLng, accuracy: number | null) =>
    call<PositionResult>('update_position', {
      p_game: gameId,
      p_lat: p.lat,
      p_lng: p.lng,
      p_accuracy: accuracy,
    }),
  catchRunner: (gameId: string, token: string) =>
    call<{ target_id: string; name: string; mode: GameMode }>('catch_runner', { p_game: gameId, p_token: token }),
  abortGame: (gameId: string) => call<void>('abort_game', { p_game: gameId }),
  updateExtras: (gameId: string, abilities: AbilityId[], checkpoints: boolean) =>
    call<void>('update_extras', { p_game: gameId, p_abilities: abilities, p_checkpoints: checkpoints }),
  setCheckpointSpots: (gameId: string, points: LatLng[]) =>
    call<{ spots: number }>('set_checkpoint_spots', { p_game: gameId, p_points: points }),
  deleteMyData: () => call<void>('delete_my_data', {}),
  activateAbility: (gameId: string, ability: AbilityId) =>
    call<AbilityResult>('use_ability', { p_game: gameId, p_ability: ability }),
};
