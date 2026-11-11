import { createServer } from "node:http";
import path from "node:path";
import { loadEnvFile } from "node:process";
import express from "express";
import { Server } from "socket.io";
import { clientBuildExists, loadConfig, serverRoot } from "./config.js";
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./protocol.js";
import { registerHandlers } from "./net/handlers.js";
import { RoomManager } from "./rooms/roomManager.js";

// Local development convenience. Render injects variables directly, and real
// environment variables always win over `.env` values.
try {
  loadEnvFile(path.join(serverRoot, ".env"));
} catch {
  // `.env` is optional.
}

const config = loadConfig();
const rooms = new RoomManager(config.maxRooms);
const app = express();
const httpServer = createServer(app);
const startedAt = Date.now();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  serveClient: false,
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 8_000,
  cors: {
    origin: config.clientOrigins.length > 0 ? config.clientOrigins : true,
    methods: ["GET", "POST"],
  },
});

registerHandlers(io, rooms);

app.get("/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "bomberman-multiplayer",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    rooms: rooms.roomCount(),
    maxRooms: config.maxRooms,
  });
});

if (clientBuildExists(config)) {
  app.use(
    express.static(config.clientDist, {
      index: false,
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/socket.io")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.clientDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "bomberman-multiplayer",
      message:
        "Socket.IO server is running. Build the web client or connect from its dev server.",
    });
  });
}

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

const loop = setInterval(() => {
  rooms.tick(performance.now());
}, 1000 / 60);
loop.unref();

httpServer.listen(config.port, config.host, () => {
  const shownHost = config.host === "0.0.0.0" ? "localhost" : config.host;
  console.log(`[bomberman] listening on http://${shownHost}:${config.port}`);
  console.log(
    `[bomberman] rooms=${config.maxRooms} cors=${
      config.clientOrigins.length > 0
        ? config.clientOrigins.join(", ")
        : "same-origin / any"
    }`,
  );
  if (clientBuildExists(config)) {
    console.log(`[bomberman] serving web client from ${config.clientDist}`);
  } else if (config.serveClient) {
    console.log(
      "[bomberman] no web client build found; run the Vite dev server or build it",
    );
  }
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bomberman] ${signal} received, shutting down`);
  clearInterval(loop);
  io.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[bomberman] unhandled rejection", reason);
});
