/**
 * CBomb — Matches 0x7C byte layout from RE findings
 * FUN_0043A7E0 (activate), FUN_0043B450 (process), FUN_0043AA10 (explode)
 */
import { TILE_SIZE, FUSE_DEFAULT } from "./constants";

export class CBomb {
  public active = false;
  public tileX = 0;
  public tileY = 0;
  public power = 1; // flame size
  public fuse = FUSE_DEFAULT;
  public age = 0;
  public owner = -1; // player index
  public exploded = false;
  public animTimer = 0;

  public activate(
    tx: number,
    ty: number,
    power: number,
    fuse: number,
    ownerIdx: number,
  ) {
    this.tileX = tx;
    this.tileY = ty;
    this.power = Math.max(1, power);
    this.fuse = fuse > 0 ? fuse : FUSE_DEFAULT;
    this.owner = ownerIdx;
    this.age = 0;
    this.exploded = false;
    this.animTimer = 0;
    this.active = true;
  }

  /** Returns true when the bomb just detonated this tick */
  public process(dt: number): boolean {
    if (!this.active || this.exploded) return false;
    this.age += dt;
    this.fuse -= dt;
    this.animTimer += dt;
    if (this.fuse <= 0) {
      this.exploded = true;
      this.fuse = 0;
      return true;
    }
    return false;
  }

  /** Force-detonate (chain reaction) */
  public forceDetonate() {
    if (!this.active || this.exploded) return;
    this.fuse = 0;
    this.exploded = true;
  }

  public reset() {
    this.active = false;
    this.exploded = false;
  }

  /** Pulsing scale for render (0..2) */
  public get pulseScale(): number {
    return 1.0 + Math.sin(this.animTimer * 8) * 0.12;
  }
}
