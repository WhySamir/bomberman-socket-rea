# Bomberman Multiplayer Server (Elysia + Bun)

An Elysia + Bun port of `bomberman-server`. The HTTP framework and runtime
changed; the game is the same. Room lifecycle, the 60 Hz authoritative
simulation, validation, and the Socket.IO wire contract are copied unchanged, so
the existing Vite client (`bomberman-ts`) connects without any modification.

Socket.IO runs on Bun's native HTTP server through the official
`@socket.io/bun-engine`, which is mounted on Elysia at `/socket.io/`.

## Requirements

- Bun `>=1.3` (developed against Bun 1.4.4). Install with `powershell -c "irm bun.sh/install.ps1 | iex"`
  on Windows, or `curl -fsSL https://bun.sh/install | bash` elsewhere.

## Run locally

```bash
# terminal 1 - this backend on http://localhost:3001
cd elysia-socker
bun install
bun run dev

# terminal 2 - the untouched Vite client on http://localhost:5173
cd bomberman-ts
npm run dev
```

Bun loads `.env` automatically, so create `elysia-socker/.env` when you want a
non-default configuration:

```bash
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
MAX_ROOMS=100
```

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `bun run dev`       | Watch mode via `bun --watch`         |
| `bun run start`     | Start the server                     |
| `bun run typecheck` | `tsc --noEmit` (needs `bun install`) |
| `bun test`          | HTTP + two-client Socket.IO smoke tests |

## Endpoints

| Route                | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `/healthz`           | JSON health, uptime, room count, `maxRooms` (`no-store`).     |
| `/socket.io/`        | Socket.IO handshake, long-polling and WebSocket upgrade.      |
| `/` and any unknown  | Serves `bomberman-ts/dist` when built; JSON 404 otherwise.    |

## Configuration

Same variables as the Express server.

| Variable        | Default                | Meaning                                                          |
| --------------- | ---------------------- | ---------------------------------------------------------------- |
| `PORT`          | `3001`                 | HTTP port. Render supplies this automatically.                   |
| `HOST`          | `0.0.0.0`              | Bind address (Elysia `hostname`).                                |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Comma-separated origins allowed by the Socket.IO engine CORS.   |
| `MAX_ROOMS`     | `100`                  | In-memory room cap for this process.                             |
| `SERVE_CLIENT`  | `true`                 | Serve `bomberman-ts/dist` from this service.                     |
| `CLIENT_DIST`   | `../bomberman-ts/dist` | Optional explicit client build path.                             |

## Differences from the Express server

- `express` is replaced by `elysia`; static files and the SPA fallback use
  `Bun.file` with the same cache headers (`no-cache` for HTML, 1 hour for assets).
- `socket.io` is bound to `@socket.io/bun-engine` instead of a Node `http.Server`.
  CORS, `maxHttpBufferSize`, and ping settings moved to the engine options.
- `.env` is loaded by Bun itself; the `node:process` `loadEnvFile` call is gone.
- The game engine (`src/game`), protocol, handlers, and room manager are copied
  verbatim from `bomberman-server`, so behavior and the wire format are identical.

## Layout

```text
src/
  index.ts              Bun entrypoint, signal handling
  server.ts             Elysia app, Socket.IO engine binding, static serving, 60 Hz loop
  config.ts             Environment parsing
  protocol.ts           Shared wire contract (unchanged copy)
  net/handlers.ts       Socket.IO event validation, acks, room-entry throttle
  rooms/roomManager.ts  Room lifecycle, fixed-step loop, snapshot broadcast
  game/                 Authoritative engine (arena, bombs, flames, bots, rules)
tests/
  socket.test.ts        /healthz, 404, and a real two-client match over WebSocket
```
