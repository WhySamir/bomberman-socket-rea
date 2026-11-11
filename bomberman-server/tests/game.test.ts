import test from "node:test";
import assert from "node:assert/strict";
import { ARENA_H, ARENA_W, SPAWN_POSITIONS } from "../src/game/constants.js";
import { CombatantSpec, MultiplayerGame } from "../src/game/game.js";
import { captureSnapshot } from "../src/game/snapshot.js";

const humans: CombatantSpec[] = [
  { slot: 0, name: "Alice", isAi: false },
  { slot: 1, name: "Bob", isAi: false },
];

test("a four-combatant room spawns every slot with the authoritative engine", () => {
  const game = new MultiplayerGame({
    combatants: [
      ...humans,
      { slot: 2, name: "Crimson Bot", isAi: true },
      { slot: 3, name: "Viper Bot", isAi: true },
    ],
  });

  assert.equal(game.bombers.length, 4);
  assert.equal(game.ais.length, 2);
  assert.equal(game.phase, "playing");

  for (const bomber of game.bombers) {
    const spawn = SPAWN_POSITIONS[bomber.idx];
    assert.equal(bomber.tileX, spawn.x);
    assert.equal(bomber.tileY, spawn.y);
    assert.equal(bomber.alive, true);
  }
});

test("the last surviving combatant wins the free-for-all", () => {
  const game = new MultiplayerGame({
    combatants: [
      ...humans,
      { slot: 2, name: "Crimson Bot", isAi: true },
      { slot: 3, name: "Viper Bot", isAi: true },
    ],
  });

  game.bombers[0].die();
  game.bombers[1].die();
  game.bombers[2].die();
  game.update(1 / 60);

  assert.equal(game.phase, "gameover");
  assert.equal(game.winner?.idx, 3);
});

test("eliminating every human ends the match even if bots survive", () => {
  const game = new MultiplayerGame({
    combatants: [
      ...humans,
      { slot: 2, name: "Crimson Bot", isAi: true },
      { slot: 3, name: "Viper Bot", isAi: true },
    ],
  });

  game.bombers[0].die();
  game.bombers[1].die();
  game.update(1 / 60);

  assert.equal(game.phase, "gameover");
  assert.equal(game.winner, null);
});

test("a disconnected human slot can be handed to a bot without restarting", () => {
  const game = new MultiplayerGame({ combatants: humans });
  assert.equal(game.takeOverWithAi(0), true);

  const takenOver = game.bombers.find((bomber) => bomber.idx === 0);
  assert.equal(takenOver?.isAi, true);
  assert.match(takenOver?.name ?? "", /\(bot\)$/);
  assert.equal(game.ais.length, 1);
});

test("snapshots contain only public state, never hidden power-up locations", () => {
  const game = new MultiplayerGame({ combatants: humans });
  const snapshot = captureSnapshot(game, 12);

  assert.equal(snapshot.tick, 12);
  assert.equal(snapshot.arena.width, ARENA_W);
  assert.equal(snapshot.arena.height, ARENA_H);
  assert.equal(snapshot.arena.tiles.length, ARENA_W * ARENA_H);
  assert.equal(snapshot.arena.items.length, 0);
  assert.equal(snapshot.bombers.length, 2);
  assert.equal(snapshot.bombs.length, 0);
  assert.equal(snapshot.flames.length, 0);
});

test("placing a bomb is reflected in the next snapshot", () => {
  const game = new MultiplayerGame({ combatants: humans });
  const alice = game.bombers[0];

  game.spawnBomb(alice);
  assert.equal(alice.bombsActive, 1);

  const snapshot = captureSnapshot(game, 1);
  assert.equal(snapshot.bombs.length, 1);
  assert.equal(snapshot.bombs[0].owner, 0);
  assert.equal(snapshot.bombs[0].x, alice.tileX);
  assert.equal(snapshot.bombs[0].y, alice.tileY);
});
