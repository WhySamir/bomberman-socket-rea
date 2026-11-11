import { afterAll, expect, test } from "bun:test";
import { io as createClient, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import type {
  Ack,
  ClientToServerEvents,
  MatchStartPayload,
  RoomState,
  ServerToClientEvents,
} from "../src/protocol";
import type { GameSnapshot } from "../src/game/snapshot";
import { startBombermanServer } from "../src/server";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const config = loadConfig({
  PORT: "0",
  CLIENT_ORIGIN: "http://localhost:5173",
  MAX_ROOMS: "8",
  SERVE_CLIENT: "false",
});
const server = startBombermanServer(config);
const url = `http://127.0.0.1:${server.port}`;

afterAll(async () => {
  await server.stop();
});

function connect(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });
}

function emitWithAck<T>(
  emit: (done: (res: Ack<T>) => void) => void,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: "ack timed out" }),
      4000,
    );
    emit((res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function nextEvent<T>(
  socket: TestClient,
  event: keyof ServerToClientEvents,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
    (socket as unknown as { once: (name: string, cb: (p: T) => void) => void }).once(
      event as string,
      (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      },
    );
  });
}

test("healthz responds with room stats and no-store caching", async () => {
  const response = await fetch(`${url}/healthz`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");

  const body = (await response.json()) as {
    ok: boolean;
    service: string;
    maxRooms: number;
  };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("bomberman-multiplayer");
  expect(body.maxRooms).toBe(8);
});

test("unknown routes return the JSON 404", async () => {
  const response = await fetch(`${url}/nope`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: "Not found" });
});

test("two players create, join, and start a bot-filled match over WebSocket", async () => {
  const host = await connect();
  const guest = await connect();

  const created = await emitWithAck<{ room: RoomState; yourSlot: number }>(
    (done) => host.emit("room:create", { name: "Alice" }, done),
  );
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error);

  const code = created.data.room.code;
  expect(code).toHaveLength(5);
  expect(created.data.yourSlot).toBe(0);

  const guestState = nextEvent<RoomState>(host, "room:state");
  const joined = await emitWithAck<{ room: RoomState; yourSlot: number }>(
    (done) => guest.emit("room:join", { code: code.toLowerCase(), name: "Bob" }, done),
  );
  expect(joined.ok).toBe(true);
  if (!joined.ok) throw new Error(joined.error);
  expect(joined.data.yourSlot).toBe(1);

  const state = await guestState;
  expect(state.seats.filter((seat) => seat.connected).length).toBe(2);
  expect(state.hostId).toBe(host.id!);

  const started = nextEvent<MatchStartPayload>(host, "match:start");
  const startAck = await emitWithAck<{ room: RoomState }>((done) =>
    host.emit("room:start", { fillBots: true }, done),
  );
  expect(startAck.ok).toBe(true);

  const start = await started;
  expect(start.snapshot.bombers).toHaveLength(4);
  expect(start.yourSlot).toBe(0);

  const snapshot = await nextEvent<GameSnapshot>(guest, "game:snapshot");
  expect(snapshot.tick).toBeGreaterThanOrEqual(0);
  expect(snapshot.arena.width).toBeGreaterThan(0);

  host.disconnect();
  guest.disconnect();
}, 20_000);

test("non-host players cannot start the match", async () => {
  const host = await connect();
  const guest = await connect();

  const created = await emitWithAck<{ room: RoomState; yourSlot: number }>(
    (done) => host.emit("room:create", { name: "Host" }, done),
  );
  if (!created.ok) throw new Error(created.error);

  const joined = await emitWithAck<{ room: RoomState; yourSlot: number }>(
    (done) => guest.emit("room:join", { code: created.data.room.code, name: "Guest" }, done),
  );
  expect(joined.ok).toBe(true);

  const denied = await emitWithAck<{ room: RoomState }>((done) =>
    guest.emit("room:start", { fillBots: true }, done),
  );
  expect(denied.ok).toBe(false);
  if (!denied.ok) expect(denied.error).toContain("Only the host");

  host.disconnect();
  guest.disconnect();
}, 15_000);
