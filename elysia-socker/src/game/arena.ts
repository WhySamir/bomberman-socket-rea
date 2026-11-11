/**
 * Arena Grid Management & Level Generation
 * Reverse-engineered from FUN_004268A0 (level format)
 */
import {
  ARENA_W,
  ARENA_H,
  TILE_FLOOR,
  TILE_HARD_WALL,
  TILE_SOFT_BLOCK,
  ItemType,
  SPAWN_POSITIONS,
  TOTAL_MATCH_FLAME_ITEMS,
  TOTAL_MATCH_SPEED_ITEMS,
} from "./constants.js";

export class Arena {
  /** Tile type grid: 0=floor, 1=hard wall, 2=soft block */
  public tiles: number[][] = [];
  /** Bomb presence grid */
  public bombs: boolean[][] = [];
  /** Flame presence grid */
  public flames: boolean[][] = [];
  /** Items currently lying on the ground */
  public items: Map<string, ItemType> = new Map();
  /** Exactly 4 hidden items in soft blocks per match (2 Flame, 2 Speed) */
  public hiddenItems: Map<string, ItemType> = new Map();

  constructor() {
    this.reset();
  }

  public reset() {
    this.tiles = [];
    this.bombs = [];
    this.flames = [];
    this.items.clear();
    this.hiddenItems.clear();

    for (let y = 0; y < ARENA_H; y++) {
      this.tiles[y] = [];
      this.bombs[y] = [];
      this.flames[y] = [];
      for (let x = 0; x < ARENA_W; x++) {
        this.tiles[y][x] = TILE_FLOOR;
        this.bombs[y][x] = false;
        this.flames[y][x] = false;
      }
    }

    this.generateClassicLevel();
  }

  public getTile(x: number, y: number): number {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return TILE_HARD_WALL;
    return this.tiles[y][x];
  }

  public setTile(x: number, y: number, val: number) {
    if (x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H) {
      this.tiles[y][x] = val;
    }
  }

  public hasBomb(x: number, y: number): boolean {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return false;
    return this.bombs[y][x];
  }

  public setBomb(x: number, y: number, val: boolean) {
    if (x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H) {
      this.bombs[y][x] = val;
    }
  }

  public hasFlame(x: number, y: number): boolean {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return false;
    return this.flames[y][x];
  }

  public setFlame(x: number, y: number, val: boolean) {
    if (x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H) {
      this.flames[y][x] = val;
    }
  }

  /** Can a player walk onto this tile? */
  public isWalkable(
    x: number,
    y: number,
    canPassBomb: boolean = false,
  ): boolean {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return false;
    const tile = this.tiles[y][x];
    if (tile === TILE_HARD_WALL || tile === TILE_SOFT_BLOCK) return false;
    if (this.bombs[y][x] && !canPassBomb) return false;
    return true;
  }

  /** Can a bomb be placed here? */
  public canPlaceBomb(x: number, y: number): boolean {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return false;
    if (this.tiles[y][x] !== TILE_FLOOR) return false;
    if (this.bombs[y][x]) return false;
    return true;
  }

  /** Does flame stop here? Stops on hard wall. Destroys soft block (stops after). */
  public isFlameBlocking(x: number, y: number): "none" | "hard" | "soft" {
    if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return "hard";
    const tile = this.tiles[y][x];
    if (tile === TILE_HARD_WALL) return "hard";
    if (tile === TILE_SOFT_BLOCK) return "soft";
    return "none";
  }

  /** Destroy a soft block, dropping any assigned hidden powerup */
  public destroySoftBlock(x: number, y: number): ItemType | null {
    if (this.getTile(x, y) !== TILE_SOFT_BLOCK) return null;
    this.setTile(x, y, TILE_FLOOR);

    const key = `${x},${y}`;
    const item = this.hiddenItems.get(key) ?? null;
    if (item !== null) {
      this.hiddenItems.delete(key);
      this.items.set(key, item);
      return item;
    }
    return null;
  }

  public getItem(x: number, y: number): ItemType | null {
    return this.items.get(`${x},${y}`) ?? null;
  }

  public takeItem(x: number, y: number): ItemType | null {
    const key = `${x},${y}`;
    const item = this.items.get(key);
    if (item !== undefined) {
      this.items.delete(key);
      return item;
    }
    return null;
  }

