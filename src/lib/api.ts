import { supabase } from './supabase';
import type { GameMode, LatLng, Role } from './types';

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
};

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
    call<{ status: string; inside: boolean | null }>('update_position', {
      p_game: gameId,
      p_lat: p.lat,
      p_lng: p.lng,
      p_accuracy: accuracy,
    }),
  catchRunner: (gameId: string, token: string) =>
    call<{ target_id: string; name: string; mode: GameMode }>('catch_runner', { p_game: gameId, p_token: token }),
  abortGame: (gameId: string) => call<void>('abort_game', { p_game: gameId }),
};
