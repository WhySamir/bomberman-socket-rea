import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  port: number;
  host: string;
  clientOrigins: string[];
  maxRooms: number;
  serveClient: boolean;
  clientDist: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, "..");

export function loadConfig(): ServerConfig {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const maxRooms = Number.parseInt(process.env.MAX_ROOMS ?? "100", 10);
  const clientDist = path.resolve(
    process.env.CLIENT_DIST ?? path.resolve(serverRoot, "../bomberman-ts/dist"),
  );
  const serveClient = process.env.SERVE_CLIENT !== "false";

  return {
    port: Number.isFinite(port) && port > 0 ? port : 3001,
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
