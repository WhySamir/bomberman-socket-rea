import { loadConfig } from "./config";
import { startBombermanServer } from "./server";

const config = loadConfig();
const server = startBombermanServer(config);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bomberman] ${signal} received, shutting down`);
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[bomberman] unhandled rejection", reason);
});
