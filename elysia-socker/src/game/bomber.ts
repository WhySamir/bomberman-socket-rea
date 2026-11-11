/**
 * CBomber — Player / Bot entity
 * Matches CBomber 0x54 layout from RE findings
 * FUN_0043CC00 (moveCommand), FUN_0043D900 (getFlameSize), FUN_0043D930 (getFuseTime)
 */
import {
  TILE_SIZE,
  Direction,
  DIR_NONE,
  DIR_DOWN,
  DIR_DELTAS,
  ActionArg,
  ACT_NONE,
  ItemType,
  MAX_FLAME_POWER,
} from "./constants.js";
import { Arena } from "./arena.js";

export class CBomber {
  public idx: number; // player index (0 = human, 1..4 = AI)
  public name: string;
  public color: string;
  public isAi: boolean;

  public get id(): number {
    return this.idx;
  }

  public tileX = 0;
  public tileY = 0;
  public pixelX = 0; // sub-tile smooth position
  public pixelY = 0;
  public facingDir: Direction = DIR_DOWN;
  public isMoving = false;

  public bombLimit = 1; // +0x70 (MaxBombs)
  public bombsActive = 0; // how many of this player's bombs are live
  public get bombsPlaced(): number {
    return this.bombsActive;
  }

  public power = 1; // +0x78 (FlameSize starts at 1)
  public speed = 160; // px/sec
  public hasKick = false;
  public alive = true;
  public score = 0;

  public walkFrame = 0;
  public walkTimer = 0;
  public deathTimer = 0;

  // Track standing-on-bomb(s) using AABB overlap (can walk freely until completely stepped off)
  public passableBombs: Set<string> = new Set();

  public get onBombKey(): string | null {
    const first = this.passableBombs.values().next();
    return first.done ? null : first.value;
  }
  public set onBombKey(val: string | null) {
    if (val) this.passableBombs.add(val);
    else this.passableBombs.clear();
  }

  constructor(idx: number, name: string, color: string, isAi: boolean) {
    this.idx = idx;
    this.name = name;
    this.color = color;
    this.isAi = isAi;
  }

  public spawn(tx: number, ty: number) {
    this.tileX = tx;
    this.tileY = ty;
    this.pixelX = tx * TILE_SIZE;
    this.pixelY = ty * TILE_SIZE;
    this.facingDir = DIR_DOWN;
    this.isMoving = false;
    this.bombLimit = 1;
    this.bombsActive = 0;
    this.power = 1;
    this.speed = 160;
    this.hasKick = false;
    this.alive = true;
    this.walkFrame = 0;
    this.walkTimer = 0;
    this.deathTimer = 0;
    this.passableBombs.clear();
  }

  /** FUN_0043D900 */
  public getFlameSize(): number {
    return this.power;
  }

  /** FUN_0043D930 */
  public getFuseTime(): number {
    return 2.0; // default fuse
  }

  public snapToTileCenter() {
    this.pixelX = this.tileX * TILE_SIZE;
    this.pixelY = this.tileY * TILE_SIZE;
    this.isMoving = false;
  }

