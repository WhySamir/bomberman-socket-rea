/**
 * Server-authoritative Bomberman match.
 *
 * The simulation mirrors the web client's `GameEngine` (same arena, bomb,
 * flame, bomber and AI code) with three intentional differences required for
 * online rooms:
 *
 * 1. No browser/audio/particle side effects run on the server.
 * 2. Every combatant is an independent free-for-all opponent; bots fill empty
 *    slots instead of forming a squad against one human.
 * 3. The match ends when one combatant remains, or when every human-controlled
 *    bomber has been eliminated.
 */
import {
  ARENA_W,
  ARENA_H,
  MAX_BOMBS,
  MAX_FLAMES,
  TILE_SIZE,
  SPAWN_POSITIONS,
  PLAYER_COLORS,
  PLAYER_NAMES,
  FUSE_SHARED_TILE,
  MAX_ROOM_PLAYERS,
} from "./constants.js";
import { Arena } from "./arena.js";
import { CBomb } from "./bomb.js";
import { CFlame, FlameCell } from "./flame.js";
import { CBomber } from "./bomber.js";
import { CAiBomber } from "./ai.js";
import { LevelId, getLevel } from "./levels.js";

export interface CombatantSpec {
  slot: number;
  name: string;
  color?: string;
  isAi: boolean;
}

export interface MultiplayerMatchConfig {
  level?: LevelId;
  timeSec?: number;
  combatants: CombatantSpec[];
}

export type MatchPhase = "playing" | "gameover";

export class MultiplayerGame {
  public arena = new Arena();
  public bombs: CBomb[] = [];
  public flames: CFlame[] = [];
  public bombers: CBomber[] = [];
  public ais: CAiBomber[] = [];

  public phase: MatchPhase = "playing";
  public matchTimer = 180;
  public maxTime = 180;
  public isUnlimitedTime = false;
  public isSuddenDeath = false;
  public suddenDeathRing = 0;
  public winner: CBomber | null = null;
  public levelId: LevelId = "classic";
  public screenShake = 0;
  public startedAt = Date.now();
  public endedAt: number | null = null;
  private hadHumanCombatants = true;

  public get bombPool(): CBomb[] {
    return this.bombs;
  }

  public get flamePool(): CFlame[] {
    return this.flames;
  }

  public get aiControllers(): CAiBomber[] {
    return this.ais;
  }

  public get isMatchActive(): boolean {
    return this.phase === "playing";
  }

  constructor(config: MultiplayerMatchConfig) {
    for (let i = 0; i < MAX_BOMBS; i++) this.bombs.push(new CBomb());
    for (let i = 0; i < MAX_FLAMES; i++) this.flames.push(new CFlame());
    this.startMatch(config);
  }

  public startMatch(config: MultiplayerMatchConfig) {
    const timeSec = config.timeSec ?? 180;
    this.arena.reset();
    this.levelId = config.level ?? "classic";
    this.isUnlimitedTime = timeSec <= 0;
    this.maxTime = timeSec > 0 ? timeSec : 0;
    this.matchTimer = this.maxTime;
    this.isSuddenDeath = false;
    this.suddenDeathRing = 0;
    this.screenShake = 0;
    this.phase = "playing";
    this.winner = null;
    this.startedAt = Date.now();
    this.endedAt = null;
    for (const b of this.bombs) b.reset();
    for (const f of this.flames) {
      f.active = false;
      f.cells = [];
    }

    const aiMode = getLevel(this.levelId).aiMode;
    const combatants = [...config.combatants]
      .sort((a, b) => a.slot - b.slot)
      .slice(0, MAX_ROOM_PLAYERS);
    if (combatants.length < 2) {
      throw new Error("A multiplayer match needs at least two combatants");
    }

    this.bombers = [];
    this.ais = [];
    this.hadHumanCombatants = combatants.some((spec) => !spec.isAi);
    for (const spec of combatants) {
      const slot = Math.max(0, Math.min(MAX_ROOM_PLAYERS - 1, spec.slot));
      const name =
        spec.name || (spec.isAi ? PLAYER_NAMES[slot] : `Player ${slot + 1}`);
      const color = spec.color ?? PLAYER_COLORS[slot] ?? PLAYER_COLORS[0];
      const bomber = new CBomber(slot, name, color, spec.isAi);
      bomber.spawn(SPAWN_POSITIONS[slot].x, SPAWN_POSITIONS[slot].y);
      this.bombers.push(bomber);
      if (spec.isAi) this.ais.push(new CAiBomber(bomber, aiMode));
    }
  }

