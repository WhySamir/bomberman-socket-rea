import type { GameSnapshot } from "./game/snapshot.js";
import type { LevelId } from "./game/levels.js";
import { MAX_ROOM_PLAYERS } from "./game/constants.js";

export { MAX_ROOM_PLAYERS };
export const MIN_COMBATANTS = 2;
export const ALLOWED_MATCH_DURATIONS = [60, 120, 180, 300, 0] as const;

export type RoomPhase = "lobby" | "playing" | "finished";

export interface RoomConfig {
  /** Fill every empty seat with a bot when the host starts. */
  fillBots: boolean;
  matchDuration: number;
  level: LevelId;
}

export interface RoomSeat {
  slot: number;
  /** Socket id for humans, or the synthetic bot id. */
  id: string | null;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface RoomState {
  code: string;
  hostId: string | null;
  phase: RoomPhase;
  config: RoomConfig;
  seats: RoomSeat[];
  maxPlayers: number;
  createdAt: number;
}

export interface MatchStartPayload {
  room: RoomState;
  snapshot: GameSnapshot;
  yourSlot: number;
}

export interface MatchStanding {
  slot: number;
  id: string | null;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
  score: number;
}

export interface MatchResult {
  reason: "completed" | "abandoned";
  winner: MatchStanding | null;
  standings: MatchStanding[];
  durationMs: number;
}

export interface PlayerInput {
  dir: number;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  "room:create": (
    payload: unknown,
    ack: (res: Ack<{ room: RoomState; yourSlot: number }>) => void,
  ) => void;
  "room:join": (
    payload: unknown,
    ack: (res: Ack<{ room: RoomState; yourSlot: number }>) => void,
  ) => void;
  "room:leave": (ack?: (res: Ack<Record<string, never>>) => void) => void;
  "room:configure": (
    payload: unknown,
    ack: (res: Ack<{ room: RoomState }>) => void,
  ) => void;
  "room:start": (
    payload: unknown,
    ack: (res: Ack<{ room: RoomState }>) => void,
  ) => void;
  "room:rematch": (ack: (res: Ack<{ room: RoomState }>) => void) => void;
  "room:lobby": (ack: (res: Ack<{ room: RoomState }>) => void) => void;
  "player:input": (payload: unknown) => void;
  "player:bomb": () => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "match:start": (payload: MatchStartPayload) => void;
  "game:snapshot": (snapshot: GameSnapshot) => void;
  "match:end": (result: MatchResult) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  roomCode?: string;
  lastRoomEntryAt?: number;
}
