import { ARENA_H, ARENA_W } from "./constants.js";
import { MultiplayerGame } from "./game.js";

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

export function captureSnapshot(
  game: MultiplayerGame,
  tick: number,
): GameSnapshot {
  const tiles: number[] = new Array(ARENA_W * ARENA_H);
  for (let y = 0; y < ARENA_H; y++) {
    for (let x = 0; x < ARENA_W; x++) {
      tiles[y * ARENA_W + x] = game.arena.getTile(x, y);
    }
  }

  const items: Array<[number, number, number]> = [];
  Array.from(game.arena.items.entries()).forEach(([key, item]) => {
    const [x, y] = key.split(",");
    items.push([Number(x), Number(y), item]);
  });

  return {
    tick,
    phase: game.phase,
    levelId: game.levelId,
    matchTimer: game.matchTimer,
    maxTime: game.maxTime,
    isUnlimitedTime: game.isUnlimitedTime,
    isSuddenDeath: game.isSuddenDeath,
    suddenDeathRing: game.suddenDeathRing,
    screenShake: game.screenShake,
    arena: {
      width: ARENA_W,
      height: ARENA_H,
      tiles,
      items,
    },
    bombs: game.bombs
      .filter((bomb) => bomb.active)
      .map((bomb) => ({
        x: bomb.tileX,
        y: bomb.tileY,
        power: bomb.power,
        owner: bomb.owner,
      })),
    flames: game.flames
      .filter((flame) => flame.active)
      .map((flame) => ({
        owner: flame.owner,
        cells: flame.cells.map((cell) => [cell.x, cell.y] as [number, number]),
      })),
    bombers: game.bombers.map((bomber) => ({
      slot: bomber.idx,
      name: bomber.name,
      color: bomber.color,
      isAi: bomber.isAi,
      tileX: bomber.tileX,
      tileY: bomber.tileY,
      pixelX: bomber.pixelX,
      pixelY: bomber.pixelY,
      facingDir: bomber.facingDir,
      isMoving: bomber.isMoving,
      walkFrame: bomber.walkFrame,
      bombLimit: bomber.bombLimit,
      bombsActive: bomber.bombsActive,
      power: bomber.power,
      speed: bomber.speed,
      alive: bomber.alive,
      deathTimer: bomber.deathTimer,
      score: bomber.score,
    })),
    winnerSlot: game.winner?.idx ?? null,
    winnerName: game.winner?.name ?? null,
  };
}
