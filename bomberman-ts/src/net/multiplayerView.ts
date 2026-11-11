import { CBomber } from "../bomber";
import { Direction, ItemType } from "../constants";
import { GameEngine } from "../game";
import { LevelId } from "../levels";
import { GameSnapshot } from "./protocol";

interface InterpolatedPosition {
  x: number;
  y: number;
}

interface SnapshotSample {
  snapshot: GameSnapshot;
  positions: Map<number, InterpolatedPosition>;
}

/**
 * Holds the two most recent authoritative snapshots and interpolates bomber
 * positions between them so 20 Hz network updates render smoothly at 60 fps.
 */
export class SnapshotBuffer {
  private current: GameSnapshot | null = null;
  private previous: GameSnapshot | null = null;
  private currentAt = 0;
  private gapMs = 50;

  public clear() {
    this.current = null;
    this.previous = null;
    this.currentAt = 0;
    this.gapMs = 50;
  }

  public get latest(): GameSnapshot | null {
    return this.current;
  }

  public push(snapshot: GameSnapshot) {
    const now = performance.now();
    if (this.current) {
      const gap = now - this.currentAt;
      if (gap > 8 && gap < 500) {
        this.gapMs = this.gapMs * 0.75 + gap * 0.25;
      }
      this.previous = this.current;
    }
    this.current = snapshot;
    this.currentAt = now;
  }

  public sample(now = performance.now()): SnapshotSample | null {
    const current = this.current;
    if (!current) return null;

    const alpha = this.previous
      ? Math.min(1, Math.max(0, (now - this.currentAt) / this.gapMs))
      : 1;
    const positions = new Map<number, InterpolatedPosition>();

    for (const bomber of current.bombers) {
      const previous = this.previous?.bombers.find(
        (entry) => entry.slot === bomber.slot,
      );
      positions.set(
        bomber.slot,
        previous
          ? {
              x: previous.pixelX + (bomber.pixelX - previous.pixelX) * alpha,
              y: previous.pixelY + (bomber.pixelY - previous.pixelY) * alpha,
            }
          : { x: bomber.pixelX, y: bomber.pixelY },
      );
    }

    return { snapshot: current, positions };
  }
}

/**
 * Projects server snapshots onto the existing `GameEngine` shape so the exact
 * same canvas renderer and HUD can draw an online match. This object never runs
 * local simulation; every authoritative value comes from the server.
 */
export class MultiplayerView {
  public readonly game = new GameEngine();
  private readonly buffer = new SnapshotBuffer();
  public latest: GameSnapshot | null = null;
  public localSlot = 0;

  public reset() {
    this.buffer.clear();
    this.latest = null;
    this.game.particles = [];
  }

  public applySnapshot(snapshot: GameSnapshot) {
    this.latest = snapshot;
    this.buffer.push(snapshot);
  }

  public sync() {
    const sample = this.buffer.sample();
    if (!sample) return;
    this.hydrate(sample.snapshot, sample.positions);
  }

  public localBomber(): CBomber | null {
    return (
      this.game.bombers.find((bomber) => bomber.idx === this.localSlot) ?? null
    );
  }

  private hydrate(
    snapshot: GameSnapshot,
    positions: Map<number, InterpolatedPosition>,
  ) {
    const game = this.game;

    game.phase = snapshot.phase;
    game.levelId = snapshot.levelId as LevelId;
    game.matchTimer = snapshot.matchTimer;
    game.maxTime = snapshot.maxTime;
    game.isUnlimitedTime = snapshot.isUnlimitedTime;
    game.isSuddenDeath = snapshot.isSuddenDeath;
    game.suddenDeathRing = snapshot.suddenDeathRing;
    game.screenShake = snapshot.screenShake;
    game.isPaused = false;
    game.humanCount = snapshot.bombers.filter((bomber) => !bomber.isAi).length;

    const width = snapshot.arena.width;
    const height = snapshot.arena.height;
    game.arena.tiles = [];
    for (let y = 0; y < height; y++) {
      game.arena.tiles.push(
        snapshot.arena.tiles.slice(y * width, (y + 1) * width),
      );
    }

    game.arena.items = new Map(
      snapshot.arena.items.map(([x, y, item]) => [
        `${x},${y}`,
        item as ItemType,
      ]),
    );

    game.arena.bombs = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false),
    );
    game.arena.flames = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false),
    );

    for (let i = 0; i < game.bombs.length; i++) {
      const bomb = game.bombs[i];
      const state = snapshot.bombs[i];
      if (!state) {
        bomb.active = false;
        continue;
      }
      bomb.active = true;
      bomb.exploded = false;
      bomb.tileX = state.x;
      bomb.tileY = state.y;
      bomb.power = state.power;
      bomb.owner = state.owner;
      if (state.y >= 0 && state.y < height && state.x >= 0 && state.x < width) {
        game.arena.bombs[state.y][state.x] = true;
      }
    }

    for (let i = 0; i < game.flames.length; i++) {
      const flame = game.flames[i];
      const state = snapshot.flames[i];
      if (!state) {
        flame.active = false;
        flame.cells = [];
        continue;
      }
      flame.active = true;
      flame.owner = state.owner;
      flame.cells = state.cells.map(([x, y]) => ({ x, y }));
      for (const [x, y] of state.cells) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          game.arena.flames[y][x] = true;
        }
      }
    }

    const bombers: CBomber[] = [];
    for (const state of snapshot.bombers) {
      let bomber = game.bombers.find((entry) => entry.idx === state.slot);
      if (!bomber) {
        bomber = new CBomber(state.slot, state.name, state.color, state.isAi);
      }
      bomber.idx = state.slot;
      bomber.name = state.name;
      bomber.color = state.color;
      bomber.isAi = state.isAi;
      bomber.tileX = state.tileX;
      bomber.tileY = state.tileY;
      const position = positions.get(state.slot);
      bomber.pixelX = position?.x ?? state.pixelX;
      bomber.pixelY = position?.y ?? state.pixelY;
      bomber.facingDir = state.facingDir as Direction;
      bomber.isMoving = state.isMoving;
      bomber.walkFrame = state.walkFrame;
      bomber.bombLimit = state.bombLimit;
      bomber.bombsActive = state.bombsActive;
      bomber.power = state.power;
      bomber.speed = state.speed;
      bomber.alive = state.alive;
      bomber.deathTimer = state.deathTimer;
      bomber.score = state.score;
      bombers.push(bomber);
    }
    game.bombers = bombers;
    game.ais = [];
    game.winner =
      snapshot.winnerSlot === null
        ? null
        : (bombers.find((bomber) => bomber.idx === snapshot.winnerSlot) ??
          null);
  }
}
