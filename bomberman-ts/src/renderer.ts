/**
 * Retro-Arcade Canvas Renderer
 * High-performance 60fps rendering with pixel art aesthetic, glowing flames, and animations
 */
import {
  ARENA_W,
  ARENA_H,
  TILE_SIZE,
  TILE_HARD_WALL,
  TILE_SOFT_BLOCK,
  ItemType,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
} from "./constants";
import { GameEngine } from "./game";
import { CBomber } from "./bomber";

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public showDebug: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = ARENA_W * TILE_SIZE;
    this.canvas.height = ARENA_H * TILE_SIZE;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get 2D canvas context");
    this.ctx = ctx;
  }

  public render(game: GameEngine) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    if (game.screenShake > 0) {
      const intensity = game.screenShake / 0.5;
      const shakeX = (Math.random() - 0.5) * 12 * intensity;
      const shakeY = (Math.random() - 0.5) * 12 * intensity;
      ctx.save();
      ctx.translate(shakeX, shakeY);
    }

    // 1. Draw Arena Floor & Grid
    this.drawFloor(ctx);

    // 2. Draw Walls & Destructible Blocks
    this.drawBlocks(ctx, game);

    // 3. Draw Powerup Items
    this.drawItems(ctx, game);

    // 4. Draw Bombs
    this.drawBombs(ctx, game);

    // 5. Draw Flames
    this.drawFlames(ctx, game);

    // 6. Draw Bombers (sorted by Y for correct isometric depth overlap)
    const sortedBombers = [...game.bombers].sort((a, b) => a.pixelY - b.pixelY);
    for (const bomber of sortedBombers) {
      this.drawBomber(ctx, bomber);
    }

    // 7. Draw Particles
    this.drawParticles(ctx, game);

    // 8. Sudden Death overlay border if active
    if (game.isSuddenDeath) {
      this.drawSuddenDeathBorder(ctx);
    }

    // 9. Debug Overlay (if enabled)
    if (this.showDebug) {
      this.drawDebugOverlay(ctx, game);
    }

    if (game.screenShake > 0) {
      ctx.restore();
    }
  }

  private drawFloor(ctx: CanvasRenderingContext2D) {
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        const isEven = (x + y) % 2 === 0;
        ctx.fillStyle = isEven ? "#121826" : "#0e1320";
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Grid lines
        ctx.strokeStyle = "#182133";
        ctx.lineWidth = 1;
        ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private drawBlocks(ctx: CanvasRenderingContext2D, game: GameEngine) {
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        const tile = game.arena.getTile(x, y);
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (tile === TILE_HARD_WALL) {
          // Indestructible stone pillar with 3D beveled relief
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

          // Top highlight
          ctx.fillStyle = "#334155";
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 6);

          // Center face
          ctx.fillStyle = "#243247";
          ctx.fillRect(px + 4, py + 8, TILE_SIZE - 8, TILE_SIZE - 12);

          // Dark edge bevel
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(px + 2, py + TILE_SIZE - 4, TILE_SIZE - 4, 2);
          ctx.fillRect(px + TILE_SIZE - 4, py + 2, 2, TILE_SIZE - 4);
        } else if (tile === TILE_SOFT_BLOCK) {
          // Destructible brick block
          ctx.fillStyle = "#78350f";
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

          // Brick pattern
          ctx.fillStyle = "#92400e";
          ctx.fillRect(px + 3, py + 4, TILE_SIZE - 6, 8);
          ctx.fillRect(px + 3, py + 16, (TILE_SIZE - 8) / 2, 8);
          ctx.fillRect(px + TILE_SIZE / 2 + 1, py + 16, (TILE_SIZE - 8) / 2, 8);
          ctx.fillRect(px + 3, py + 28, TILE_SIZE - 6, 8);

          // Mortar groove lines
          ctx.strokeStyle = "#451a03";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
      }
    }
  }

  private drawItems(ctx: CanvasRenderingContext2D, game: GameEngine) {
    const time = performance.now() / 300;
    const bob = Math.sin(time) * 3;

    game.arena.items.forEach((itemType, key) => {
      const [xStr, yStr] = key.split(",");
      const tx = parseInt(xStr, 10);
      const ty = parseInt(yStr, 10);
      const px = tx * TILE_SIZE + TILE_SIZE / 2;
      const py = ty * TILE_SIZE + TILE_SIZE / 2 + bob;

      // Glow behind item
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 215, 0, 0.25)";
      ctx.fill();

      // Item badge
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#FCD34D";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icon details: Exactly 2 types of powerups exist (Flame and Speed)
      if (itemType === ItemType.Flame) {
        ctx.fillStyle = "#EF4444";
        ctx.beginPath();
        ctx.moveTo(px, py - 7);
        ctx.quadraticCurveTo(px + 6, py - 2, px + 5, py + 5);
        ctx.quadraticCurveTo(px, py + 8, px - 5, py + 5);
        ctx.quadraticCurveTo(px - 6, py - 2, px, py - 7);
        ctx.fill();
        ctx.fillStyle = "#FBBF24";
        ctx.beginPath();
        ctx.arc(px, py + 3, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (itemType === ItemType.Speed) {
        ctx.fillStyle = "#10B981";
        ctx.fillRect(px - 6, py - 3, 12, 6);
        ctx.fillStyle = "#FFF";
        ctx.beginPath();
        ctx.arc(px - 3, py + 4, 3, 0, Math.PI * 2);
        ctx.arc(px + 3, py + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  private drawBombs(ctx: CanvasRenderingContext2D, game: GameEngine) {
    const time = performance.now() / 150;
    for (const bomb of game.bombs) {
      if (!bomb.active) continue;

      const px = bomb.tileX * TILE_SIZE + TILE_SIZE / 2;
      const py = bomb.tileY * TILE_SIZE + TILE_SIZE / 2 + 2;

      // Pulse scaling
      const pulse = Math.sin(time * 3) * 0.08;
      const radius = 14 * (1 + pulse);

      // Drop shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.ellipse(px, py + 14, radius * 0.9, radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bomb Body Gradient
      const grad = ctx.createRadialGradient(px - 4, py - 4, 2, px, py, radius);
      grad.addColorStop(0, "#475569");
      grad.addColorStop(0.5, "#1e293b");
      grad.addColorStop(1, "#020617");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();

      // Top cap & wick
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(px - 3, py - radius - 2, 6, 3);

      // Sparkling burning wick
      const sparkColor = Math.sin(time * 6) > 0 ? "#FBBF24" : "#EF4444";
      ctx.fillStyle = sparkColor;
      ctx.beginPath();
      ctx.arc(px, py - radius - 4, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Spark glow
      ctx.fillStyle = "rgba(251, 191, 36, 0.4)";
      ctx.beginPath();
      ctx.arc(px, py - radius - 4, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFlames(ctx: CanvasRenderingContext2D, game: GameEngine) {
    for (const flame of game.flames) {
      if (!flame.active) continue;

      for (const cell of flame.cells) {
        const px = cell.x * TILE_SIZE;
        const py = cell.y * TILE_SIZE;
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;

        ctx.save();
        // Fire burst
        this.drawFireCircle(ctx, cx, cy, TILE_SIZE * 0.46);
        ctx.restore();
      }
    }
  }

  private drawFireCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ) {
    // Outer flame glow
    ctx.fillStyle = "#EF4444";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Middle orange fire
    ctx.fillStyle = "#F59E0B";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();

    // Hot yellow core
    ctx.fillStyle = "#FEF08A";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // Bright white center spark
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBomber(ctx: CanvasRenderingContext2D, bomber: CBomber) {
    const px = bomber.pixelX + 6;
    const py = bomber.pixelY + 4;

    ctx.save();

    if (!bomber.alive) {
      // Death ghost fade animation
      ctx.globalAlpha = Math.max(0, bomber.deathTimer);
    }

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(px + 18, py + 36, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bobbing offset for walking frame
    const bobY = bomber.isMoving ? (bomber.walkFrame % 2 === 0 ? -2 : 0) : 0;

    // Body / Suit
    ctx.fillStyle = bomber.color;
    ctx.fillRect(px + 8, py + 16 + bobY, 20, 16);

    // Head / White Helmet
    ctx.fillStyle = "#F9FAFB";
    ctx.beginPath();
    ctx.arc(px + 18, py + 12 + bobY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#D1D5DB";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Antenna ball on helmet
    ctx.fillStyle = bomber.color;
    ctx.beginPath();
    ctx.arc(px + 18, py - 4 + bobY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Faceplate Visor
    ctx.fillStyle = "#FFE4E6";
    ctx.fillRect(px + 10, py + 8 + bobY, 16, 9);

    // Eyes (based on facing direction)
    ctx.fillStyle = "#111827";
    if (bomber.facingDir === DIR_DOWN) {
      ctx.fillRect(px + 13, py + 10 + bobY, 2.5, 5);
      ctx.fillRect(px + 20, py + 10 + bobY, 2.5, 5);
    } else if (bomber.facingDir === DIR_LEFT) {
      ctx.fillRect(px + 11, py + 10 + bobY, 2.5, 5);
    } else if (bomber.facingDir === DIR_RIGHT) {
      ctx.fillRect(px + 22, py + 10 + bobY, 2.5, 5);
    } else {
      // Facing UP: back of helmet
    }

    // Belt
    ctx.fillStyle = "#111827";
    ctx.fillRect(px + 8, py + 26 + bobY, 20, 3);
    ctx.fillStyle = "#FCD34D";
    ctx.fillRect(px + 15, py + 26 + bobY, 6, 3);

    // Boots
    ctx.fillStyle = "#991B1B";
    const footOffset = bomber.isMoving
      ? bomber.walkFrame === 1
        ? -3
        : bomber.walkFrame === 3
          ? 3
          : 0
      : 0;
    ctx.fillRect(px + 8 + footOffset, py + 32, 8, 7);
    ctx.fillRect(px + 20 - footOffset, py + 32, 8, 7);

    // Name label
    ctx.font = 'bold 11px "Chakra Petch", sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFFFFF";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    ctx.fillText(bomber.name, px + 18, py - 8);
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, game: GameEngine) {
    for (const p of game.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSuddenDeathBorder(ctx: CanvasRenderingContext2D) {
    const pulse = (Math.sin(performance.now() / 150) + 1) / 2;
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.5})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
  }

  private drawDebugOverlay(ctx: CanvasRenderingContext2D, game: GameEngine) {
    const ai = game.ais[0];
    if (!ai) return;

    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        // Danger zone highlight
        if (ai.isTileDangerous(x, y)) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        // Distance field values
        const dist = ai.distanceGrid[y * ARENA_W + x];
        if (dist >= 0) {
          ctx.font = "10px monospace";
          ctx.fillStyle = "#39FF14";
          ctx.fillText(`${dist}`, px + 4, py + 12);
        }
      }
    }

    // Target tile indicator
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      ai.targetTileX * TILE_SIZE + 2,
      ai.targetTileY * TILE_SIZE + 2,
      TILE_SIZE - 4,
      TILE_SIZE - 4,
    );
  }
}
