# Bomberman Multiplayer Server

Authoritative Express + TypeScript + Socket.IO backend for four-player online
Bomberman. The browser sends only direction changes and bomb presses; the server
runs the full game simulation and broadcasts snapshots. The existing Vite client
renders those snapshots with the same canvas renderer, arena, bomb, flame, item,
and bot code used by solo and local duo.

## How a room works

- One player creates a room and gets a five-character code (also available as an
  invite link).
- Up to four players join. The host owns the match settings.
- The host can start with fewer than four humans when **Fill empty seats with
  bots** is enabled. At least two combatants are always required.
- Bots are free-for-all opponents: they target any other living bomber, not only
  humans.
- A match ends when one combatant remains or when every human is eliminated.
- Disconnecting or leaving mid-match hands that seat to a bot immediately, so
  the rest of the room keeps playing.
- After the result screen the host can start a rematch or return everyone to
  the lobby.

Everything is in memory. There is no database, Redis, account system, or
cross-instance coordination.

## Run locally

The server expects Node `>=20.19`; the repository `.nvmrc` pins `24.22.1`.

```bash
# terminal 1 - backend on http://localhost:3001
cd bomberman-server
npm ci
npm run dev

# terminal 2 - client on http://localhost:5173
cd bomberman-ts
npm ci
npm run dev
```

Open `http://localhost:5173`, choose **Play Online**, and create or join a room.
The client connects to the backend URL in `bomberman-ts/.env`
(`BACKEND_URL`). Change it there, or set the same variable in the static host's
build environment, to point at a different backend. When `BACKEND_URL` is
missing, the client falls back to `http://localhost:3001` on a local host and to
same-origin elsewhere.

Server commands:

| Command             | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Watch-mode server via `tsx`                    |
| `npm run build`     | Compile TypeScript to `dist/`                  |
| `npm start`         | Run `dist/index.js` (build first)              |
| `npm run typecheck` | Type-check without emitting                    |
| `npm test`          | Engine and real Socket.IO room lifecycle tests |

The tests cover a full wire-level flow: host creates, second player joins, host
starts with bot fill, snapshots arrive, bomb input is reflected, and a player
who disconnects mid-match is replaced by a bot.

## Configuration

Copy `.env.example` to `.env` for local development, or set the same variables
in the Render dashboard. Real environment variables take precedence.

| Variable          | Default                | Meaning                                                                                                                      |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `3001`                 | HTTP port. Render supplies this automatically.                                                                               |
| `HOST`            | `0.0.0.0`              | Bind address.                                                                                                                |
| `CLIENT_ORIGIN`   | empty                  | Comma-separated browser origins allowed by Socket.IO CORS. Empty reflects the request origin, which is fine without cookies. |
| `MAX_ROOMS`       | `100`                  | In-memory room cap for this process.                                                                                         |
| `SERVE_CLIENT`    | `true`                 | Serve `bomberman-ts/dist` from the same service unless set to `false`.                                                       |
| `CLIENT_DIST`     | `../bomberman-ts/dist` | Optional explicit client build path.                                                                                         |
| `BACKEND_URL`     | same origin            | Client build-time backend URL when the client is hosted separately.                                                          |

## Deploy on Render

### Same service (recommended)

The repository root contains `render.yaml`, which builds the client and server
and serves both from one origin:

1. Push the repository to GitHub.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Apply the blueprint. Build and start commands are already defined.
4. Open the `onrender.com` URL and share the room invite link.

Manual web service settings, if you prefer not to use the blueprint:

| Setting           | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Build Command     | `cd bomberman-ts && npm ci && npm run build && cd ../bomberman-server && npm ci && npm run build` |
| Start Command     | `node bomberman-server/dist/index.js`                                                             |
| Health Check Path | `/healthz`                                                                                        |
| `SERVE_CLIENT`    | `true`                                                                                            |
| `MAX_ROOMS`       | `8` on the free plan (see capacity below)                                                         |

WebSockets work on Render without extra configuration; the client and server
speak Socket.IO over the same origin.

### Client and server on separate hosts

1. Build the client with the backend URL:
   `BACKEND_URL=https://your-service.onrender.com npm run build`
2. Deploy `bomberman-ts/dist` to a static host.
3. Set `CLIENT_ORIGIN=https://your-client.example` on the Render service and
   `SERVE_CLIENT=false`.

## Capacity and limitations

- A four-bot room costs roughly **1% of one CPU core** at 60 Hz on the
  development machine used for measurement: 3,600 fixed steps took 279 ms wall
  and 625 ms CPU (one simulated minute). Human-only rooms are considerably
  cheaper. Snapshot serialization and bandwidth are additional costs.
- A Render free instance has `0.1` CPU, so the blueprint caps rooms at `8`.
  A `1` CPU instance can serve roughly `60` bot-filled rooms; a `2` CPU instance
  roughly `120`. Raise `MAX_ROOMS` only after checking CPU on the instance.
- The free plan spins down after inactivity. The first request wakes the
  service; rooms and matches do not survive a restart, redeploy, or spin-down.
- Rooms are single-instance only. Do not scale this service to multiple
  instances without adding shared room state and cross-instance pub/sub.
- Match settings are validated server-side: fill-bots toggle, `60/120/180/300/0`
  second matches, and the `classic`/`impossible` bot modes.
- Display names are limited to 16 characters, stripped of control characters,
  and kept only for the lifetime of the room.
- Room codes are short and shareable by design; this is a friends-and-family
  game, not an authenticated competitive service.

## Layout

```
src/
  index.ts              Express, static client serving, health check, shutdown
  config.ts             Environment parsing and client build lookup
  protocol.ts           Shared wire contract and room snapshot types
  net/handlers.ts       Socket.IO event validation, acks, room-entry throttle
  rooms/roomManager.ts  Room lifecycle, 60 Hz fixed-step loop, 20 Hz snapshots
  game/                 Authoritative engine (arena, bombs, flames, bots, rules)
  util/name.ts          Display-name normalization
tests/
  game.test.ts          Engine rules, AI takeover, snapshot privacy
  rooms.test.ts         Real two-client Socket.IO lifecycle
```

The wire contract is duplicated intentionally in
`bomberman-ts/src/net/protocol.ts`; update both sides together when changing
events or snapshot fields.
