import type { Socket } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  Ack,
  RoomConfig,
  RoomSeat,
  RoomState,
  MatchResult,
  MatchStanding,
  MatchStartPayload,
  MAX_ROOM_PLAYERS,
  MIN_COMBATANTS,
} from "../protocol.js";
import { PLAYER_COLORS, PLAYER_NAMES, Direction } from "../game/constants.js";
import { MultiplayerGame, CombatantSpec } from "../game/game.js";
import { captureSnapshot } from "../game/snapshot.js";

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface PlayerSession {
  id: string;
  name: string;
  slot: number;
  socket: GameSocket | null;
  joinedAt: number;
}

const STEP_MS = 1000 / 60;
const STEP_SECONDS = 1 / 60;
const MAX_CATCHUP_STEPS = 6;
const SNAPSHOT_INTERVAL_MS = 50;
const LOBBY_IDLE_MS = 30 * 60 * 1000;
const FINISHED_IDLE_MS = 30 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_CONFIG: RoomConfig = {
  fillBots: true,
  matchDuration: 180,
  level: "classic",
};

export class GameRoom {
  public readonly code: string;
  public readonly createdAt = Date.now();
  public hostId: string | null = null;
  public phase: "lobby" | "playing" | "finished" = "lobby";
  public config: RoomConfig = { ...DEFAULT_CONFIG };
  public game: MultiplayerGame | null = null;
  public result: MatchResult | null = null;
  public finishedAt: number | null = null;

  private readonly players = new Map<string, PlayerSession>();
  private readonly inputs = new Map<number, Direction>();
  private readonly pendingBombs = new Set<number>();
  private tickCount = 0;
  private accumulator = 0;
  private lastFrameAt = 0;
  private lastBroadcastAt = 0;

  constructor(code: string) {
    this.code = code;
  }

  public playerCount(): number {
    return this.players.size;
  }

