import type { Server } from "socket.io";
import { z } from "zod";
import {
  Ack,
  ALLOWED_MATCH_DURATIONS,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../protocol.js";
import { Direction } from "../game/constants.js";
import { GameSocket, RoomManager } from "../rooms/roomManager.js";
import { cleanName } from "../util/name.js";

const createSchema = z.object({
  name: z.unknown().optional(),
});

const joinSchema = z.object({
  code: z.string().trim().min(1).max(12),
  name: z.unknown().optional(),
});

const configureSchema = z.object({
  fillBots: z.boolean().optional(),
  matchDuration: z
    .number()
    .int()
    .refine(
      (value) => (ALLOWED_MATCH_DURATIONS as readonly number[]).includes(value),
      {
        message: "Unsupported match duration",
      },
    )
    .optional(),
  level: z.enum(["classic", "impossible"]).optional(),
});

const startSchema = z
  .object({
    fillBots: z.boolean().optional(),
  })
  .optional();

const inputSchema = z.object({
  dir: z.number().int().min(0).max(4),
});

const ROOM_ENTRY_INTERVAL_MS = 350;

function reply<T>(ack: ((res: Ack<T>) => void) | undefined, result: Ack<T>) {
  if (typeof ack === "function") ack(result);
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T | null {
  const result = schema.safeParse(payload ?? {});
  return result.success ? result.data : null;
}

/** Create/join allocate rooms, so keep those two actions from being spammed. */
function throttleRoomEntry(socket: GameSocket): boolean {
  const now = Date.now();
  const last = socket.data.lastRoomEntryAt ?? 0;
  if (now - last < ROOM_ENTRY_INTERVAL_MS) return false;
  socket.data.lastRoomEntryAt = now;
  return true;
}

export function registerHandlers(
  io: Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >,
  rooms: RoomManager,
) {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload, ack) => {
      if (!throttleRoomEntry(socket)) {
        reply(ack, {
          ok: false,
          error: "Please wait a moment before trying again.",
        });
        return;
      }
      const parsed = parse(createSchema, payload);
      if (!parsed) {
        reply(ack, { ok: false, error: "Invalid room request." });
        return;
      }
      const name = cleanName(parsed.name, "Player");
      reply(ack, rooms.createRoom(socket, name));
    });

    socket.on("room:join", (payload, ack) => {
      if (!throttleRoomEntry(socket)) {
        reply(ack, {
          ok: false,
          error: "Please wait a moment before trying again.",
        });
        return;
      }
      const parsed = parse(joinSchema, payload);
      if (!parsed) {
        reply(ack, { ok: false, error: "Enter a valid room code." });
        return;
      }
      const name = cleanName(parsed.name, "Player");
      reply(ack, rooms.joinRoom(socket, parsed.code.toUpperCase(), name));
    });

    socket.on("room:leave", (ack) => {
      reply(ack, rooms.leaveRoom(socket));
    });

    socket.on("room:configure", (payload, ack) => {
      const parsed = parse(configureSchema, payload);
      if (!parsed) {
        reply(ack, { ok: false, error: "Invalid match settings." });
        return;
      }
      reply(ack, rooms.configureRoom(socket, parsed));
    });

    socket.on("room:start", (payload, ack) => {
      const parsed = parse(startSchema, payload);
      if (!parsed) {
        reply(ack, { ok: false, error: "Invalid match settings." });
        return;
      }
      reply(ack, rooms.startRoom(socket, parsed.fillBots));
    });

    socket.on("room:rematch", (ack) => {
      reply(ack, rooms.rematch(socket));
    });

    socket.on("room:lobby", (ack) => {
      reply(ack, rooms.backToLobby(socket));
    });

    socket.on("player:input", (payload) => {
      const parsed = parse(inputSchema, payload);
      if (!parsed) return;
      rooms.input(socket, parsed.dir as Direction);
    });

    socket.on("player:bomb", () => {
      rooms.bomb(socket);
    });

    socket.on("disconnect", () => {
      rooms.disconnect(socket);
    });
  });
}
