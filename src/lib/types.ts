export type LatLng = { lat: number; lng: number };

export type GameStatus = 'lobby' | 'headstart' | 'hunt' | 'ended';
export type GameMode = 'infection' | 'elimination';
export type Role = 'runner' | 'hunter';
export type PlayerStatus = 'active' | 'out';
export type AbilityId = 'jammer' | 'fake_ping' | 'radar' | 'compass';
export type PingKind = 'regular' | 'radar' | 'idle' | 'exposed' | 'jammed';

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
  abilities: AbilityId[];
  checkpoints_enabled: boolean;
  checkpoint_spot_count: number;
  next_checkpoint_at: string | null;
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
  /** Wann der Spieler die Sicherheitsregeln für diese Runde bestätigt hat. */
  rules_accepted_at: string | null;
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
  kind: PingKind;
  /** Bei "jammed" (Störsender) ohne Ort. */
  lat: number | null;
  lng: number | null;
  radius_m: number;
  created_at: string;
};

/** Ein Ping mit Ort (alles außer "jammed"). */
export type LocatedPing = Ping & { lat: number; lng: number };

export type PlayerAbility = {
  game_id: string;
  user_id: string;
  ability: AbilityId;
  charges: number;
  armed: boolean;
  cooldown_until: string | null;
};

export type Checkpoint = {
  id: number;
  game_id: string;
  seq: number;
  lat: number;
  lng: number;
  appears_at: string;
  hunters_see_at: string;
  expires_at: string;
  revealed: boolean;
};

export type CheckpointClaim = {
  checkpoint_id: number;
  game_id: string;
  user_id: string;
  claimed_at: string;
};

export type GameEvent = {
  id: number;
  game_id: string;
  type:
    | 'created'
    | 'joined'
    | 'left'
    | 'started'
    | 'hunt_started'
    | 'ping'
    | 'caught'
    | 'ended'
    | 'reset'
    | 'ability_used'
    | 'ability_gained'
    | 'fake_ping_sent'
    | 'checkpoint'
    | 'checkpoint_claimed';
  audience: 'all' | 'runners' | 'hunters' | 'self';
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
