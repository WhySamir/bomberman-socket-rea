/**
 * CAiBomber — Tactical Squad AI
 *
 * Features:
 * 1. Smooth, continuous, purposeful movement without twitching, pacing, or jittering.
 * 2. Stable Early-Game Demolition:
 *    - In early game and dead ends, bots stay still and stable rather than oscillating back and forth.
 *    - When waiting for a bomb to explode or for a soft block to clear, bots hold their position calmly.
 * 3. Scans reachable tiles using BFS to:
 *    - Coordinate squad hunting of Human Player 1 from multiple angles/flanks.
 *    - Tactically tunnel through soft blocks toward Player 1.
 *    - Collect powerup items (Flame & Speed).
 * 4. Verified Safe Bombing & Deep Corner Refuge:
 *    - Never drops a bomb unless a 100% safe, shielded corner refuge is guaranteed reachable.
 *    - Immediately steps away along the escape route and turns into safe cover.
 *    - Snaps to the center of the refuge tile and stands completely still in cover until detonation.
 * 5. Squad Coordination:
 *    - Teammates do not drop conflicting bombs in the same sector.
 *    - Bots coordinate to surround and trap Player 1.
 */
import {
  ARENA_W,
  ARENA_H,
  TILE_FLOOR,
  TILE_SIZE,
  TILE_SOFT_BLOCK,
  Direction,
  DIR_NONE,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_DELTAS,
} from "./constants";
import { Arena } from "./arena";
import { CBomber } from "./bomber";
import { CBomb } from "./bomb";
import { AiMode } from "./levels";

const NEIGHBOR_DIRS: Array<{ dir: Direction; dx: number; dy: number }> = [
  { dir: DIR_UP, dx: 0, dy: -1 },
  { dir: DIR_DOWN, dx: 0, dy: 1 },
  { dir: DIR_LEFT, dx: -1, dy: 0 },
  { dir: DIR_RIGHT, dx: 1, dy: 0 },
];

const OPPOSITE_DIR: Record<Direction, Direction> = {
  [DIR_NONE]: DIR_NONE,
  [DIR_UP]: DIR_DOWN,
  [DIR_DOWN]: DIR_UP,
  [DIR_LEFT]: DIR_RIGHT,
  [DIR_RIGHT]: DIR_LEFT,
};

export class CAiBomber {
  public bomber: CBomber;
  public readonly mode: AiMode;
  public wantBomb = false;
  public targetTileX = 0;
  public targetTileY = 0;

  private thinkTimer = 0;
  private idleTimer = 0; // State stability: pauses in place rather than nervously pacing
  private distGrid: Int16Array = new Int16Array(ARENA_W * ARENA_H);
  private dangerGrid: Uint8Array = new Uint8Array(ARENA_W * ARENA_H);
  private pathGrid: Int16Array = new Int16Array(ARENA_W * ARENA_H);

  // Active refuge destination tile when retreating from a bomb
  private refugeTile: { x: number; y: number } | null = null;
  private lastDir: Direction = DIR_NONE;

  // Tile where a bomb was just rejected for lack of safe cover. Avoiding it for
  // a moment stops the bot from freezing or pacing on a spot it cannot bomb.
  private bombCooldown: { x: number; y: number; until: number } | null = null;
  private now = 0;

  // Human travel tracking for the Level Impossible interception roles
  private humanTravelDir: Direction = DIR_NONE;
  private lastHumanTile: { x: number; y: number } | null = null;
  private lastHumanMoveAt = -99;

  public get distanceGrid(): Int16Array {
    return this.distGrid;
  }

  constructor(bomber: CBomber, mode: AiMode = "classic") {
    this.bomber = bomber;
    this.mode = mode;
  }

  public isTileDangerous(x: number, y: number): boolean {
    return this.getDanger(x, y) > 0;
  }

  public getDanger(x: number, y: number): number {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return 3;
    return this.dangerGrid[y * ARENA_W + x];
  }

  public process(
    dt: number,
    arena: Arena,
    allBombers: CBomber[],
    allBombs: CBomb[],
    allAis: CAiBomber[] = [],
  ) {
    if (!this.bomber.alive) return;
    this.now += dt;
    this.wantBomb = false;

    const humanTracked = this.pickHumanTarget(allBombers);
    if (humanTracked) this.trackHuman(humanTracked);

    const mx = this.bomber.tileX;
    const my = this.bomber.tileY;

    // 1. Compute danger across all bombs & flames
    this.computeDanger(arena, allBombs);
    const currentDanger = this.getDanger(mx, my);

    // EMERGENCY EVASION: If currently in danger, CANCEL idle and flee immediately!
    if (currentDanger > 0) {
      this.idleTimer = 0;
      this.evade(mx, my, arena, allBombs);
      return;
    }

    // 2. IDLE / STABILITY TIMER:
    // If the bot reached its position and is waiting (e.g. for bomb fuse or block clear),
    // hold position stably without nervously pacing back and forth!
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.bomber.snapToTileCenter();
      this.bomber.moveCommand(DIR_NONE);
      return;
    }

