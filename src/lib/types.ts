export type LatLng = { lat: number; lng: number };

export type GameStatus = 'lobby' | 'headstart' | 'hunt' | 'ended';
export type GameMode = 'infection' | 'elimination';
export type Role = 'runner' | 'hunter';
export type PlayerStatus = 'active' | 'out';

export type Game = {
  id: string;
  code: string;
  host_id: string;
  status: GameStatus;
  mode: GameMode;
  headstart_sec: number;
  duration_sec: number;
  ping_intervals_sec: number[];
  ping_radii_m: number[];
  area: LatLng[] | null;
  started_at: string | null;
  hunt_starts_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  winner: 'hunters' | 'runners' | null;
  end_reason: 'all_caught' | 'time_up' | 'aborted' | 'no_hunters' | null;
  next_ping_at: string | null;
  ping_seq: number;
  created_at: string;
};

export type Player = {
  game_id: string;
  user_id: string;
  name: string;
  role: Role;
  status: PlayerStatus;
  joined_at: string;
  caught_at: string | null;
  caught_by: string | null;
};

export type Position = {
  game_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  updated_at: string;
};

export type Ping = {
  id: number;
  game_id: string;
  target_id: string;
  seq: number;
  kind: string;
  lat: number;
  lng: number;
  radius_m: number;
  created_at: string;
};

export type GameEvent = {
  id: number;
  game_id: string;
  type: 'created' | 'joined' | 'left' | 'started' | 'hunt_started' | 'ping' | 'caught' | 'ended' | 'reset';
  actor_id: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type HistoryPoint = {
  user_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
};