  /** Replace a human with a bot after a disconnect or voluntary leave. */
  public takeOverWithAi(slot: number): boolean {
    const bomber = this.bombers.find((b) => b.idx === slot);
    if (!bomber) return false;
    if (!bomber.isAi) {
      bomber.isAi = true;
      bomber.name = `${bomber.name} (bot)`.slice(0, 24);
    }
    if (!this.ais.some((ai) => ai.bomber === bomber)) {
      this.ais.push(new CAiBomber(bomber, getLevel(this.levelId).aiMode));
    }
    return true;
  }

  public spawnBomb(bomber: CBomber) {
    if (this.phase !== "playing") return;
    if (!bomber.alive) return;
    if (bomber.bombsActive >= bomber.bombLimit) return;
    const tx = bomber.tileX;
    const ty = bomber.tileY;
    if (!this.arena.canPlaceBomb(tx, ty)) return;

    const slot = this.bombs.find((b) => !b.active);
    if (!slot) return;

    // Check if another combatant is currently on or overlapping this tile.
    const otherBomberPresent = this.bombers.some((b) => {
      if (!b.alive || b.idx === bomber.idx) return false;
      const bLeft = tx * TILE_SIZE;
      const bRight = (tx + 1) * TILE_SIZE;
      const bTop = ty * TILE_SIZE;
      const bBottom = (ty + 1) * TILE_SIZE;
      const pLeft = b.pixelX + 6;
      const pRight = b.pixelX + TILE_SIZE - 6;
      const pTop = b.pixelY + 6;
      const pBottom = b.pixelY + TILE_SIZE - 6;
      const overlaps =
        pLeft < bRight && pRight > bLeft && pTop < bBottom && pBottom > bTop;
      return overlaps || (b.tileX === tx && b.tileY === ty);
    });

    // A shared tile gets a longer fuse so every combatant can escape.
    const fuseTime = otherBomberPresent
      ? FUSE_SHARED_TILE
      : bomber.getFuseTime();

    slot.activate(tx, ty, bomber.getFlameSize(), fuseTime, bomber.idx);
    this.arena.setBomb(tx, ty, true);
    bomber.bombsActive++;

    // Grant passability to every combatant currently in or overlapping the tile.
    for (const b of this.bombers) {
      if (!b.alive) continue;
      const bLeft = tx * TILE_SIZE;
      const bRight = (tx + 1) * TILE_SIZE;
      const bTop = ty * TILE_SIZE;
      const bBottom = (ty + 1) * TILE_SIZE;
      const pLeft = b.pixelX + 6;
      const pRight = b.pixelX + TILE_SIZE - 6;
      const pTop = b.pixelY + 6;
      const pBottom = b.pixelY + TILE_SIZE - 6;
      const overlaps =
        pLeft < bRight && pRight > bLeft && pTop < bBottom && pBottom > bTop;
      if (overlaps || (b.tileX === tx && b.tileY === ty)) {
        b.passableBombs.add(`${tx},${ty}`);
      }
    }
  }

  private explode(bomb: CBomb) {
    const bx = bomb.tileX;
    const by = bomb.tileY;
    const power = bomb.power;

    bomb.active = false;
    this.arena.setBomb(bx, by, false);

    const owner = this.bombers.find((b) => b.idx === bomb.owner);
    if (owner) owner.bombsActive = Math.max(0, owner.bombsActive - 1);

    const cells: FlameCell[] = [{ x: bx, y: by }];
    this.arena.setFlame(bx, by, true);

    const dirs: Array<{ dx: number; dy: number }> = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    for (const d of dirs) {
      for (let i = 1; i <= power; i++) {
        const nx = bx + d.dx * i;
        const ny = by + d.dy * i;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) break;

        const block = this.arena.isFlameBlocking(nx, ny);
        if (block === "hard") break;
        if (block === "soft") {
          this.arena.destroySoftBlock(nx, ny);
          cells.push({ x: nx, y: ny });
          this.arena.setFlame(nx, ny, true);
          break;
        }

        const chainBomb = this.bombs.find(
          (b) => b.active && !b.exploded && b.tileX === nx && b.tileY === ny,
        );
        if (chainBomb) chainBomb.forceDetonate();

        cells.push({ x: nx, y: ny });
        this.arena.setFlame(nx, ny, true);
      }
    }

