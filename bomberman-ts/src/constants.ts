/**
 * Exact reverse-engineered constants from Bombermaaan_32.exe findings
 * References: bomberman-rea-findings.md & OpenCode session ses_e779c2754ffe5m18N5x9suFTiL
 */

// Arena dimensions (FUN_004268A0 hard validation: 0xF x 0xD)
export const ARENA_W = 15;
export const ARENA_H = 13;
export const TILE_SIZE = 48; // Rendered cell size in pixels

// Limits & Pools
export const MAX_BOMBS = 50; // game+0x7CF8 pool, cap at game+0xBFE4 = 0x32 (50)
export const MAX_FLAMES = 50; // game+0xA598 pool (49 scanned slots)
export const MAX_PLAYERS = 5; // 1 human + 4 AI bots

// Power Limits (Per user specification: Max Flame is 2, exactly 4 total power items per match)
export const MAX_FLAME_POWER = 2; // Flame starts at 1, max is 2
export const TOTAL_MATCH_FLAME_ITEMS = 2;
export const TOTAL_MATCH_SPEED_ITEMS = 2;

// Timing (FUN_0043D930, FUN_0043B450)
export const FUSE_DEFAULT = 2.0; // Seconds
export const FUSE_SHARED_TILE = 3.5; // Decent escape time (3.5s) when bomb placed on tile shared by another player/bot
export const FUSE_LONG = 4.0; // State 7 override
export const FUSE_SHORT = 1.0; // State 8 override
export const FLAME_DURATION = 0.6; // Visible flame persistence time in seconds

// Directions (CBomber +0x38, FUN_0043CC00 param_1)
export const DIR_NONE = 0;
export const DIR_UP = 1;
export const DIR_DOWN = 2;
export const DIR_LEFT = 3;
export const DIR_RIGHT = 4;

export type Direction = 0 | 1 | 2 | 3 | 4;

export const DIR_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  [DIR_NONE]: { dx: 0, dy: 0 },
  [DIR_UP]: { dx: 0, dy: -1 },
  [DIR_DOWN]: { dx: 0, dy: 1 },
  [DIR_LEFT]: { dx: -1, dy: 0 },
  [DIR_RIGHT]: { dx: 1, dy: 0 },
};

// Action arg convention (FUN_0043CC00 param_2)
export const ACT_NONE = 0;
export const ACT_PLACE_BOMB = 1;
export const ACT_HOLD = 2;

export type ActionArg = 0 | 1 | 2;

// Tile type values (from level loader FUN_004268A0)
export const TILE_FLOOR = 0; // Walkable empty floor
export const TILE_HARD_WALL = 1; // Indestructible stone wall
export const TILE_SOFT_BLOCK = 2; // Breakable brick

// Compatibility bitmask constants
export const BIT_HARD_BLOCK = 1;
export const BIT_SOFT_BLOCK = 2;

// Exactly 2 powerup types: Flame and Speed
export enum ItemType {
  None = 0,
  Flame = 1, // +1 Flame Size (Max 2)
  Speed = 2, // +Movement Speed
  Roller = 2, // Speed alias
}

// Player spawn positions matching RE findings (up to 5 players)
export const SPAWN_POSITIONS = [
  { x: 1, y: 1 }, // P1: Top-Left
  { x: 13, y: 11 }, // P2: Bottom-Right
  { x: 13, y: 1 }, // P3: Top-Right
  { x: 1, y: 11 }, // P4: Bottom-Left
  { x: 7, y: 6 }, // P5: Center
];

// Player colors
export const PLAYER_COLORS = [
  "#FFFFFF", // White Bomber (Player)
  "#FF3366", // Cyber Red
  "#00E5FF", // Neon Blue
  "#39FF14", // Toxic Green
  "#FFD700", // Solar Yellow
];

export const PLAYER_NAMES = [
  "Player 1 (You)",
  "Crimson Bot",
  "Cobalt Bot",
  "Viper Bot",
  "Aegis Bot",
];
