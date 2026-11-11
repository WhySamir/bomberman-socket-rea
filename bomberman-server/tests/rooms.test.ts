import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { registerHandlers } from "../src/net/handlers.js";
import { RoomManager } from "../src/rooms/roomManager.js";
import type {
  Ack,
  ClientToServerEvents,
  InterServerEvents,
  MatchStartPayload,
  RoomState,
  ServerToClientEvents,
  SocketData,
} from "../src/protocol.js";
import type { GameSnapshot } from "../src/game/snapshot.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function request<T>(
  send: (done: (res: Ack<T>) => void) => void,
  timeoutMs = 4000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "test request timed out" });
    }, timeoutMs);

    const done = (res: Ack<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    send(done);
  });
}

function waitForConnect(socket: TestClient, timeoutMs = 4000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      socket.off("connect", onConnect);
      reject(new Error("client did not connect"));
    }, timeoutMs);
    socket.once("connect", onConnect);
  });
}

function waitForState(
  socket: TestClient,
  predicate: (state: RoomState) => boolean,
  timeoutMs = 4000,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const onState = (state: RoomState) => {
      if (!predicate(state)) return;
      cleanup();
      resolve(state);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("expected room state never arrived"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("room:state", onState);
    };
    socket.on("room:state", onState);
  });
}

function waitForSnapshot(
  socket: TestClient,
  predicate: (snapshot: GameSnapshot) => boolean,
  timeoutMs = 4000,
): Promise<GameSnapshot> {
  return new Promise((resolve, reject) => {
    const onSnapshot = (snapshot: GameSnapshot) => {
      if (!predicate(snapshot)) return;
      cleanup();
      resolve(snapshot);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("expected game snapshot never arrived"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("game:snapshot", onSnapshot);
    };
    socket.on("game:snapshot", onSnapshot);
  });
}

test("two players create, join, start with bots, play, and hand a leaver to a bot", async (t) => {
  const httpServer = createServer();
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer);
  const rooms = new RoomManager(5);
  registerHandlers(io, rooms);

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  const port = (httpServer.address() as AddressInfo).port;
  const serverUrl = `http://127.0.0.1:${port}`;
  const loop = setInterval(() => rooms.tick(performance.now()), 1000 / 60);

  const clients: TestClient[] = [];
  t.after(async () => {
    clearInterval(loop);
    for (const client of clients) client.disconnect();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  const alice = createClient(serverUrl, {
    transports: ["websocket"],
    reconnection: false,
  });
  clients.push(alice);
  await waitForConnect(alice);

  const created = await request<{ room: RoomState; yourSlot: number }>((done) =>
    alice.emit("room:create", { name: "Alice" }, done),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.match(created.data.room.code, /^[A-Z0-9]{5}$/);
  assert.equal(created.data.room.hostId, alice.id);
  assert.equal(created.data.yourSlot, 0);
  assert.equal(created.data.room.phase, "lobby");

  const bob = createClient(serverUrl, {
    transports: ["websocket"],
    reconnection: false,
  });
  clients.push(bob);
  await waitForConnect(bob);

  const bothSeated = waitForState(
    alice,
    (state) => state.seats.filter((seat) => seat.id).length === 2,
  );
  const joined = await request<{ room: RoomState; yourSlot: number }>((done) =>
    bob.emit("room:join", { code: created.data.room.code, name: "Bob" }, done),
  );
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  assert.equal(joined.data.yourSlot, 1);
  assert.equal(joined.data.room.hostId, alice.id);
  const aliceLobby = await bothSeated;
  assert.equal(aliceLobby.seats[0].name, "Alice");
  assert.equal(aliceLobby.seats[0].isHost, true);
  assert.equal(aliceLobby.seats[1].name, "Bob");
  assert.equal(aliceLobby.seats[2].id, null);

  const aliceStart = new Promise<MatchStartPayload>((resolve) =>
    alice.once("match:start", resolve),
  );
  const bobStart = new Promise<MatchStartPayload>((resolve) =>
    bob.once("match:start", resolve),
  );
  const started = await request<{ room: RoomState }>((done) =>
    alice.emit("room:start", { fillBots: true }, done),
  );
  assert.equal(started.ok, true);

  const [aliceMatch, bobMatch] = await Promise.all([aliceStart, bobStart]);
  assert.equal(aliceMatch.yourSlot, 0);
  assert.equal(bobMatch.yourSlot, 1);
  assert.equal(aliceMatch.room.phase, "playing");
  assert.equal(aliceMatch.snapshot.bombers.length, 4);
  assert.deepEqual(
    aliceMatch.snapshot.bombers.map((bomber) => bomber.isAi),
    [false, false, true, true],
  );

  const liveSnapshot = await waitForSnapshot(
    alice,
    (snapshot) => snapshot.tick > 5,
  );
  assert.equal(liveSnapshot.phase, "playing");
  assert.equal(liveSnapshot.bombers.length, 4);
  assert.equal(
    liveSnapshot.arena.tiles.length,
    liveSnapshot.arena.width * liveSnapshot.arena.height,
  );
  assert.equal(liveSnapshot.arena.items.length, 0);

  // Bomb presses are accepted over the wire and appear in an authoritative snapshot.
  const bombSnapshot = waitForSnapshot(
    alice,
    (snapshot) => snapshot.bombs.length > 0,
  );
  alice.emit("player:bomb");
  bob.emit("player:bomb");
  const withBombs = await bombSnapshot;
  assert.ok(withBombs.bombs.length > 0);

  // A mid-match disconnect keeps the seat and hands control to a bot.
  const takeover = waitForState(alice, (state) =>
    state.seats.some((seat) => seat.slot === 1 && seat.isBot),
  );
  bob.disconnect();
  const afterLeave = await takeover;
  const botSeat = afterLeave.seats.find((seat) => seat.slot === 1);
  assert.equal(botSeat?.isBot, true);
  assert.equal(botSeat?.connected, false);
  assert.equal(afterLeave.phase, "playing");
});
