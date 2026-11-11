import { io, Socket } from "socket.io-client";
import { Direction } from "../constants";
import {
  Ack,
  ClientToServerEvents,
  MatchResult,
  MatchStartPayload,
  RoomConfig,
  RoomState,
  ServerToClientEvents,
} from "./protocol";

export interface MultiplayerHandlers {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onRoomState?: (state: RoomState) => void;
  onMatchStart?: (payload: MatchStartPayload) => void;
  onSnapshot?: (snapshot: import("./protocol").GameSnapshot) => void;
  onMatchEnd?: (result: MatchResult) => void;
  onError?: (message: string) => void;
}

export type MultiplayerSocket = Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;

function resolveServerUrl(): string {
  const envUrl = import.meta.env.BACKEND_URL || import.meta.env.VITE_SERVER_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const { protocol, hostname, port } = window.location;
  const isLocalHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  // No env configured: assume the local development backend on port 3001.
  if (isLocalHost && port !== "3001") return `${protocol}//${hostname}:3001`;
  return window.location.origin;
}

export class MultiplayerClient {
  private socket: MultiplayerSocket | null = null;
  private handlers: MultiplayerHandlers = {};
  private readonly serverUrl: string;

  public room: RoomState | null = null;
  public yourSlot: number | null = null;

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl ?? resolveServerUrl();
  }

  public get id(): string | null {
    return this.socket?.id ?? null;
  }

  public get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  public get url(): string {
    return this.serverUrl;
  }

  public setHandlers(handlers: MultiplayerHandlers) {
    this.handlers = handlers;
  }

  public connect() {
    if (this.socket?.connected) return;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    const socket: MultiplayerSocket = io(this.serverUrl, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: false,
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.handlers.onConnect?.();
    });

    socket.on("disconnect", (reason) => {
      this.room = null;
      this.yourSlot = null;
      this.handlers.onDisconnect?.(reason);
    });

    socket.on("connect_error", (error) => {
      this.handlers.onError?.(
        `Could not reach the multiplayer server at ${this.serverUrl}. ${error.message}`,
      );
    });

    socket.on("room:state", (state) => {
      this.room = state;
      const ownSeat = state.seats.find((seat) => seat.id === socket.id);
      if (ownSeat) this.yourSlot = ownSeat.slot;
      this.handlers.onRoomState?.(state);
    });

    socket.on("match:start", (payload) => {
      this.room = payload.room;
      this.yourSlot = payload.yourSlot;
      this.handlers.onMatchStart?.(payload);
    });

    socket.on("game:snapshot", (snapshot) => {
      this.handlers.onSnapshot?.(snapshot);
    });

    socket.on("match:end", (result) => {
      this.handlers.onMatchEnd?.(result);
    });
  }

  public disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.room = null;
    this.yourSlot = null;
  }

  public async createRoom(name: string) {
    return this.request<{ room: RoomState; yourSlot: number }>((done) => {
      this.socketOrThrow().emit("room:create", { name }, done);
    });
  }

  public async joinRoom(code: string, name: string) {
    return this.request<{ room: RoomState; yourSlot: number }>((done) => {
      this.socketOrThrow().emit("room:join", { code, name }, done);
    });
  }

  public async configure(patch: Partial<RoomConfig>) {
    return this.request<{ room: RoomState }>((done) => {
      this.socketOrThrow().emit("room:configure", patch, done);
    });
  }

  public async start(fillBots?: boolean) {
    return this.request<{ room: RoomState }>((done) => {
      this.socketOrThrow().emit("room:start", { fillBots }, done);
    });
  }

  public async rematch() {
    return this.request<{ room: RoomState }>((done) => {
      this.socketOrThrow().emit("room:rematch", done);
    });
  }

  public async backToLobby() {
    return this.request<{ room: RoomState }>((done) => {
      this.socketOrThrow().emit("room:lobby", done);
    });
  }

  /** The server removes the seat on disconnect, so no ack round-trip is needed. */
  public leave() {
    this.disconnect();
  }

  public sendDirection(dir: Direction) {
    if (!this.socket?.connected || this.room?.phase !== "playing") return;
    this.socket.emit("player:input", { dir });
  }

  public sendBomb() {
    if (!this.socket?.connected || this.room?.phase !== "playing") return;
    this.socket.emit("player:bomb");
  }

  private socketOrThrow(): MultiplayerSocket {
    if (!this.socket) this.connect();
    if (!this.socket) throw new Error("Multiplayer socket is not connected.");
    return this.socket;
  }

  private request<T>(
    send: (done: (res: Ack<T>) => void) => void,
    timeoutMs = 6000,
  ): Promise<Ack<T>> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: "The server did not respond in time." });
      }, timeoutMs);

      const done = (res: Ack<T>) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(res);
      };

      try {
        send(done);
      } catch (error) {
        done({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Multiplayer request failed.",
        });
      }
    });
  }
}