  public moveCommand(dir: Direction, _action: ActionArg = ACT_NONE) {
    if (!this.alive) return;
    if (dir !== DIR_NONE) {
      this.facingDir = dir;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  public update(dt: number, arena: Arena) {
    if (!this.alive) {
      this.deathTimer -= dt;
      return;
    }

    const pad = TILE_SIZE * 0.18;
    const size = TILE_SIZE - pad * 2;
    const pLeft = this.pixelX + pad;
    const pRight = this.pixelX + pad + size;
    const pTop = this.pixelY + pad;
    const pBottom = this.pixelY + pad + size;

    // Check if player has completely stepped off any previously passable bomb tiles
    for (const key of this.passableBombs) {
      const [bxStr, byStr] = key.split(",");
      const bx = parseInt(bxStr, 10);
      const by = parseInt(byStr, 10);
      const bLeft = bx * TILE_SIZE;
      const bRight = (bx + 1) * TILE_SIZE;
      const bTop = by * TILE_SIZE;
      const bBottom = (by + 1) * TILE_SIZE;

      // Full AABB intersection check: only revoke passability once player box is 100% outside bomb tile
      const overlaps =
        pLeft < bRight && pRight > bLeft && pTop < bBottom && pBottom > bTop;
      if (!overlaps) {
        this.passableBombs.delete(key);
      }
    }

    if (this.isMoving && this.facingDir !== DIR_NONE) {
      this.walkTimer += dt;
      this.walkFrame = Math.floor(this.walkTimer * 8) % 4;

      const delta = DIR_DELTAS[this.facingDir];
      const dist = this.speed * dt;
      const nx = this.pixelX + delta.dx * dist;
      const ny = this.pixelY + delta.dy * dist;

      if (this.canMoveTo(nx, ny, arena)) {
        this.pixelX = nx;
        this.pixelY = ny;
      } else {
        // Corner sliding assist
        this.tryCornerSlide(delta, dist, arena);
      }
    } else {
      this.walkFrame = 0;
    }

    // Snap tile coords to player center
    this.tileX = Math.round(this.pixelX / TILE_SIZE);
    this.tileY = Math.round(this.pixelY / TILE_SIZE);

    // Pick up items
    const item = arena.takeItem(this.tileX, this.tileY);
    if (item !== null) {
      this.applyItem(item);
    }
  }

  private canMoveTo(px: number, py: number, arena: Arena): boolean {
    const pad = TILE_SIZE * 0.18;
    const size = TILE_SIZE - pad * 2;
    // Check 4 corners of hitbox
    const corners = [
      { x: px + pad, y: py + pad },
      { x: px + pad + size, y: py + pad },
      { x: px + pad, y: py + pad + size },
      { x: px + pad + size, y: py + pad + size },
    ];
    for (const c of corners) {
      const tx = Math.floor(c.x / TILE_SIZE);
      const ty = Math.floor(c.y / TILE_SIZE);
      const passBomb = this.passableBombs.has(`${tx},${ty}`);
      if (!arena.isWalkable(tx, ty, passBomb)) return false;
      // Never walk into an active flame tile — prevents bots (and the player)
      // from stepping into fire and dying "on their own".
      if (arena.hasFlame(tx, ty)) return false;
    }
    return true;
  }

  private tryCornerSlide(
    delta: { dx: number; dy: number },
    dist: number,
    arena: Arena,
  ) {
    // Math.round keeps the largest perpendicular offset at exactly half a tile,
    // so the slide must cover that full half-tile or the body stalls on a corner
    // (a stalled bot could not reach its refuge and died to its own bomb).
    const slideAmount = TILE_SIZE / 2;
    if (delta.dy !== 0) {
      // Moving vertically: align X toward tile corridor center
      const targetTx = Math.round(this.pixelX / TILE_SIZE);
      const diff = targetTx * TILE_SIZE - this.pixelX;
      if (Math.abs(diff) > 0.5 && Math.abs(diff) <= slideAmount) {
        const slideX = Math.sign(diff) * Math.min(Math.abs(diff), dist);
        // First try diagonal slide
        if (
          this.canMoveTo(
            this.pixelX + slideX,
            this.pixelY + delta.dy * dist,
            arena,
          )
        ) {
          this.pixelX += slideX;
          this.pixelY += delta.dy * dist;
        } else if (this.canMoveTo(this.pixelX + slideX, this.pixelY, arena)) {
          // Slide X alone to align with corridor
          this.pixelX += slideX;
        }
      }
    } else if (delta.dx !== 0) {
      // Moving horizontally: align Y toward tile corridor center
      const targetTy = Math.round(this.pixelY / TILE_SIZE);
      const diff = targetTy * TILE_SIZE - this.pixelY;
      if (Math.abs(diff) > 0.5 && Math.abs(diff) <= slideAmount) {
        const slideY = Math.sign(diff) * Math.min(Math.abs(diff), dist);
        // First try diagonal slide
        if (
          this.canMoveTo(
            this.pixelX + delta.dx * dist,
            this.pixelY + slideY,
            arena,
          )
        ) {
          this.pixelY += slideY;
          this.pixelX += delta.dx * dist;
        } else if (this.canMoveTo(this.pixelX, this.pixelY + slideY, arena)) {
          // Slide Y alone to align with corridor
          this.pixelY += slideY;
        }
      }
    }
  }

  public applyItem(item: ItemType) {
    switch (item) {
      case ItemType.Flame:
        this.power = Math.min(MAX_FLAME_POWER, this.power + 1);
        break;
      case ItemType.Speed:
        this.speed = Math.min(235, this.speed + 35);
        break;
    }
  }

  public die() {
    if (!this.alive) return;
    this.alive = false;
    this.deathTimer = 1.2;
    this.isMoving = false;
  }
}