  /**
   * Builds a Sudden Death wall layer inward from the perimeter.
   * Ring 1: x in [1, 13], y in [1, 11]
   * Ring 2: x in [2, 12], y in [2, 10]
   * Returns list of coordinates converted to hard walls.
   */
  public buildSuddenDeathRing(
    ringIndex: number,
  ): Array<{ x: number; y: number }> {
    const minX = ringIndex;
    const maxX = ARENA_W - 1 - ringIndex;
    const minY = ringIndex;
    const maxY = ARENA_H - 1 - ringIndex;

    if (minX > maxX || minY > maxY) return [];

    const builtTiles: Array<{ x: number; y: number }> = [];

    // Top and bottom horizontal rows of the ring
    for (let x = minX; x <= maxX; x++) {
      builtTiles.push({ x, y: minY });
      if (minY !== maxY) {
        builtTiles.push({ x, y: maxY });
      }
    }

    // Left and right vertical columns of the ring (excluding corners already added)
    for (let y = minY + 1; y < maxY; y++) {
      builtTiles.push({ x: minX, y });
      if (minX !== maxX) {
        builtTiles.push({ x: maxX, y });
      }
    }

    // Apply hard walls
    for (const pos of builtTiles) {
      this.setTile(pos.x, pos.y, TILE_HARD_WALL);
      this.setBomb(pos.x, pos.y, false);
      this.setFlame(pos.x, pos.y, false);
      this.items.delete(`${pos.x},${pos.y}`);
      this.hiddenItems.delete(`${pos.x},${pos.y}`);
    }

    return builtTiles;
  }

  /** Classic 15x13 Bomberman arena with exactly 4 power items in total */
  private generateClassicLevel() {
    // 1. Border walls
    for (let x = 0; x < ARENA_W; x++) {
      this.setTile(x, 0, TILE_HARD_WALL);
      this.setTile(x, ARENA_H - 1, TILE_HARD_WALL);
    }
    for (let y = 0; y < ARENA_H; y++) {
      this.setTile(0, y, TILE_HARD_WALL);
      this.setTile(ARENA_W - 1, y, TILE_HARD_WALL);
    }

    // 2. Interior pillars on even coordinates
    for (let x = 2; x < ARENA_W - 1; x += 2) {
      for (let y = 2; y < ARENA_H - 1; y += 2) {
        this.setTile(x, y, TILE_HARD_WALL);
      }
    }

    // 3. Reserved spawn clearings (ensure players have room to navigate)
    const clearTiles = new Set<string>();
    for (const sp of SPAWN_POSITIONS) {
      clearTiles.add(`${sp.x},${sp.y}`);
      clearTiles.add(`${sp.x + 1},${sp.y}`);
      clearTiles.add(`${sp.x - 1},${sp.y}`);
      clearTiles.add(`${sp.x},${sp.y + 1}`);
      clearTiles.add(`${sp.x},${sp.y - 1}`);
    }

    // 4. Fill arena with destructible soft blocks (~60%)
    const softBlockLocations: Array<{ x: number; y: number }> = [];

    for (let y = 1; y < ARENA_H - 1; y++) {
      for (let x = 1; x < ARENA_W - 1; x++) {
        if (this.getTile(x, y) !== TILE_FLOOR) continue;
        if (clearTiles.has(`${x},${y}`)) continue;
        if (Math.random() < 0.6) {
          this.setTile(x, y, TILE_SOFT_BLOCK);
          softBlockLocations.push({ x, y });
        }
      }
    }

    // 5. Hide EXACTLY 4 powerups in total for the match: 2 Flame and 2 Speed
    // Shuffle soft block locations to distribute fairly across the arena
    for (let i = softBlockLocations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [softBlockLocations[i], softBlockLocations[j]] = [
        softBlockLocations[j],
        softBlockLocations[i],
      ];
    }

    let assigned = 0;
    // 2 Flame items
    for (
      let i = 0;
      i < TOTAL_MATCH_FLAME_ITEMS && assigned < softBlockLocations.length;
      i++
    ) {
      const loc = softBlockLocations[assigned++];
      this.hiddenItems.set(`${loc.x},${loc.y}`, ItemType.Flame);
    }
    // 2 Speed items
    for (
      let i = 0;
      i < TOTAL_MATCH_SPEED_ITEMS && assigned < softBlockLocations.length;
      i++
    ) {
      const loc = softBlockLocations[assigned++];
      this.hiddenItems.set(`${loc.x},${loc.y}`, ItemType.Speed);
    }
  }
}
