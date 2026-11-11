/**
 * GameEngine — master coordinator
 * Reverse-engineered from Bombermaaan findings
 * Implements arena lifecycle, bomb/flame pool processing, and Sudden Death perimeter shrinking
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
} from "./constants";
import { Arena } from "./arena";
import { CBomb } from "./bomb";
import { CFlame, FlameCell } from "./flame";
import { CBomber } from "./bomber";
import { CAiBomber } from "./ai";
import { LevelId, getLevel } from "./levels";
import { sound } from "./sound";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export type GamePhase = "menu" | "playing" | "gameover";

export interface MatchConfig {
  level?: LevelId;
  humanCount?: number;
}

export class GameEngine {
  public arena = new Arena();
  public bombs: CBomb[] = [];
  public flames: CFlame[] = [];
  public bombers: CBomber[] = [];
  public ais: CAiBomber[] = [];
  public particles: Particle[] = [];

  public phase: GamePhase = "menu";
  public matchTimer = 180;
  public maxTime = 180;
  public isUnlimitedTime = false;
  public isSuddenDeath = false;
  public suddenDeathRing = 0;
  public isPaused = false;
  public winner: CBomber | null = null;
  public levelId: LevelId = "classic";
  public humanCount = 1;

  public screenShake = 0;

  // Pool compatibility getters for renderer / HUD
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

  constructor() {
    for (let i = 0; i < MAX_BOMBS; i++) this.bombs.push(new CBomb());
    for (let i = 0; i < MAX_FLAMES; i++) this.flames.push(new CFlame());
  }

  public startNewMatch(
    botCount: number = 3,
    timeSec: number = 180,
    config: MatchConfig = {},
  ) {
    this.startMatch(botCount, timeSec, config);
  }

  public startMatch(
    botCount: number = 3,
    timeSec: number = 180,
    config: MatchConfig = {},
  ) {
    this.arena.reset();
    this.levelId = config.level ?? "classic";
    this.humanCount = Math.min(2, Math.max(1, config.humanCount ?? 1));
    this.particles = [];
    this.isUnlimitedTime = timeSec <= 0;
    this.maxTime = timeSec > 0 ? timeSec : 0;
    this.matchTimer = this.maxTime;
    this.isSuddenDeath = false;
    this.suddenDeathRing = 0;
    this.screenShake = 0;
    this.phase = "playing";
    this.isPaused = false;
    this.winner = null;
    for (const b of this.bombs) b.reset();
    for (const f of this.flames) {
      f.active = false;
      f.cells = [];
    }

    const total = Math.min(5, this.humanCount + Math.max(1, botCount));
    const aiMode = getLevel(this.levelId).aiMode;
    this.bombers = [];
    this.ais = [];
    for (let i = 0; i < total; i++) {
      const isAi = i >= this.humanCount;
      const name = isAi
        ? PLAYER_NAMES[i]
        : i === 0
          ? PLAYER_NAMES[0]
          : "Player 2 (You)";
      const color = isAi
        ? PLAYER_COLORS[i]
        : i === 0
          ? PLAYER_COLORS[0]
          : "#FF3366";
      const b = new CBomber(i, name, color, isAi);
      b.spawn(SPAWN_POSITIONS[i].x, SPAWN_POSITIONS[i].y);
      this.bombers.push(b);
      if (isAi) this.ais.push(new CAiBomber(b, aiMode));
    }
  }

  // ------- Bomb Spawning (FUN_00438550) -------

  public spawnBomb(bomber: CBomber) {
    if (!bomber.alive) return;
    if (bomber.bombsActive >= bomber.bombLimit) return;
    const tx = bomber.tileX;
    const ty = bomber.tileY;
    if (!this.arena.canPlaceBomb(tx, ty)) return;

    const slot = this.bombs.find((b) => !b.active);
    if (!slot) return;

    // Check if another player or bot is currently on or overlapping this tile
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

    // If placed on a tile where another player or bot is present, give a decent escape window (3.5s)
    const fuseTime = otherBomberPresent
      ? FUSE_SHARED_TILE
      : bomber.getFuseTime();

    slot.activate(tx, ty, bomber.getFlameSize(), fuseTime, bomber.idx);
    this.arena.setBomb(tx, ty, true);
    bomber.bombsActive++;

    // Grant passability to ALL combatants currently in or overlapping this tile
    // so no player or bot gets trapped inside the newly created bomb collider!
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

    sound.playBombDrop();
  }

  // ------- Explosion & Flame Rays (FUN_0043AA10 + FUN_00443080) -------

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

    // 4 directional rays
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
          this.emitDebris(nx, ny);
          break;
        }

        // Chain reaction: detonate other bombs
        const chainBomb = this.bombs.find(
          (b) => b.active && !b.exploded && b.tileX === nx && b.tileY === ny,
        );
        if (chainBomb) {
          chainBomb.forceDetonate();
        }

        cells.push({ x: nx, y: ny });
        this.arena.setFlame(nx, ny, true);
      }
    }

    // Allocate flame slot
    const flameSlot = this.flames.find((f) => !f.active);
    if (flameSlot) flameSlot.activate(cells, bomb.owner);

    sound.playExplosion();
    this.emitExplosion(bx, by);
  }

  // ------- Sudden Death Falling Perimeter Walls -------

  public triggerSuddenDeathWall() {
    this.isSuddenDeath = true;
    this.suddenDeathRing++;
    this.screenShake = 0.5;

    // Build the wall perimeter inward starting from corners
    const built = this.arena.buildSuddenDeathRing(this.suddenDeathRing);

    if (built.length > 0) {
      sound.playWallDrop();

      // Eliminate any player caught beneath or inside the falling corner/perimeter walls
      for (const pos of built) {
        this.emitDebris(pos.x, pos.y);

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

          if (caught) {
            b.die();
            this.emitDeath(b);
          }
        }

        // Also clean up any active bomb crushed by the wall
        for (const bomb of this.bombs) {
          if (bomb.active && bomb.tileX === pos.x && bomb.tileY === pos.y) {
            bomb.active = false;
            this.arena.setBomb(pos.x, pos.y, false);
          }
        }
      }
    }

    // Timer is increased by a minute (+60 seconds) for the next wall ring!
    this.matchTimer = 60;

    // Check match conclusion: No draws allowed. Either every human dies
    // (Defeat) or the bot squad is wiped out (Victory).
    if (this.aliveHumans().length === 0 || this.aliveBots().length === 0) {
      this.endMatch();
    }
  }

  // ------- Main Game Tick -------

  public update(dt: number) {
    if (this.phase !== "playing" || this.isPaused) return;

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt);
    }

    // Timer management:
    // If time expires, trigger Sudden Death falling wall and increase timer by 1 minute!
    if (!this.isUnlimitedTime) {
      this.matchTimer -= dt;
      if (this.matchTimer <= 0) {
        this.triggerSuddenDeathWall();
      }
    } else {
      // Unlimited mode counts elapsed time up
      this.matchTimer += dt;
    }

    // 1. Process bombs
    for (const bomb of this.bombs) {
      if (!bomb.active) continue;
      if (bomb.exploded) {
        this.explode(bomb);
      } else {
        const detonated = bomb.process(dt);
        if (detonated) this.explode(bomb);
      }
    }

    // 2. Process flames
    for (const flame of this.flames) {
      if (!flame.active) continue;
      const done = flame.process(dt);
      if (done) {
        for (const c of flame.cells) this.arena.setFlame(c.x, c.y, false);
        flame.cells = [];
      }
    }

    // 3. AI thinking
    for (const ai of this.ais) {
      ai.process(dt, this.arena, this.bombers, this.bombs, this.ais);
      if (ai.wantBomb) this.spawnBomb(ai.bomber);
    }

    // 4. Update bombers
    for (const b of this.bombers) {
      if (!b.alive) {
        b.deathTimer -= dt;
        continue;
      }
      b.update(dt, this.arena);
    }

    // Flame kill check: Strict overlay and proximity kill
    // If explosion overlays or touches ANY player or bot, they die!
    for (const flame of this.flames) {
      if (!flame.active) continue;

      for (const cell of flame.cells) {
        const cx = cell.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = cell.y * TILE_SIZE + TILE_SIZE / 2;
        const cellLeft = cell.x * TILE_SIZE;
        const cellRight = (cell.x + 1) * TILE_SIZE;
        const cellTop = cell.y * TILE_SIZE;
        const cellBottom = (cell.y + 1) * TILE_SIZE;

        for (const b of this.bombers) {
          if (!b.alive) continue;

          // Hitbox check: if character body touches or overlays active flame cell, eliminated!
          const pLeft = b.pixelX + 4; // Smaller hitbox threshold
          const pRight = b.pixelX + TILE_SIZE - 4;
          const pTop = b.pixelY + 4;
          const pBottom = b.pixelY + TILE_SIZE - 4;

          const aabbOverlap =
            pLeft < cellRight - 2 &&
            pRight > cellLeft + 2 &&
            pTop < cellBottom - 2 &&
            pBottom > cellTop + 2;
          const centerInCell = b.tileX === cell.x && b.tileY === cell.y;

          // ALWAYS kill on center-in-cell (full body inside flame)
          // Only use AABB overlap when character is partially in flame
          if (centerInCell || aabbOverlap) {
            b.die();
            this.emitDeath(b);
          }
        }
      }
    }

    // 5. Particles
    this.updateParticles(dt);

    // 6. Win / Defeat check: the match ends the moment one side is wiped out.
    if (this.aliveHumans().length === 0 || this.aliveBots().length === 0) {
      this.endMatch();
      return;
    }
  }

  private aliveHumans(): CBomber[] {
    return this.bombers.filter((b) => !b.isAi && b.alive);
  }

  private aliveBots(): CBomber[] {
    return this.bombers.filter((b) => b.isAi && b.alive);
  }

  private endMatch() {
    this.phase = "gameover";
    const survivors = this.aliveHumans();
    if (survivors.length > 0) {
      this.winner = survivors[0];
      this.winner.score++;
      sound.playVictory();
    } else {
      this.winner = null; // Every human eliminated (Defeat)
    }
  }

  // ------- Particles -------

  /**
   * Advance cosmetic particles only. Online matches use this because the server
   * owns the simulation while the renderer still replays blast and death effects.
   */
  public updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt; // gravity
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private emit(
    cx: number,
    cy: number,
    colors: string[],
    count: number,
    speed: number,
    life: number,
  ) {
    const px = cx * TILE_SIZE + TILE_SIZE / 2;
    const py = cy * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + speed * 0.3;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 4 + 2,
        life: Math.random() * life + life * 0.3,
        maxLife: life * 1.3,
      });
    }
  }

  /** Cosmetic blast replay for authoritative snapshots. */
  public emitExplosion(x: number, y: number) {
    this.emit(x, y, ["#FF4500", "#FF8C00", "#FFD700", "#FFF"], 18, 180, 0.4);
  }

  private emitDebris(x: number, y: number) {
    this.emit(x, y, ["#8B4513", "#A0522D", "#CD853F"], 12, 140, 0.5);
  }

  /** Cosmetic death replay for authoritative snapshots. */
  public emitDeath(b: CBomber) {
    const px = b.pixelX + TILE_SIZE / 2;
    const py = b.pixelY + TILE_SIZE / 2;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 150 + 50;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        color: b.color,
        size: Math.random() * 5 + 2,
        life: Math.random() * 0.7 + 0.3,
        maxLife: 1.0,
      });
    }
  }
}