  public connectedPlayerCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.socket) count++;
    }
    return count;
  }

  public isEmpty(): boolean {
    return this.players.size === 0;
  }

  /**
   * Release every client after an internal room failure so a single bad match
   * cannot leave sockets attached to a room that no longer ticks.
   */
  public close() {
    const sockets: GameSocket[] = [];
    for (const player of this.players.values()) {
      if (player.socket) sockets.push(player.socket);
    }
    this.players.clear();
    this.phase = "finished";
    this.game = null;
    for (const socket of sockets) socket.disconnect(true);
  }

  public addPlayer(
    socket: GameSocket,
    name: string,
  ): Ack<{ room: RoomState; yourSlot: number }> {
    if (this.phase !== "lobby") {
      return {
        ok: false,
        error: "This room is already playing. Ask the host for a new room.",
      };
    }
    if (this.players.size >= MAX_ROOM_PLAYERS) {
      return { ok: false, error: "This room is full (4 players)." };
    }

    const slot = this.nextFreeSlot();
    if (slot === null) {
      return { ok: false, error: "This room is full (4 players)." };
    }

    const player: PlayerSession = {
      id: socket.id,
      name,
      slot,
      socket,
      joinedAt: Date.now(),
    };
    this.players.set(socket.id, player);
    if (!this.hostId) this.hostId = socket.id;

    socket.data.roomCode = this.code;

    this.broadcastState();
    return { ok: true, data: { room: this.roomState(), yourSlot: slot } };
  }

  public removePlayer(socketId: string): boolean {
    const player = this.players.get(socketId);
    if (!player) return false;

    if (this.phase === "lobby") {
      this.players.delete(socketId);
      this.inputs.delete(player.slot);
      this.pendingBombs.delete(player.slot);
      if (this.hostId === socketId) this.promoteHost();
      this.broadcastState();
      return this.players.size === 0;
    }

    // Keep the seat for the result screen, but hand control to a bot.
    player.socket = null;
    this.inputs.delete(player.slot);
    this.pendingBombs.delete(player.slot);
    if (this.phase === "playing" && this.game) {
      this.game.takeOverWithAi(player.slot);
    }
    if (this.hostId === socketId) this.promoteHost();
    this.broadcastState();

    if (this.connectedPlayerCount() === 0) {
      if (this.phase === "playing") this.finishMatch("abandoned");
      return true;
    }
    return false;
  }

  public configure(patch: Partial<RoomConfig>): Ack<{ room: RoomState }> {
    if (this.phase !== "lobby") {
      return {
        ok: false,
        error: "Match settings can only change in the lobby.",
      };
    }
    if (patch.fillBots !== undefined) this.config.fillBots = patch.fillBots;
    if (patch.matchDuration !== undefined)
      this.config.matchDuration = patch.matchDuration;
    if (patch.level !== undefined) this.config.level = patch.level;
    this.broadcastState();
    return { ok: true, data: { room: this.roomState() } };
  }

  public start(
    socketId: string,
    fillBotsOverride?: boolean,
  ): Ack<{ room: RoomState }> {
    if (socketId !== this.hostId) {
      return { ok: false, error: "Only the host can start the match." };
    }
    if (this.phase === "playing") {
      return { ok: false, error: "The match has already started." };
    }
    if (this.phase === "finished") {
      return { ok: false, error: "Use rematch or return to the lobby first." };
    }

    if (fillBotsOverride !== undefined) this.config.fillBots = fillBotsOverride;
    const started = this.beginMatch();
    if (!started.ok) return started;
    return { ok: true, data: { room: this.roomState() } };
  }

  public rematch(socketId: string): Ack<{ room: RoomState }> {
    if (socketId !== this.hostId) {
      return { ok: false, error: "Only the host can start a rematch." };
    }
    if (this.phase !== "finished") {
      return { ok: false, error: "The match is not over yet." };
    }
    this.resetToLobbyInternal();
    const started = this.beginMatch();
    if (!started.ok) {
      this.broadcastState();
      return started;
    }
    return { ok: true, data: { room: this.roomState() } };
  }

  public backToLobby(socketId: string): Ack<{ room: RoomState }> {
    if (socketId !== this.hostId) {
      return {
        ok: false,
        error: "Only the host can return the room to the lobby.",
      };
    }
    if (this.phase !== "finished") {
      return { ok: false, error: "The match is still running." };
    }
    this.resetToLobbyInternal();
    this.broadcastState();
    return { ok: true, data: { room: this.roomState() } };
  }

  public setInput(socketId: string, dir: Direction) {
    if (!this.game || this.phase !== "playing") return;
    const player = this.players.get(socketId);
    if (!player) return;
    const bomber = this.game.bombers.find((b) => b.idx === player.slot);
    if (!bomber || bomber.isAi) return;
    this.inputs.set(player.slot, dir);
  }

  public requestBomb(socketId: string) {
    if (!this.game || this.phase !== "playing") return;
    const player = this.players.get(socketId);
    if (!player) return;
    const bomber = this.game.bombers.find((b) => b.idx === player.slot);
    if (!bomber || bomber.isAi) return;
    this.pendingBombs.add(player.slot);
  }

  public tick(now: number) {
    if (this.phase !== "playing" || !this.game) return;

    if (this.lastFrameAt === 0) this.lastFrameAt = now;
    const elapsed = Math.min(now - this.lastFrameAt, 250);
    this.lastFrameAt = now;
    this.accumulator += elapsed;

    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      this.step();
      this.accumulator -= STEP_MS;
      steps++;
      if (this.phase !== "playing") break;
    }
    if (steps === MAX_CATCHUP_STEPS) this.accumulator = 0;

    if (this.phase !== "playing") return;
    if (now - this.lastBroadcastAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastBroadcastAt = now;
      this.broadcast(
        "game:snapshot",
        captureSnapshot(this.game, this.tickCount),
      );
    }
  }

  public lobbyIdleExpired(): boolean {
    const now = Date.now();
    if (this.phase === "lobby") return now - this.createdAt > LOBBY_IDLE_MS;
    if (this.phase === "finished" && this.finishedAt) {
      return now - this.finishedAt > FINISHED_IDLE_MS;
    }
    return false;
  }

  private step() {
    const game = this.game;
    if (!game) return;

    for (const player of this.players.values()) {
      if (!player.socket) continue;
      const bomber = game.bombers.find((b) => b.idx === player.slot);
      if (bomber && !bomber.isAi) {
        bomber.moveCommand(this.inputs.get(player.slot) ?? (0 as Direction));
      }
    }

    for (const slot of this.pendingBombs) {
      const bomber = game.bombers.find((b) => b.idx === slot);
      if (bomber) game.spawnBomb(bomber);
    }
    this.pendingBombs.clear();

    game.update(STEP_SECONDS);
    this.tickCount++;

    if (game.phase === "gameover") {
      this.finishMatch("completed");
    }
  }

  private beginMatch(): Ack<{ room: RoomState }> {
    const humans = [...this.players.values()]
      .filter((player) => player.socket)
      .sort((a, b) => a.slot - b.slot);
    if (humans.length === 0) {
      return {
        ok: false,
        error: "There are no connected players in this room.",
      };
    }

    const specs: CombatantSpec[] = humans.map((player) => ({
      slot: player.slot,
      name: player.name,
      color: PLAYER_COLORS[player.slot] ?? PLAYER_COLORS[0],
      isAi: false,
    }));

    if (this.config.fillBots) {
      for (let slot = 0; slot < MAX_ROOM_PLAYERS; slot++) {
        if (specs.some((spec) => spec.slot === slot)) continue;
        specs.push({
          slot,
          name: PLAYER_NAMES[slot] ?? `Bot ${slot + 1}`,
          color: PLAYER_COLORS[slot] ?? PLAYER_COLORS[0],
          isAi: true,
        });
      }
    }

    if (specs.length < MIN_COMBATANTS) {
      return {
        ok: false,
        error:
          "Need at least 2 combatants. Invite another player or enable bot fill.",
      };
    }

    this.game = new MultiplayerGame({
      level: this.config.level,
      timeSec: this.config.matchDuration,
      combatants: specs,
    });
    this.phase = "playing";
    this.result = null;
    this.finishedAt = null;
    this.tickCount = 0;
    this.accumulator = 0;
    this.lastFrameAt = performance.now();
    this.lastBroadcastAt = 0;
    this.inputs.clear();
    this.pendingBombs.clear();

    this.broadcastState();
    const snapshot = captureSnapshot(this.game, 0);
    for (const player of this.players.values()) {
      if (!player.socket) continue;
      const payload: MatchStartPayload = {
        room: this.roomState(),
        snapshot,
        yourSlot: player.slot,
      };
      player.socket.emit("match:start", payload);
    }
    return { ok: true, data: { room: this.roomState() } };
  }

  private finishMatch(reason: "completed" | "abandoned") {
    if (this.phase !== "playing" || !this.game) return;
    this.phase = "finished";
    this.finishedAt = Date.now();
    this.result = this.buildResult(reason);
    this.inputs.clear();
    this.pendingBombs.clear();
    // The room stops ticking now, so send the final deaths/blasts once more
    // before the result. Without this, clients keep the last pre-death frame.
    this.broadcast("game:snapshot", captureSnapshot(this.game, this.tickCount));
    this.broadcastState();
    this.broadcast("match:end", this.result);
  }

  private buildResult(reason: "completed" | "abandoned"): MatchResult {
    const game = this.game;
    if (!game) {
      return { reason, winner: null, standings: [], durationMs: 0 };
    }

    const standings: MatchStanding[] = game.bombers.map((bomber) => {
      const player = [...this.players.values()].find(
        (p) => p.slot === bomber.idx,
      );
      return {
        slot: bomber.idx,
        id: player?.id ?? null,
        name: bomber.name,
        color: bomber.color,
        isBot: bomber.isAi,
        alive: bomber.alive,
        score: bomber.score,
      };
    });

    const winner = game.winner
      ? (standings.find((standing) => standing.slot === game.winner?.idx) ??
        null)
      : null;

    return {
      reason,
      winner,
      standings,
      durationMs: (game.endedAt ?? Date.now()) - game.startedAt,
    };
  }

  private resetToLobbyInternal() {
    for (const [id, player] of this.players) {
      if (!player.socket) this.players.delete(id);
    }
    this.phase = "lobby";
    this.game = null;
    this.result = null;
    this.finishedAt = null;
    this.tickCount = 0;
    this.accumulator = 0;
    this.lastFrameAt = 0;
    this.lastBroadcastAt = 0;
    this.inputs.clear();
    this.pendingBombs.clear();
    this.promoteHost();
  }

  private promoteHost() {
    if (this.hostId && this.players.get(this.hostId)?.socket) return;
    const next = [...this.players.values()]
      .filter((player) => player.socket)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostId = next?.id ?? null;
  }

  private nextFreeSlot(): number | null {
    const used = new Set(
      [...this.players.values()].map((player) => player.slot),
    );
    for (let slot = 0; slot < MAX_ROOM_PLAYERS; slot++) {
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  private roomState(): RoomState {
    const seats: RoomSeat[] = [];

    if (this.phase === "lobby" || !this.game) {
      for (let slot = 0; slot < MAX_ROOM_PLAYERS; slot++) {
        const player = [...this.players.values()].find(
          (p) => p.slot === slot && p.socket,
        );
        seats.push({
          slot,
          id: player?.id ?? null,
          name: player?.name ?? "Open slot",
          color: PLAYER_COLORS[slot] ?? PLAYER_COLORS[0],
          isBot: false,
          connected: Boolean(player),
          isHost: player?.id === this.hostId,
        });
      }
    } else {
      for (const bomber of this.game.bombers) {
        const player = [...this.players.values()].find(
          (p) => p.slot === bomber.idx,
        );
        seats.push({
          slot: bomber.idx,
          id: player?.id ?? null,
          name: bomber.name,
          color: bomber.color,
          isBot: bomber.isAi,
          connected: Boolean(player?.socket),
          isHost: player?.id === this.hostId,
        });
      }
    }

    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      config: { ...this.config },
      seats,
      maxPlayers: MAX_ROOM_PLAYERS,
      createdAt: this.createdAt,
    };
  }

  private broadcastState() {
    const state = this.roomState();
    for (const player of this.players.values()) {
      player.socket?.emit("room:state", state);
    }
  }

  private broadcast<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) {
    for (const player of this.players.values()) {
      if (!player.socket) continue;
      (player.socket.emit as (name: E, value: typeof payload) => void)(
        event,
        payload,
      );
    }
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly maxRooms: number;

  constructor(maxRooms = 100) {
    this.maxRooms = maxRooms;
  }

  public roomCount(): number {
    return this.rooms.size;
  }

  public createRoom(
    socket: GameSocket,
    name: string,
  ): Ack<{ room: RoomState; yourSlot: number }> {
    if (socket.data.roomCode) {
      return {
        ok: false,
        error: "Leave your current room before creating another.",
      };
    }
    if (this.rooms.size >= this.maxRooms) {
      return {
        ok: false,
        error: "The server is at room capacity. Try again shortly.",
      };
    }

    const code = this.generateCode();
    const room = new GameRoom(code);
    this.rooms.set(code, room);
    const result = room.addPlayer(socket, name);
    if (!result.ok) this.rooms.delete(code);
    return result;
  }

  public joinRoom(
    socket: GameSocket,
    code: string,
    name: string,
  ): Ack<{ room: RoomState; yourSlot: number }> {
    if (socket.data.roomCode) {
      return {
        ok: false,
        error: "Leave your current room before joining another.",
      };
    }
    const room = this.rooms.get(code.toUpperCase());
    if (!room)
      return {
        ok: false,
        error: "Room not found. Check the code and try again.",
      };
    return room.addPlayer(socket, name);
  }

  public leaveRoom(socket: GameSocket): Ack<Record<string, never>> {
    const code = socket.data.roomCode;
    if (!code) return { ok: false, error: "You are not in a room." };
    const room = this.rooms.get(code);
    if (!room) {
      delete socket.data.roomCode;
      return { ok: false, error: "Room no longer exists." };
    }

    const empty = room.removePlayer(socket.id);
    delete socket.data.roomCode;
    if (empty) this.rooms.delete(code);
    return { ok: true, data: {} };
  }

  public configureRoom(
    socket: GameSocket,
    patch: Partial<RoomConfig>,
  ): Ack<{ room: RoomState }> {
    const room = this.getRoomFor(socket);
    if (!room) return { ok: false, error: "You are not in a room." };
    if (socket.id !== room.hostId) {
      return { ok: false, error: "Only the host can change match settings." };
    }
    return room.configure(patch);
  }

  public startRoom(
    socket: GameSocket,
    fillBots?: boolean,
  ): Ack<{ room: RoomState }> {
    const room = this.getRoomFor(socket);
    if (!room) return { ok: false, error: "You are not in a room." };
    return room.start(socket.id, fillBots);
  }

  public rematch(socket: GameSocket): Ack<{ room: RoomState }> {
    const room = this.getRoomFor(socket);
    if (!room) return { ok: false, error: "You are not in a room." };
    return room.rematch(socket.id);
  }

  public backToLobby(socket: GameSocket): Ack<{ room: RoomState }> {
    const room = this.getRoomFor(socket);
    if (!room) return { ok: false, error: "You are not in a room." };
    return room.backToLobby(socket.id);
  }

  public input(socket: GameSocket, dir: Direction) {
    this.getRoomFor(socket)?.setInput(socket.id, dir);
  }

  public bomb(socket: GameSocket) {
    this.getRoomFor(socket)?.requestBomb(socket.id);
  }

  public disconnect(socket: GameSocket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    delete socket.data.roomCode;
    if (!room) return;
    const empty = room.removePlayer(socket.id);
    if (empty) this.rooms.delete(code);
  }

  /** Called from the single server-wide 60 Hz loop. */
  public tick(now: number) {
    for (const [code, room] of this.rooms) {
      try {
        room.tick(now);
      } catch (error) {
        console.error(`[bomberman] room ${code} failed; closing it`, error);
        room.close();
        this.rooms.delete(code);
        continue;
      }
      if (
        room.isEmpty() ||
        (room.phase !== "playing" && room.lobbyIdleExpired())
      ) {
        this.rooms.delete(code);
      }
    }
  }

  private getRoomFor(socket: GameSocket): GameRoom | undefined {
    const code = socket.data.roomCode;
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < 5; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Could not allocate a unique room code");
  }
}
