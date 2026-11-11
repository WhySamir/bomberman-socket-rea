import { stat } from "node:fs/promises";
import path from "node:path";
import { Server as Engine } from "@socket.io/bun-engine";
import { Elysia } from "elysia";
import { Server } from "socket.io";
import { ServerConfig, clientBuildExists, loadConfig } from "./config";
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./protocol";
import { registerHandlers } from "./net/handlers";
import { RoomManager } from "./rooms/roomManager";

const SERVICE_NAME = "bomberman-multiplayer";
const TICK_MS = 1000 / 60;

type GameIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Resolve a request path inside the client build, refusing directory escapes. */
async function resolveStaticFile(
  root: string,
  pathname: string,
): Promise<Response | null> {
  const relative = pathname.replace(/^\/+/, "");
  if (!relative) return null;

  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;

  try {
    const info = await stat(resolved);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  const isHtml = resolved.toLowerCase().endsWith(".html");
  return new Response(Bun.file(resolved), {
    headers: {
      "cache-control": isHtml ? "no-cache" : "public, max-age=3600",
    },
  });
}

export function createBombermanServer(config: ServerConfig) {
  const rooms = new RoomManager(config.maxRooms);
  const startedAt = Date.now();
  const servingClient = clientBuildExists(config);
  const indexHtml = path.join(config.clientDist, "index.html");

  const engine = new Engine({
    path: "/socket.io/",
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: {
      origin: config.clientOrigins.length > 0 ? config.clientOrigins : true,
      methods: ["GET", "POST"],
    },
  });

  const io: GameIo = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >();
  io.bind(engine);

  registerHandlers(io, rooms);

  const handleSocketRequest = async ({
    request,
    server,
  }: {
    request: Request;
    server: unknown;
  }) => {
    const response = await engine.handleRequest(
      request,
      server as unknown as Parameters<typeof engine.handleRequest>[1],
    );
    return response ?? json({ ok: false, error: "Not found" }, 404);
  };

  const app = new Elysia()
    .get("/healthz", () =>
      json({
        ok: true,
        service: SERVICE_NAME,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        rooms: rooms.roomCount(),
        maxRooms: config.maxRooms,
        runtime: `bun ${Bun.version}`,
        framework: "elysia",
      }),
    )
    .all("/socket.io/", handleSocketRequest)
    .all("/socket.io", handleSocketRequest)
    .get("/*", async ({ request }) => {
      const { pathname } = new URL(request.url);

      if (servingClient) {
        // Hashed assets first, then the SPA fallback for client-side routes.
        const asset = await resolveStaticFile(config.clientDist, pathname);
        if (asset) return asset;

        const index = Bun.file(indexHtml);
        if (await index.exists()) {
          return new Response(index, { headers: { "cache-control": "no-cache" } });
        }
        return json({ ok: false, error: "Not found" }, 404);
      }

      if (pathname === "/") {
        return json({
          ok: true,
          service: SERVICE_NAME,
          message:
            "Socket.IO server is running. Build the web client or connect from its dev server.",
        });
      }
      return json({ ok: false, error: "Not found" }, 404);
    })
    .onError(({ error, code }) => {
      if (code === "NOT_FOUND") return json({ ok: false, error: "Not found" }, 404);
      console.error("[bomberman] request failed", error);
      return json({ ok: false, error: "Internal server error" }, 500);
    });

  return { app, io, engine, rooms, servingClient };
}

export type BombermanServer = ReturnType<typeof createBombermanServer>;

export interface RunningBombermanServer extends BombermanServer {
  port: number;
  stop: () => Promise<void>;
}

export function startBombermanServer(
  config: ServerConfig = loadConfig(),
): RunningBombermanServer {
  const server = createBombermanServer(config);

  server.app.listen({
    port: config.port,
    hostname: config.host,
    ...server.engine.handler(),
  });

  const loop = setInterval(() => server.rooms.tick(performance.now()), TICK_MS);
  const port = server.app.server?.port ?? config.port;
  const shownHost = config.host === "0.0.0.0" ? "localhost" : config.host;

  console.log(`[bomberman] elysia listening on http://${shownHost}:${port}`);
  console.log(
    `[bomberman] rooms=${config.maxRooms} cors=${
      config.clientOrigins.length > 0
        ? config.clientOrigins.join(", ")
        : "same-origin / any"
    }`,
  );
  if (server.servingClient) {
    console.log(`[bomberman] serving web client from ${config.clientDist}`);
  } else if (config.serveClient) {
    console.log(
      "[bomberman] no web client build found; run the Vite dev server or build it",
    );
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(loop);
    server.io.disconnectSockets(true);
    await server.app.stop();
  };

  return { ...server, port, stop };
}
