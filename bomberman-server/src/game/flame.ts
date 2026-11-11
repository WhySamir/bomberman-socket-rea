/**
 * Flame ray data — FUN_00443080 propagation
 */
import { FLAME_DURATION } from "./constants.js";

export interface FlameCell {
  x: number;
  y: number;
  owner?: number; // player index who placed the bomb that caused this flame
}

export class CFlame {
  public active = false;
  public cells: FlameCell[] = [];
  public timer = 0;
  public owner = -1; // player index (0 = Human, 1..4 = Bots)

  public activate(cells: FlameCell[], owner: number = -1) {
    this.cells = cells;
    this.owner = owner;
    this.timer = FLAME_DURATION;
    this.active = true;
  }

  /** Returns true when flame expires */
  public process(dt: number): boolean {
    if (!this.active) return false;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.active = false;
      return true;
    }
    return false;
  }

  /** 0..1 how much life left */
  public get lifeRatio(): number {
    return Math.max(0, this.timer / FLAME_DURATION);
  }
}
