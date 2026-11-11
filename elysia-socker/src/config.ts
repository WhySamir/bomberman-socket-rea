import { existsSync } from "node:fs";
import path from "node:path";

export interface ServerConfig {
  port: number;
  host: string;
  clientOrigins: string[];
  maxRooms: number;
  serveClient: boolean;
  clientDist: string;
}

/** Repository-relative paths resolve from the backend folder, like the Express server. */
export const serverRoot = path.resolve(import.meta.dir, "..");

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  // Bun loads `.env` automatically, so `process.env` already contains it.
  const port = Number.parseInt(env.PORT ?? "3001", 10);
  const host = env.HOST ?? "0.0.0.0";
  const clientOrigins = (env.CLIENT_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const maxRooms = Number.parseInt(env.MAX_ROOMS ?? "100", 10);
  const clientDist = path.resolve(
    env.CLIENT_DIST ?? path.join(serverRoot, "..", "bomberman-ts", "dist"),
  );
  const serveClient = env.SERVE_CLIENT !== "false";

  return {
    port: Number.isFinite(port) && port >= 0 ? port : 3001,
    host,
    clientOrigins,
    maxRooms: Number.isFinite(maxRooms) && maxRooms > 0 ? maxRooms : 100,
    serveClient,
    clientDist,
  };
}

export function clientBuildExists(config: ServerConfig): boolean {
  return (
    config.serveClient && existsSync(path.join(config.clientDist, "index.html"))
  );
}
