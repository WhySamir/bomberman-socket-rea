/**
 * Level registry
 *
 * Level 1 ("classic") is a snapshot of the arena as it stands: the bots keep the
 * existing safe-only bomb gate, dig through soft blocks, and never trade their
 * own life.
 *
 * Level Impossible ("impossible") assigns the squad fixed interception roles and
 * lets them trade a bot's life for the human's when the human is already trapped.
 */

export type LevelId = "classic" | "impossible";
export type AiMode = "classic" | "impossible";

export interface LevelDefinition {
  id: LevelId;
  name: string;
  difficulty: string;
  accent: string;
  tagline: string;
  description: string;
  features: string[];
  aiMode: AiMode;
  defaultBots: number;
}

export const LEVELS: LevelDefinition[] = [
  {
    id: "classic",
    name: "Level 1",
    difficulty: "Normal",
    accent: "#00e5ff",
    tagline: "The arena exactly as it plays today",
    description:
      "The original reverse-engineered arena AI. Bots tunnel through bricks, close in on you from different angles, and always keep a guaranteed refuge before they drop a bomb.",
    features: [
      "Safe-only bomb placement (guaranteed escape)",
      "Digs through soft blocks toward the player",
      "Stable squad flank, never a self-kill",
    ],
    aiMode: "classic",
    defaultBots: 3,
  },
  {
    id: "impossible",
    name: "Level Impossible",
    difficulty: "Impossible",
    accent: "#ff3366",
    tagline: "Predictive squad executioners",
    description:
      "A coordinated kill squad. Two interceptors cut off where you are about to be while a third flanks from behind and plants a bomb at your back. Cornered, they will trade their own life for yours.",
    features: [
      "Interceptor A cuts 2 tiles ahead of you",
      "Interceptor B cuts 4 tiles ahead of you",
      "Rear bomber plants behind you",
      "Kamikaze trade only when you are trapped",
    ],
    aiMode: "impossible",
    defaultBots: 3,
  },
];

export function getLevel(id: LevelId): LevelDefinition {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}