    // 3. REFUGE COVER HANDLING:
    // If the bot has an active refuge destination from placing a bomb or dodging:
    if (this.refugeTile) {
      const atRefuge = mx === this.refugeTile.x && my === this.refugeTile.y;
      const threatExists =
        this.isThreatNearby(mx, my, allBombs, arena) ||
        this.bomber.bombsActive > 0;

      if (atRefuge) {
        // Center cleanly in refuge tile so no hitbox edges protrude into blast corridors
        const targetPx = this.refugeTile.x * TILE_SIZE;
        const targetPy = this.refugeTile.y * TILE_SIZE;
        const dx = targetPx - this.bomber.pixelX;
        const dy = targetPy - this.bomber.pixelY;

        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
          // Slide smoothly into exact tile center
          if (Math.abs(dx) > Math.abs(dy)) {
            this.executeMove(dx > 0 ? DIR_RIGHT : DIR_LEFT);
          } else {
            this.executeMove(dy > 0 ? DIR_DOWN : DIR_UP);
          }
          return;
        }

        // Snap to center and hold perfectly still
        this.bomber.snapToTileCenter();

        if (threatExists) {
          // Bombs or flames still active — HOLD CALMLY IN COVER!
          this.bomber.moveCommand(DIR_NONE);
          return;
        } else {
          // Threat is completely clear! Release refuge, pause briefly, and advance
          this.refugeTile = null;
          this.idleTimer = 0.2;
          this.bomber.moveCommand(DIR_NONE);
          // Reset the tactical target so a fresh objective is chosen after cover.
          this.targetTileX = mx;
          this.targetTileY = my;
          return;
        }
      } else {
        // Move towards refuge tile using escape pathfinder
        const dir = this.findPath(
          mx,
          my,
          this.refugeTile.x,
          this.refugeTile.y,
          arena,
          true,
        );
        if (dir !== DIR_NONE) {
          this.executeMove(dir);
          return;
        } else {
          this.evade(mx, my, arena, allBombs);
          return;
        }
      }
    }

    // Fast-tick AI throttle
    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 0.05 + Math.random() * 0.02;

    this.computeReachableBFS(mx, my, arena);

    // 4. TACTICAL HUNTING & TUNNELING TOWARD HUMAN PLAYER
    if (this.mode === "impossible") {
      this.tacticalStepImpossible(mx, my, arena, allBombers, allBombs, allAis);
    } else {
      this.tacticalStep(mx, my, arena, allBombers, allBombs);
    }
  }

  // ---------- Danger Grid Computation ----------

  private computeDanger(arena: Arena, bombs: CBomb[]) {
    this.dangerGrid.fill(0);

    // 1. All active flames = Level 3 (Lethal)
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        if (arena.hasFlame(x, y)) {
          this.dangerGrid[y * ARENA_W + x] = 3;
        }
      }
    }

    // 2. All active bombs and their blast rays = Level 1 or 2
    for (const b of bombs) {
      if (!b.active) continue;
      const level = b.fuse < 1.0 ? 2 : 1;
      this.markDanger(b.tileX, b.tileY, level);

      for (const nd of NEIGHBOR_DIRS) {
        for (let i = 1; i <= b.power; i++) {
          const nx = b.tileX + nd.dx * i;
          const ny = b.tileY + nd.dy * i;
          if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) break;

          const block = arena.isFlameBlocking(nx, ny);
          if (block === "hard") break;
          if (block === "soft") {
            this.markDanger(nx, ny, level);
            break;
          }
          this.markDanger(nx, ny, level);
        }
      }
    }
  }

  private markDanger(x: number, y: number, level: number) {
    if (x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H) {
      const idx = y * ARENA_W + x;
      if (level > this.dangerGrid[idx]) {
        this.dangerGrid[idx] = level;
      }
    }
  }

  private isThreatNearby(
    mx: number,
    my: number,
    bombs: CBomb[],
    arena: Arena,
  ): boolean {
    // Check ticking bombs within range 4
    for (const b of bombs) {
      if (!b.active) continue;
      if (Math.abs(b.tileX - mx) + Math.abs(b.tileY - my) <= 4) return true;
    }
    // Check flames within range 3
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = mx + dx;
        const ny = my + dy;
        if (arena.hasFlame(nx, ny)) return true;
      }
    }
    return false;
  }

  // ---------- Reachable BFS ----------

  private computeReachableBFS(sx: number, sy: number, arena: Arena) {
    this.distGrid.fill(-1);
    if (sx < 0 || sx >= ARENA_W || sy < 0 || sy >= ARENA_H) return;
    this.distGrid[sy * ARENA_W + sx] = 0;
    const q: number[] = [sx, sy];
    let head = 0;

    const standingOnOwnBomb = this.bomber.passableBombs.has(`${sx},${sy}`);

    while (head < q.length) {
      const cx = q[head++];
      const cy = q[head++];
      const cd = this.distGrid[cy * ARENA_W + cx];

      for (const nd of NEIGHBOR_DIRS) {
        const nx = cx + nd.dx;
        const ny = cy + nd.dy;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
        const idx = ny * ARENA_W + nx;
        if (this.distGrid[idx] !== -1) continue;

        const passBomb = standingOnOwnBomb && cx === sx && cy === sy;
        if (!arena.isWalkable(nx, ny, passBomb)) continue;

        this.distGrid[idx] = cd + 1;
        q.push(nx, ny);
      }
    }
  }

  private dist(x: number, y: number): number {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return -1;
    return this.distGrid[y * ARENA_W + x];
  }

  // ---------- Safe Refuge Finder (Behind Corners) ----------

  public findRefuge(
    fromX: number,
    fromY: number,
    arena: Arena,
    bombs: CBomb[],
    hypotheticalBomb?: { x: number; y: number; power: number },
  ): { refugeX: number; refugeY: number; firstDir: Direction } | null {
    const dangerTiles = new Set<string>();

    // 1. Flames
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        if (arena.hasFlame(x, y)) dangerTiles.add(`${x},${y}`);
      }
    }

    // 2. Active bombs
    for (const b of bombs) {
      if (!b.active) continue;
      dangerTiles.add(`${b.tileX},${b.tileY}`);
      for (const nd of NEIGHBOR_DIRS) {
        for (let i = 1; i <= b.power; i++) {
          const nx = b.tileX + nd.dx * i;
          const ny = b.tileY + nd.dy * i;
          if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) break;
          const block = arena.isFlameBlocking(nx, ny);
          if (block === "hard") break;
          if (block === "soft") {
            dangerTiles.add(`${nx},${ny}`);
            break;
          }
          dangerTiles.add(`${nx},${ny}`);
        }
      }
    }

    // 3. Hypothetical new bomb
    if (hypotheticalBomb) {
      const bx = hypotheticalBomb.x;
      const by = hypotheticalBomb.y;
      dangerTiles.add(`${bx},${by}`);
      for (const nd of NEIGHBOR_DIRS) {
        for (let i = 1; i <= hypotheticalBomb.power; i++) {
          const nx = bx + nd.dx * i;
          const ny = by + nd.dy * i;
          if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) break;
          const block = arena.isFlameBlocking(nx, ny);
          if (block === "hard") break;
          if (block === "soft") {
            dangerTiles.add(`${nx},${ny}`);
            break;
          }
          dangerTiles.add(`${nx},${ny}`);
        }
      }
    }

    // BFS search for closest safe refuge tile
    const visited = new Uint8Array(ARENA_W * ARENA_H);
    visited[fromY * ARENA_W + fromX] = 1;

    interface Node {
      x: number;
      y: number;
      dist: number;
      firstDir: Direction;
    }
    const q: Node[] = [];

    // Expand neighbors of (fromX, fromY)
    for (const nd of NEIGHBOR_DIRS) {
      const nx = fromX + nd.dx;
      const ny = fromY + nd.dy;
      if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
      if (arena.getTile(nx, ny) !== 0) continue;
      if (arena.hasBomb(nx, ny) || arena.hasFlame(nx, ny)) continue;

      visited[ny * ARENA_W + nx] = 1;

      if (!dangerTiles.has(`${nx},${ny}`)) {
        return { refugeX: nx, refugeY: ny, firstDir: nd.dir };
      }
      q.push({ x: nx, y: ny, dist: 1, firstDir: nd.dir });
    }

    let head = 0;
    while (head < q.length) {
      const cur = q[head++];

      if (!dangerTiles.has(`${cur.x},${cur.y}`)) {
        return { refugeX: cur.x, refugeY: cur.y, firstDir: cur.firstDir };
      }

      if (cur.dist >= 10) continue;

      for (const nd of NEIGHBOR_DIRS) {
        const nx = cur.x + nd.dx;
        const ny = cur.y + nd.dy;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
        const idx = ny * ARENA_W + nx;
        if (visited[idx] === 1) continue;
        if (arena.getTile(nx, ny) !== 0) continue;
        if (arena.hasBomb(nx, ny) || arena.hasFlame(nx, ny)) continue;

        visited[idx] = 1;
        q.push({ x: nx, y: ny, dist: cur.dist + 1, firstDir: cur.firstDir });
      }
    }

    return null;
  }

  // ---------- Comprehensive Blast Pattern Validation ----------

  // ---------- Bomb Placement Gate ----------

  /**
   * Returns the escape refuge when a bomb dropped at (x, y) can be left in time,
   * otherwise null. Every bomb placement goes through this single gate, so a bot
   * can neither blow itself up nor refuse a legal dig.
   *
   * The refuge must lie outside every blast (the new bomb, active bombs and
   * flames). Transit tiles may lie inside the new bomb's blast: they only ignite
   * at detonation, exactly like a human walking off a bomb they just placed.
   */
  private planBombEscape(
    x: number,
    y: number,
    arena: Arena,
    bombs: CBomb[],
  ): { refugeX: number; refugeY: number; firstDir: Direction } | null {
    if (this.isBombSpotSuppressed(x, y)) return null;
    if (this.bomber.bombsActive >= this.bomber.bombLimit) return null;
    if (!arena.canPlaceBomb(x, y)) return null;

    const refuge = this.findRefuge(x, y, arena, bombs, {
      x,
      y,
      power: this.bomber.getFlameSize(),
    });
    if (!refuge) return null;
    if (this.getDanger(refuge.refugeX, refuge.refugeY) > 0) return null;
    if (arena.hasFlame(refuge.refugeX, refuge.refugeY)) return null;
    if (!this.canReachRefuge(refuge.refugeX, refuge.refugeY)) return null;

    return refuge;
  }

  /** Can the refuge be reached before the fuse burns out? */
  private canReachRefuge(refugeX: number, refugeY: number): boolean {
    // distGrid holds walking distance from the bomb tile, which is the bot's
    // current tile while a bomb is being planned.
    const pathDist = this.dist(refugeX, refugeY);
    if (pathDist <= 0) return false;

    const tilesPerSec = Math.max(this.bomber.speed / TILE_SIZE, 0.1);
    const eta = (pathDist / tilesPerSec) * 1.25; // slack for turning/alignment
    return eta + 0.35 <= this.bomber.getFuseTime();
  }

  private suppressBombSpot(x: number, y: number) {
    this.bombCooldown = { x, y, until: this.now + 2.5 };
  }

  private isBombSpotSuppressed(x: number, y: number): boolean {
    const spot = this.bombCooldown;
    if (!spot) return false;
    if (this.now > spot.until) {
      this.bombCooldown = null;
      return false;
    }
    return spot.x === x && spot.y === y;
  }

  // ---------- Evade Threat ----------

  private evade(mx: number, my: number, arena: Arena, bombs: CBomb[]) {
    const refuge = this.findRefuge(mx, my, arena, bombs);
    if (refuge) {
      this.refugeTile = { x: refuge.refugeX, y: refuge.refugeY };
      this.targetTileX = refuge.refugeX;
      this.targetTileY = refuge.refugeY;
      this.executeMove(refuge.firstDir);
      return;
    }

    // Directional fallback step away from nearest bomb
    let bestDir: Direction = DIR_NONE;
    let maxDist = -1;
    const pass = this.bomber.passableBombs.has(`${mx},${my}`);

    for (const nd of NEIGHBOR_DIRS) {
      const nx = mx + nd.dx;
      const ny = my + nd.dy;
      if (!arena.isWalkable(nx, ny, pass) || arena.hasFlame(nx, ny)) continue;

      let minD = 999;
      for (const b of bombs) {
        if (!b.active) continue;
        const d = Math.abs(b.tileX - nx) + Math.abs(b.tileY - ny);
        if (d < minD) minD = d;
      }
      if (minD > maxDist) {
        maxDist = minD;
        bestDir = nd.dir;
      }
    }

    if (bestDir !== DIR_NONE) {
      this.executeMove(bestDir);
    } else {
      this.bomber.snapToTileCenter();
      this.bomber.moveCommand(DIR_NONE);
    }
  }

  // ---------- Tactical Squad Step (Hunting, Demolition, Tunneling) ----------

  private tacticalStep(
    mx: number,
    my: number,
    arena: Arena,
    allBombers: CBomber[],
    bombs: CBomb[],
  ) {
    const human = this.pickHumanTarget(allBombers);
    const hx = human ? human.tileX : 7;
    const hy = human ? human.tileY : 6;

    // --- STABILITY: keep pursuing an already-committed valid target --------------
    // Re-scoring every think tick can flip the bot between similarly-scored tiles,
    // causing jitter / direction flipping while en route. Once a safe, reachable
    // target is committed, keep moving toward it until it is reached or invalidated
    // (becomes dangerous or unreachable). Momentum is preserved and the bot still
    // reacts to new threats because the target is re-validated on every tick.
    const hasTarget = this.targetTileX !== mx || this.targetTileY !== my;
    const targetValid =
      hasTarget &&
      this.dist(this.targetTileX, this.targetTileY) >= 0 &&
      this.getDanger(this.targetTileX, this.targetTileY) === 0;

    if (targetValid) {
      // If we're right next to the human, bomb them instead of continuing
      // to the committed target. Bots hunt as a team to eliminate Player 1.
      const distToHuman = Math.abs(hx - mx) + Math.abs(hy - my);
      if (distToHuman <= 2) {
        const escape = this.planBombEscape(mx, my, arena, bombs);
        if (escape) {
          this.wantBomb = true;
          this.refugeTile = { x: escape.refugeX, y: escape.refugeY };
          this.targetTileX = escape.refugeX;
          this.targetTileY = escape.refugeY;
          this.executeMove(escape.firstDir);
          this.thinkTimer = 0.08;
          return;
        }
      }

      const dir = this.findPath(
        mx,
        my,
        this.targetTileX,
        this.targetTileY,
        arena,
        false,
      );
      if (dir !== DIR_NONE) {
        this.executeMove(dir);
      } else {
        // Path blocked by a combatant or pending hazard: stand still and
        // drop the committed target so the scoring loop picks a fresh objective.
        this.bomber.snapToTileCenter();
        this.bomber.moveCommand(DIR_NONE);
        this.targetTileX = mx;
        this.targetTileY = my;
      }
      return;
    }

    // 1. Scan ALL reachable floor tiles to find best tactical objective
    let bestTileScore = -99999;
    let bestX = mx;
    let bestY = my;

    for (let y = 1; y < ARENA_H - 1; y++) {
      for (let x = 1; x < ARENA_W - 1; x++) {
        const d = this.dist(x, y);
        if (d < 0) continue; // Unreachable
        if (this.getDanger(x, y) > 0) continue; // In danger zone

        let score = 0;

        // Proximity to human player
        const distToHuman = Math.abs(hx - x) + Math.abs(hy - y);

        // A. Is human player close/in range? (BOOST PRIORITY - SIGNIFICANTLY INCREASED)
        if (distToHuman <= 1) {
          score += 900; // Emergency priority: VERY close to kill directly (from 600→900)
        } else if (distToHuman <= 2) {
          score += 650; // Immediate kill range (from 450→650)
        } else if (distToHuman <= 4) {
          score += 450; // Short range, start aggressive pursuit (from 300→450)
        } else if (distToHuman <= 6) {
          score += 280; // Medium range, still gaining momentum (from 160→280)
        } else {
          score += 150; // Long range push toward human (no change from 160→150 but decays faster below)
        }

        // B. Demolition: soft blocks adjacent to this reachable floor tile
        // GOAL: BOT TUNNELS THROUGH WALLS TO GET CLOSER TO HUMAN
        let adjacentSoftBlocks = 0;
        let bombPlacementRisk = 0;
        let demolitionValue = 0; // Bonus for discovered soft blocks

        for (const nd of NEIGHBOR_DIRS) {
          const bx = x + nd.dx;
          const by = y + nd.dy;
          if (arena.getTile(bx, by) === 2) {
            adjacentSoftBlocks++;
            // BLOCK IS NEAR HUMAN: we must get closer to it
            const distFromBlock = Math.abs(hx - bx) + Math.abs(hy - by);
            demolitionValue += 30; // Every soft block near human is a target

            // BLOCK LEADS CLOSER TO HUMAN: HIGHEST PRIORITY TO TUNNEL
            if (distFromBlock < distToHuman) {
              demolitionValue += 80; // Block slashes path to player
            } else if (distFromBlock < distToHuman + 3) {
              // Even slightly closer: still valuable
              demolitionValue += 30;
            }

            // RISK PENALTY: Only bomb if RELATIVELY safe
            if (!arena.hasFlame(bx, by) && !arena.hasBomb(bx, by)) {
              bombPlacementRisk += 50; // Small risk tile
            } else {
              bombPlacementRisk += 120; // Already dangerous, high bomb cost
            }
          }
        }

        // TUNNELING BONUS: Each soft block near human gives +200 score
        // This is the key incentive for breaking walls to approach
        score += demolitionValue - bombPlacementRisk;

        // C. Powerup items on floor (WEIGHT - MODERATE PRIORITY)
        // Only prioritize powerups if we're not actively hunting the human
        if (arena.getItem(x, y) !== null) {
          // If human is close, collect powerups to prepare for fight
          if (distToHuman <= 4) {
            score += 140; // Weaker pickup priority when hunting human
          } else {
            score += 200; // Stronger pickup priority when in free roam
          }
        }

        // D. Distance cost - BALANCED APPROACH TO HUMAN
        score -= d * 1.2; // Reduced penalty for traveling toward human (from 1.5→1.2)
        // Heavily penalize moving AWAY from human
        const dx = hx - x;
        const dy = hy - y;
        if (dx * dx + dy * dy > distToHuman * distToHuman) {
          score -= 100; // Strong penalty for moving away from human hunt
        }

        // E. Squad role divergence (different bots approach from different angles)
        // STRONG BONUS for surrounding the human - bots actively flank from multiple directions
        const squadRole = this.bomber.idx % 3;
        if (squadRole === 1 && Math.abs(hx - x) > Math.abs(hy - y)) {
          score += 120; // Higher bonus for horizontal flanks (from 60→120)
        } else if (squadRole === 2 && Math.abs(hy - y) > Math.abs(hx - x)) {
          score += 120; // Higher bonus for vertical flanks (from 60→120)
        } else if (distToHuman <= 5) {
          // Even bots without special roles get bonus if they're closing in
          score += 80; // Progressive bonus for closing distance (from no bonus→80)
        }

        // F. Trap bonus - encourage positioning that cuts off human escape routes
        // Score higher for tiles that help surround/block the human from 6 tiles away
        if (distToHuman <= 6) {
          // Simply tracking recent human movement would help, but for now:
          // Bonus for being in position to help form a wall (simplified geometric bonus)
          score += 60; // Base trap bonus for closing range
        }

        // G. Direction momentum bonus (prevents jitter)
        if (this.lastDir !== DIR_NONE) {
          const delta = DIR_DELTAS[this.lastDir];
          if ((x - mx) * delta.dx > 0 || (y - my) * delta.dy > 0) {
            score += 40;
          }
        }

        // H. A spot where bombing just failed has no safe escape: avoid pacing there
        if (this.isBombSpotSuppressed(x, y)) score -= 5000;

        if (score > bestTileScore) {
          bestTileScore = score;
          bestX = x;
          bestY = y;
        }
      }
    }

    this.targetTileX = bestX;
    this.targetTileY = bestY;

    // 2. Are we already at our chosen best tile?
    if (mx === bestX && my === bestY) {
      // Check if we should place a bomb here (adjacent to soft block or human)
      let adjacentSoftBlock = false;
      for (const nd of NEIGHBOR_DIRS) {
        if (arena.getTile(mx + nd.dx, my + nd.dy) === 2) {
          adjacentSoftBlock = true;
        }
      }

      const distToHuman = Math.abs(hx - mx) + Math.abs(hy - my);
      // Bomb to tunnel through walls toward the human, or to catch a human
      // one or two tiles away.
      const shouldBomb = adjacentSoftBlock || distToHuman <= 2;

      if (shouldBomb) {
        const escape = this.planBombEscape(mx, my, arena, bombs);
        if (escape) {
          this.wantBomb = true;
          this.refugeTile = { x: escape.refugeX, y: escape.refugeY };
          this.targetTileX = escape.refugeX;
          this.targetTileY = escape.refugeY;
          this.executeMove(escape.firstDir);
          this.thinkTimer = 0.08;
          return;
        }

        // No guaranteed cover from this tile, or our own bomb is still live.
        // Never bomb without a safe escape; when cover is the problem, avoid the
        // spot briefly and reposition instead of freezing on it.
        if (
          this.bomber.bombsActive < this.bomber.bombLimit &&
          arena.canPlaceBomb(mx, my)
        ) {
          this.suppressBombSpot(mx, my);
        }
      }

      // If we cannot bomb right now (waiting for bomb to detonate or no refuge):
      // Keep hunting instead of idling forever at this tile. Move toward the
      // human player to maintain pressure; if already adjacent or the path is
      // blocked, step to any safe adjacent tile to keep looking for an opening.
      const dirToHuman = this.findPath(mx, my, hx, hy, arena, false);
      if (dirToHuman !== DIR_NONE) {
        this.executeMove(dirToHuman);
        return;
      }

      // Already at the human tile or path to human is blocked: step to a safe
      // adjacent tile so the bot keeps moving rather than freezing in place.
      for (const nd of NEIGHBOR_DIRS) {
        const nx = mx + nd.dx;
        const ny = my + nd.dy;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
        if (arena.getTile(nx, ny) !== TILE_FLOOR) continue;
        if (arena.hasBomb(nx, ny) || arena.hasFlame(nx, ny)) continue;
        if (this.getDanger(nx, ny) > 0) continue;
        this.executeMove(nd.dir);
        return;
      }

      // No safe move available: stand still calmly and wait for an opening.
      this.bomber.snapToTileCenter();
      this.bomber.moveCommand(DIR_NONE);
      this.idleTimer = 0.5;
      return;
    } else {
      // 3. Move along the shortest safe path toward the chosen tile
      const dir = this.findPath(mx, my, bestX, bestY, arena, false);
      if (dir !== DIR_NONE) {
        this.executeMove(dir);
      } else {
        // If path blocked by another combatant or pending hazard:
        // Stand still calmly and wait!
        this.bomber.snapToTileCenter();
        this.bomber.moveCommand(DIR_NONE);
        this.idleTimer = 0.4;
      }
    }
  }

  // ================= Level Impossible: predictive kill squad =================

  /** Nearest living human, so local duo matches are hunted too. */
  private pickHumanTarget(allBombers: CBomber[]): CBomber | null {
    let best: CBomber | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const b of allBombers) {
      if (b.isAi || !b.alive) continue;
      const d =
        Math.abs(b.tileX - this.bomber.tileX) +
        Math.abs(b.tileY - this.bomber.tileY);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  /** Remember which way the human is travelling so the squad can cut ahead. */
  private trackHuman(human: CBomber) {
    const prev = this.lastHumanTile;
    if (prev && (prev.x !== human.tileX || prev.y !== human.tileY)) {
      const dx = human.tileX - prev.x;
      const dy = human.tileY - prev.y;
      if (dx !== 0) this.humanTravelDir = dx > 0 ? DIR_RIGHT : DIR_LEFT;
      else if (dy !== 0) this.humanTravelDir = dy > 0 ? DIR_DOWN : DIR_UP;
      this.lastHumanMoveAt = this.now;
    }
    this.lastHumanTile = { x: human.tileX, y: human.tileY };
  }

  /** Squad order: 0 leads 2 tiles, 1 leads 4 tiles, 2 flanks from behind. */
  private get squadRole(): number {
    return (this.bomber.idx - 1) % 3;
  }

  private predictHumanTile(
    human: CBomber,
    ahead: number,
  ): { x: number; y: number } {
    const recentlyMoving = this.now - this.lastHumanMoveAt < 0.75;
    if (!recentlyMoving || this.humanTravelDir === DIR_NONE) {
      return { x: human.tileX, y: human.tileY };
    }
    const d = DIR_DELTAS[this.humanTravelDir];
    return {
      x: Math.max(0, Math.min(ARENA_W - 1, human.tileX + d.dx * ahead)),
      y: Math.max(0, Math.min(ARENA_H - 1, human.tileY + d.dy * ahead)),
    };
  }

  /**
   * Interception tile for this bot. Each role claims a different lane so the
   * squad closes from three sides instead of piling into one corridor.
   */
  private chooseInterceptTarget(
    allAis: CAiBomber[],
    human: CBomber,
  ): { x: number; y: number } {
    const role = this.squadRole;
    const lead = role === 0 ? 2 : role === 1 ? 4 : -2;

    const primary = this.predictHumanTile(human, lead);
    const primaryTile = this.nearestReachableTo(primary.x, primary.y);
    if (primaryTile && !this.isLaneClaimed(primaryTile, allAis, human))
      return primaryTile;

    const fallback = this.predictHumanTile(human, role === 2 ? 2 : -2);
    const fallbackTile = this.nearestReachableTo(fallback.x, fallback.y);
    if (fallbackTile && !this.isLaneClaimed(fallbackTile, allAis, human))
      return fallbackTile;

    const direct = this.nearestReachableTo(human.tileX, human.tileY);
    return direct ?? { x: this.bomber.tileX, y: this.bomber.tileY };
  }

  /** True when a teammate that is at least as close already covers this tile. */
  private isLaneClaimed(
    tile: { x: number; y: number },
    allAis: CAiBomber[],
    human: CBomber,
  ): boolean {
    const mine =
      Math.abs(tile.x - human.tileX) + Math.abs(tile.y - human.tileY);
    for (const ai of allAis) {
      if (ai === this || !ai.bomber.alive) continue;
      if (ai.targetTileX !== tile.x || ai.targetTileY !== tile.y) continue;
      const theirs =
        Math.abs(ai.targetTileX - human.tileX) +
        Math.abs(ai.targetTileY - human.tileY);
      if (theirs <= mine) return true;
    }
    return false;
  }

  /** Nearest reachable, danger-free tile to a prediction point. */
  private nearestReachableTo(
    tx: number,
    ty: number,
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let y = 1; y < ARENA_H - 1; y++) {
      for (let x = 1; x < ARENA_W - 1; x++) {
        const d = this.dist(x, y);
        if (d < 0) continue;
        if (this.getDanger(x, y) > 0) continue;
        const score = Math.abs(x - tx) + Math.abs(y - ty) + d * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private tacticalStepImpossible(
    mx: number,
    my: number,
    arena: Arena,
    allBombers: CBomber[],
    bombs: CBomb[],
    allAis: CAiBomber[],
  ) {
    const human = this.pickHumanTarget(allBombers);
    if (!human) return;

    // 1. Kill shot: any bomb whose blast already covers a human is worth placing.
    if (this.blastCovers(mx, my, human.tileX, human.tileY, arena)) {
      const plan = this.planImpossibleBomb(
        mx,
        my,
        arena,
        bombs,
        allBombers,
        human,
      );
      if (plan) {
        this.commitBombPlan(plan);
        return;
      }
    }

    // 2. Keep pursuing a committed interception tile while it is still valid.
    const committed = this.targetTileX !== mx || this.targetTileY !== my;
    if (
      committed &&
      this.dist(this.targetTileX, this.targetTileY) >= 0 &&
      this.getDanger(this.targetTileX, this.targetTileY) === 0
    ) {
      const dir = this.findPath(
        mx,
        my,
        this.targetTileX,
        this.targetTileY,
        arena,
        false,
      );
      if (dir !== DIR_NONE) {
        this.executeMove(dir);
        return;
      }
    }

    // 3. Fresh interception tile from this bot's squad role.
    const target = this.chooseInterceptTarget(allAis, human);
    this.targetTileX = target.x;
    this.targetTileY = target.y;

    if (mx === target.x && my === target.y) {
      // At the interception tile: blast the wall if it guards the human, else
      // close the last few tiles directly on the human.
      if (this.hasAdjacentSoftBlock(mx, my, arena)) {
        const plan = this.planImpossibleBomb(
          mx,
          my,
          arena,
          bombs,
          allBombers,
          human,
        );
        if (plan) {
          this.commitBombPlan(plan);
          return;
        }
        this.suppressBombSpot(mx, my);
      }

      const chase = this.findPath(
        mx,
        my,
        human.tileX,
        human.tileY,
        arena,
        false,
      );
      if (chase !== DIR_NONE) {
        this.executeMove(chase);
        return;
      }
      this.holdStill(0.4);
      return;
    }

    const dir = this.findPath(mx, my, target.x, target.y, arena, false);
    if (dir !== DIR_NONE) {
      this.executeMove(dir);
      return;
    }

    // 4. No walking route: tunnel toward the interception tile through bricks.
    const dig = this.findDigTile(mx, my, target.x, target.y, arena);
    if (!dig) {
      this.holdStill(0.35);
      return;
    }
    if (dig.x !== mx || dig.y !== my) {
      const digDir = this.findPath(mx, my, dig.x, dig.y, arena, false);
      if (digDir !== DIR_NONE) {
        this.executeMove(digDir);
        return;
      }
    }
    const plan = this.planImpossibleBomb(
      mx,
      my,
      arena,
      bombs,
      allBombers,
      human,
    );
    if (plan) {
      this.commitBombPlan(plan);
      return;
    }
    this.suppressBombSpot(mx, my);
    this.holdStill(0.35);
  }

  /**
   * Bomb gate for Level Impossible. A refuge is still preferred; the only
   * exception is a trade: the blast already covers the human and the human has
   * nowhere to step out of it. Pointless self-kills stay forbidden.
   */
  private planImpossibleBomb(
    x: number,
    y: number,
    arena: Arena,
    bombs: CBomb[],
    allBombers: CBomber[],
    human: CBomber,
  ): {
    refugeX: number;
    refugeY: number;
    firstDir: Direction;
    sacrifice: boolean;
  } | null {
    if (this.isBombSpotSuppressed(x, y)) return null;
    if (this.bomber.bombsActive >= this.bomber.bombLimit) return null;
    if (!arena.canPlaceBomb(x, y)) return null;

    const blast = this.blastTileSet(x, y, arena);

    // The squad trades bots for the human, never for each other.
    for (const mate of allBombers) {
      if (!mate.alive || !mate.isAi || mate.idx === this.bomber.idx) continue;
      if (blast.has(`${mate.tileX},${mate.tileY}`)) return null;
    }

    const refuge = this.findRefuge(x, y, arena, bombs, {
      x,
      y,
      power: this.bomber.getFlameSize(),
    });
    if (
      refuge &&
      this.getDanger(refuge.refugeX, refuge.refugeY) === 0 &&
      !arena.hasFlame(refuge.refugeX, refuge.refugeY) &&
      this.canReachRefuge(refuge.refugeX, refuge.refugeY)
    ) {
      return {
        refugeX: refuge.refugeX,
        refugeY: refuge.refugeY,
        firstDir: refuge.firstDir,
        sacrifice: false,
      };
    }

    if (
      blast.has(`${human.tileX},${human.tileY}`) &&
      this.isHumanTrapped(human, blast, arena)
    ) {
      return { refugeX: x, refugeY: y, firstDir: DIR_NONE, sacrifice: true };
    }
    return null;
  }

  private commitBombPlan(plan: {
    refugeX: number;
    refugeY: number;
    firstDir: Direction;
    sacrifice: boolean;
  }) {
    this.wantBomb = true;
    if (plan.sacrifice) {
      // Stand on the bomb: the mission is the kill, survival is optional here.
      this.bomber.snapToTileCenter();
      this.bomber.moveCommand(DIR_NONE);
    } else {
      this.refugeTile = { x: plan.refugeX, y: plan.refugeY };
      this.targetTileX = plan.refugeX;
      this.targetTileY = plan.refugeY;
      this.executeMove(plan.firstDir);
    }
    this.thinkTimer = 0.08;
  }

  private holdStill(seconds: number) {
    this.bomber.snapToTileCenter();
    this.bomber.moveCommand(DIR_NONE);
    this.idleTimer = seconds;
  }

  private hasAdjacentSoftBlock(mx: number, my: number, arena: Arena): boolean {
    return NEIGHBOR_DIRS.some(
      (nd) => arena.getTile(mx + nd.dx, my + nd.dy) === TILE_SOFT_BLOCK,
    );
  }

  /** Nearest reachable tile next to a destructible block, closest to the target. */
  private findDigTile(
    mx: number,
    my: number,
    tx: number,
    ty: number,
    arena: Arena,
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let y = 1; y < ARENA_H - 1; y++) {
      for (let x = 1; x < ARENA_W - 1; x++) {
        const d = this.dist(x, y);
        if (d < 0) continue;
        if (this.getDanger(x, y) > 0) continue;
        if (!this.hasAdjacentSoftBlock(x, y, arena)) continue;
        const score = Math.abs(x - tx) + Math.abs(y - ty) + d * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /** Does a bomb at (x, y) put flame on the target tile? */
  private blastCovers(
    x: number,
    y: number,
    tx: number,
    ty: number,
    arena: Arena,
  ): boolean {
    return this.blastTileSet(x, y, arena).has(`${tx},${ty}`);
  }

  /** Every tile covered by a bomb at (x, y), stopping at the first blocker. */
  private blastTileSet(x: number, y: number, arena: Arena): Set<string> {
    const cells = new Set<string>([`${x},${y}`]);
    for (const nd of NEIGHBOR_DIRS) {
      for (let i = 1; i <= this.bomber.getFlameSize(); i++) {
        const nx = x + nd.dx * i;
        const ny = y + nd.dy * i;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) break;
        cells.add(`${nx},${ny}`);
        if (arena.isFlameBlocking(nx, ny) !== "none") break;
      }
    }
    return cells;
  }

  /** Can the human step out of the new bomb's blast? */
  private isHumanTrapped(
    human: CBomber,
    blast: Set<string>,
    arena: Arena,
  ): boolean {
    let escapes = 0;
    for (const nd of NEIGHBOR_DIRS) {
      const nx = human.tileX + nd.dx;
      const ny = human.tileY + nd.dy;
      const key = `${nx},${ny}`;
      if (!arena.isWalkable(nx, ny, human.passableBombs.has(key))) continue;
      if (arena.hasFlame(nx, ny)) continue;
      if (blast.has(key)) continue;
      escapes++;
    }
    return escapes <= 1;
  }

  // ---------- Pathfinding Helper ----------

  private findPath(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    arena: Arena,
    allowEscapeThroughBomb: boolean,
  ): Direction {
    if (fromX === toX && fromY === toY) return DIR_NONE;

    this.pathGrid.fill(-1);
    this.pathGrid[toY * ARENA_W + toX] = 0;
    const q: number[] = [toX, toY];
    let head = 0;

    const pass = this.bomber.passableBombs.has(`${fromX},${fromY}`);

    while (head < q.length) {
      const cx = q[head++];
      const cy = q[head++];
      const cd = this.pathGrid[cy * ARENA_W + cx];

      if (cx === fromX && cy === fromY) break;

      for (const nd of NEIGHBOR_DIRS) {
        const nx = cx + nd.dx;
        const ny = cy + nd.dy;
        if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
        const idx = ny * ARENA_W + nx;
        if (this.pathGrid[idx] !== -1) continue;

        const canStep =
          (nx === fromX && ny === fromY) || arena.isWalkable(nx, ny, pass);
        if (!canStep) continue;

        // Lethal flames always avoided
        if (arena.hasFlame(nx, ny)) continue;

        // If not in escape mode, also avoid pending bomb danger
        if (!allowEscapeThroughBomb && this.getDanger(nx, ny) > 0) continue;

        this.pathGrid[idx] = cd + 1;
        q.push(nx, ny);
      }
    }

    let bestDir: Direction = DIR_NONE;
    let minD = 9999;

    for (const nd of NEIGHBOR_DIRS) {
      const nx = fromX + nd.dx;
      const ny = fromY + nd.dy;
      if (nx < 0 || nx >= ARENA_W || ny < 0 || ny >= ARENA_H) continue;
      if (!arena.isWalkable(nx, ny, pass)) continue;
      if (arena.hasFlame(nx, ny)) continue;
      if (!allowEscapeThroughBomb && this.getDanger(nx, ny) > 0) continue;

      const d = this.pathGrid[ny * ARENA_W + nx];
      if (d >= 0) {
        // Bias toward forward momentum to prevent jitter
        let effectiveD = d;
        if (nd.dir === this.lastDir) effectiveD -= 0.5;
        // Penalize 180-degree turnaround
        if (
          this.lastDir !== DIR_NONE &&
          nd.dir === OPPOSITE_DIR[this.lastDir]
        ) {
          effectiveD += 0.8;
        }

        if (effectiveD < minD) {
          minD = effectiveD;
          bestDir = nd.dir;
        }
      }
    }

    return bestDir;
  }

  private executeMove(dir: Direction) {
    this.lastDir = dir;
    this.bomber.moveCommand(dir);
  }
}
