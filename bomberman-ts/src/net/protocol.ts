/**
 * Wire contract shared with `bomberman-server/src/protocol.ts`.
 * Keep these shapes in sync with the server when adding events or fields.
 */
import type { Direction } from "../constants";
import type { LevelId } from "../levels";

export const MAX_ROOM_PLAYERS = 4;

export type RoomPhase = "lobby" | "playing" | "finished";

export interface RoomConfig {
  fillBots: boolean;
  matchDuration: number;
  level: LevelId;
}

export interface RoomSeat {
  slot: number;
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

export interface SnapshotBomber {
  slot: number;
  name: string;
  color: string;
  isAi: boolean;
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
  facingDir: number;
  isMoving: boolean;
  walkFrame: number;
  bombLimit: number;
  bombsActive: number;
  power: number;
  speed: number;
  alive: boolean;
  deathTimer: number;
  score: number;
}

export interface SnapshotBomb {
  x: number;
  y: number;
  power: number;
  owner: number;
}

export interface SnapshotFlame {
  owner: number;
  cells: Array<[number, number]>;
}

export interface GameSnapshot {
  tick: number;
  phase: "playing" | "gameover";
  levelId: string;
  matchTimer: number;
  maxTime: number;
  isUnlimitedTime: boolean;
  isSuddenDeath: boolean;
  suddenDeathRing: number;
  screenShake: number;
  arena: {
    width: number;
    height: number;
    tiles: number[];
    items: Array<[number, number, number]>;
  };
  bombs: SnapshotBomb[];
  flames: SnapshotFlame[];
  bombers: SnapshotBomber[];
  winnerSlot: number | null;
  winnerName: string | null;
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

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  "room:create": (
    payload: { name: string },
    ack: (res: Ack<{ room: RoomState; yourSlot: number }>) => void,
  ) => void;
  "room:join": (
    payload: { code: string; name: string },
    ack: (res: Ack<{ room: RoomState; yourSlot: number }>) => void,
  ) => void;
  "room:leave": (ack?: (res: Ack<Record<string, never>>) => void) => void;
  "room:configure": (
    payload: Partial<RoomConfig>,
    ack: (res: Ack<{ room: RoomState }>) => void,
  ) => void;
  "room:start": (
    payload: { fillBots?: boolean },
    ack: (res: Ack<{ room: RoomState }>) => void,
  ) => void;
  "room:rematch": (ack: (res: Ack<{ room: RoomState }>) => void) => void;
  "room:lobby": (ack: (res: Ack<{ room: RoomState }>) => void) => void;
  "player:input": (payload: { dir: Direction }) => void;
  "player:bomb": () => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "match:start": (payload: MatchStartPayload) => void;
  "game:snapshot": (snapshot: GameSnapshot) => void;
  "match:end": (result: MatchResult) => void;
}