    const flameSlot = this.flames.find((f) => !f.active);
    if (flameSlot) flameSlot.activate(cells, bomb.owner);
  }

  public triggerSuddenDeathWall() {
    this.isSuddenDeath = true;
    this.suddenDeathRing++;
    this.screenShake = 0.5;

    const built = this.arena.buildSuddenDeathRing(this.suddenDeathRing);

    if (built.length > 0) {
      for (const pos of built) {
        const wLeft = pos.x * TILE_SIZE;
        const wRight = (pos.x + 1) * TILE_SIZE;
        const wTop = pos.y * TILE_SIZE;
        const wBottom = (pos.y + 1) * TILE_SIZE;

        for (const b of this.bombers) {
          if (!b.alive) continue;
          const pLeft = b.pixelX + 6;
          const pRight = b.pixelX + TILE_SIZE - 6;
          const pTop = b.pixelY + 6;
          const pBottom = b.pixelY + TILE_SIZE - 6;

          const caught =
            (b.tileX === pos.x && b.tileY === pos.y) ||
            (pLeft < wRight &&
              pRight > wLeft &&
              pTop < wBottom &&
              pBottom > wTop);

          if (caught) b.die();
        }

        for (const bomb of this.bombs) {
          if (bomb.active && bomb.tileX === pos.x && bomb.tileY === pos.y) {
            bomb.active = false;
            this.arena.setBomb(pos.x, pos.y, false);
          }
        }
      }
    }

    this.matchTimer = 60;
    this.checkMatchEnd();
  }

  public update(dt: number) {
    if (this.phase !== "playing") return;

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt);
    }

    if (!this.isUnlimitedTime) {
      this.matchTimer -= dt;
      if (this.matchTimer <= 0) {
        this.triggerSuddenDeathWall();
        if (this.phase !== "playing") return;
      }
    } else {
      this.matchTimer += dt;
    }

    for (const bomb of this.bombs) {
      if (!bomb.active) continue;
      if (bomb.exploded) {
        this.explode(bomb);
      } else {
        const detonated = bomb.process(dt);
        if (detonated) this.explode(bomb);
      }
    }

    for (const flame of this.flames) {
      if (!flame.active) continue;
      const done = flame.process(dt);
      if (done) {
        for (const c of flame.cells) this.arena.setFlame(c.x, c.y, false);
        flame.cells = [];
      }
    }

    for (const ai of this.ais) {
      ai.process(dt, this.arena, this.bombers, this.bombs, this.ais);
      if (ai.wantBomb) this.spawnBomb(ai.bomber);
    }

    for (const b of this.bombers) {
      if (!b.alive) {
        b.deathTimer -= dt;
        continue;
      }
      b.update(dt, this.arena);
    }

    for (const flame of this.flames) {
      if (!flame.active) continue;

      for (const cell of flame.cells) {
        const cellLeft = cell.x * TILE_SIZE;
        const cellRight = (cell.x + 1) * TILE_SIZE;
        const cellTop = cell.y * TILE_SIZE;
        const cellBottom = (cell.y + 1) * TILE_SIZE;

        for (const b of this.bombers) {
          if (!b.alive) continue;

          const pLeft = b.pixelX + 4;
          const pRight = b.pixelX + TILE_SIZE - 4;
          const pTop = b.pixelY + 4;
          const pBottom = b.pixelY + TILE_SIZE - 4;

          const aabbOverlap =
            pLeft < cellRight - 2 &&
            pRight > cellLeft + 2 &&
            pTop < cellBottom - 2 &&
            pBottom > cellTop + 2;
          const centerInCell = b.tileX === cell.x && b.tileY === cell.y;

          if (centerInCell || aabbOverlap) b.die();
        }
      }
    }

    this.checkMatchEnd();
  }

  public aliveBombers(): CBomber[] {
    return this.bombers.filter((b) => b.alive);
  }

  private checkMatchEnd() {
    if (this.phase !== "playing") return;

    const alive = this.aliveBombers();
    const humansAlive = alive.filter((b) => !b.isAi);

    if (
      alive.length <= 1 ||
      (this.hadHumanCombatants && humansAlive.length === 0)
    ) {
      this.phase = "gameover";
      this.endedAt = Date.now();
      this.winner = alive.length === 1 ? alive[0] : null;
      if (this.winner) this.winner.score++;
    }
  }
}
