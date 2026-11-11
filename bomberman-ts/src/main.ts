/**
 * Main Application Entry Point
 * Front-end screens (menu, level select, settings, online rooms) plus the game
 * loop, input dispatch, timer configuration and DOM HUD synchronization.
 */
import {
  DIR_NONE,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  Direction,
} from "./constants";
import { GameEngine } from "./game";
import { CanvasRenderer } from "./renderer";
import { sound } from "./sound";
import { LEVELS, LevelId, getLevel } from "./levels";
import { MultiplayerClient } from "./net/multiplayerClient";
import { MultiplayerView } from "./net/multiplayerView";
import {
  GameSnapshot,
  MatchResult,
  MatchStartPayload,
  RoomConfig,
  RoomState,
} from "./net/protocol";

type ScreenId = "menu" | "levels" | "settings" | "online" | "lobby" | "game";
type PlayMode = "solo" | "duo";
type MatchMode = "local" | "online";
type StatusKind = "" | "success" | "error";

const PREVENT_DEFAULT_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "NumpadEnter",
]);

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const PLAYER_NAME_STORAGE_KEY = "bomberman-player-name";

class BombermanApp {
  private game: GameEngine;
  private renderer: CanvasRenderer;
  private lastTime: number = 0;
  private activeKeys: Set<string> = new Set();
  private numBots: number = 3;
  private matchDuration: number = 180; // Default 3 mins
  private levelId: LevelId = "classic";
  private playMode: PlayMode = "solo";
  private screen: ScreenId = "menu";
  private matchMode: MatchMode = "local";

  // Online room state
  private online = new MultiplayerClient();
  private onlineView = new MultiplayerView();
  private onlineRoom: RoomState | null = null;
  private onlineResult: MatchResult | null = null;
  private onlineCombatantSignature = "";
  private lastOnlineDir: Direction = DIR_NONE;
  private onlineStatusTimer: number | null = null;

  // Front-end screens
  private menuScreen!: HTMLElement;
  private levelScreen!: HTMLElement;
  private settingsScreen!: HTMLElement;
  private onlineScreen!: HTMLElement;
  private lobbyScreen!: HTMLElement;
  private gameShell!: HTMLElement;
  private levelCardsEl!: HTMLElement;
  private levelScreenTitle!: HTMLElement;
  private levelScreenSubtitle!: HTMLElement;
  private levelScreenHint!: HTMLElement;
  private menuLevelLabel!: HTMLElement;
  private levelBadgeEl!: HTMLElement;
  private settingsSoundBtn!: HTMLButtonElement;
  private settingsDebugBtn!: HTMLButtonElement;
  private settingsTimeSelect!: HTMLSelectElement;
  private settingsBotSelect!: HTMLSelectElement;

  // Online lobby elements
  private onlineNameInput!: HTMLInputElement;
  private joinCodeInput!: HTMLInputElement;
  private onlineStatusEl!: HTMLElement;
  private createRoomBtn!: HTMLButtonElement;
  private joinRoomBtn!: HTMLButtonElement;
  private lobbyCodeEl!: HTMLElement;
  private lobbySubtitleEl!: HTMLElement;
  private lobbyPlayersEl!: HTMLElement;
  private lobbyCountEl!: HTMLElement;
  private lobbyFillBotsEl!: HTMLInputElement;
  private lobbyTimeEl!: HTMLSelectElement;
  private lobbyLevelEl!: HTMLSelectElement;
  private lobbyStartBtn!: HTMLButtonElement;
  private lobbyHostHintEl!: HTMLElement;
  private lobbyStatusEl!: HTMLElement;
  private hostSettingsEl!: HTMLElement;

  // HUD elements
  private timerEl!: HTMLElement;
  private timerLabelEl!: HTMLElement;
  private suddenDeathBadgeEl!: HTMLElement;
  private p1BadgeEl!: HTMLElement;
  private p1NameEl!: HTMLElement;
  private p1BombsEl!: HTMLElement;
  private p1PowerEl!: HTMLElement;
  private p1SpeedEl!: HTMLElement;
  private p1StatusEl!: HTMLElement;
  private objectiveTextEl!: HTMLElement;
  private p2RowEl!: HTMLElement;
  private p2StatusEl!: HTMLElement;
  private p2StatsEl!: HTMLElement;
  private p2ControlHintEl!: HTMLElement;
  private aliveCounterEl!: HTMLElement;
  private botCardsContainer!: HTMLElement;
  private endModalEl!: HTMLElement;
  private endTitleEl!: HTMLElement;
  private endSubtitleEl!: HTMLElement;
  private endIconEl!: HTMLElement;
  private endWaitHintEl!: HTMLElement;
  private playAgainBtn!: HTMLButtonElement;
  private changeLevelBtn!: HTMLButtonElement;
  private endMenuBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private debugBtn!: HTMLButtonElement;
  private timeSelect!: HTMLSelectElement;
  private botSelect!: HTMLSelectElement;

  private readonly loopFrame = (time: number) => this.gameLoop(time);

  constructor() {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    this.renderer = new CanvasRenderer(canvas);
    this.game = new GameEngine();
    (window as unknown as { __game: GameEngine }).__game = this.game;

    this.bindDomElements();
    this.setupEventListeners();
    this.setupOnlineClient();
    this.prefillName();
    this.startMatch();
    this.showScreen("menu");
    this.applyInviteLink();
    requestAnimationFrame(this.loopFrame);
  }

  private bindDomElements() {
    this.menuScreen = document.getElementById("mainMenuScreen")!;
    this.levelScreen = document.getElementById("levelSelectScreen")!;
    this.settingsScreen = document.getElementById("settingsScreen")!;
    this.onlineScreen = document.getElementById("onlineScreen")!;
    this.lobbyScreen = document.getElementById("lobbyScreen")!;
    this.gameShell = document.getElementById("gameShell")!;
    this.levelCardsEl = document.getElementById("levelCards")!;
    this.levelScreenTitle = document.getElementById("levelScreenTitle")!;
    this.levelScreenSubtitle = document.getElementById("levelScreenSubtitle")!;
    this.levelScreenHint = document.getElementById("levelScreenHint")!;
    this.menuLevelLabel = document.getElementById("menuLevelLabel")!;
    this.levelBadgeEl = document.getElementById("levelBadge")!;
    this.settingsSoundBtn = document.getElementById(
      "settingsSoundBtn",
    ) as HTMLButtonElement;
    this.settingsDebugBtn = document.getElementById(
      "settingsDebugBtn",
    ) as HTMLButtonElement;
    this.settingsTimeSelect = document.getElementById(
      "settingsTime",
    ) as HTMLSelectElement;
    this.settingsBotSelect = document.getElementById(
      "settingsBots",
    ) as HTMLSelectElement;

    this.onlineNameInput = document.getElementById(
      "onlineName",
    ) as HTMLInputElement;
    this.joinCodeInput = document.getElementById(
      "joinCode",
    ) as HTMLInputElement;
    this.onlineStatusEl = document.getElementById("onlineStatus")!;
    this.createRoomBtn = document.getElementById(
      "createRoomBtn",
    ) as HTMLButtonElement;
    this.joinRoomBtn = document.getElementById(
      "joinRoomBtn",
    ) as HTMLButtonElement;
    this.lobbyCodeEl = document.getElementById("lobbyCode")!;
    this.lobbySubtitleEl = document.getElementById("lobbySubtitle")!;
    this.lobbyPlayersEl = document.getElementById("lobbyPlayers")!;
    this.lobbyCountEl = document.getElementById("lobbyCount")!;
    this.lobbyFillBotsEl = document.getElementById(
      "lobbyFillBots",
    ) as HTMLInputElement;
    this.lobbyTimeEl = document.getElementById(
      "lobbyTime",
    ) as HTMLSelectElement;
    this.lobbyLevelEl = document.getElementById(
      "lobbyLevel",
    ) as HTMLSelectElement;
    this.lobbyStartBtn = document.getElementById(
      "lobbyStartBtn",
    ) as HTMLButtonElement;
    this.lobbyHostHintEl = document.getElementById("lobbyHostHint")!;
    this.lobbyStatusEl = document.getElementById("lobbyStatus")!;
    this.hostSettingsEl = document.getElementById("hostSettings")!;

    this.timerEl = document.getElementById("matchTimer")!;
    this.timerLabelEl = document.getElementById("timerLabel")!;
    this.suddenDeathBadgeEl = document.getElementById("suddenDeathBadge")!;
    this.p1BadgeEl = document.getElementById("p1Badge")!;
    this.p1NameEl = document.getElementById("p1Name")!;
    this.p1BombsEl = document.getElementById("p1Bombs")!;
    this.p1PowerEl = document.getElementById("p1Power")!;
    this.p1SpeedEl = document.getElementById("p1Speed")!;
    this.p1StatusEl = document.getElementById("p1Status")!;
    this.objectiveTextEl = document.getElementById("objectiveText")!;
    this.p2RowEl = document.getElementById("p2Row")!;
    this.p2StatusEl = document.getElementById("p2Status")!;
    this.p2StatsEl = document.getElementById("p2Stats")!;
    this.p2ControlHintEl = document.getElementById("p2ControlHint")!;
    this.aliveCounterEl = document.getElementById("aliveCounter")!;
    this.botCardsContainer = document.getElementById("botCardsContainer")!;
    this.endModalEl = document.getElementById("endModal")!;
    this.endTitleEl = document.getElementById("endTitle")!;
    this.endSubtitleEl = document.getElementById("endSubtitle")!;
    this.endIconEl = document.getElementById("endIcon")!;
    this.endWaitHintEl = document.getElementById("endWaitHint")!;
    this.playAgainBtn = document.getElementById(
      "playAgainBtn",
    ) as HTMLButtonElement;
    this.changeLevelBtn = document.getElementById(
      "changeLevelBtn",
    ) as HTMLButtonElement;
    this.endMenuBtn = document.getElementById(
      "endMenuBtn",
    ) as HTMLButtonElement;
    this.muteBtn = document.getElementById("muteBtn") as HTMLButtonElement;
    this.debugBtn = document.getElementById("debugBtn") as HTMLButtonElement;
    this.timeSelect = document.getElementById(
      "timeLimitSelect",
    ) as HTMLSelectElement;
    this.botSelect = document.getElementById(
      "botCountSelect",
    ) as HTMLSelectElement;
  }

  private setupEventListeners() {
    // Front-end navigation
    document.getElementById("startGameBtn")?.addEventListener("click", () => {
      this.openLevelSelect("solo");
    });
    document.getElementById("multiplayerBtn")?.addEventListener("click", () => {
      this.openLevelSelect("duo");
    });
    document.getElementById("onlineBtn")?.addEventListener("click", () => {
      this.openOnlineScreen();
    });
    document.getElementById("settingsBtn")?.addEventListener("click", () => {
      this.syncSettingsControls();
      this.showScreen("settings");
    });
    document
      .getElementById("levelBackBtn")
      ?.addEventListener("click", () => this.showScreen("menu"));
    document
      .getElementById("settingsBackBtn")
      ?.addEventListener("click", () => this.showScreen("menu"));
    document
      .getElementById("onlineBackBtn")
      ?.addEventListener("click", () => this.leaveOnline(false));
    document
      .getElementById("menuBtn")
      ?.addEventListener("click", () => this.goToMenu());
    document.getElementById("endMenuBtn")?.addEventListener("click", () => {
      if (this.matchMode === "online") {
        this.leaveOnline(false);
        return;
      }
      this.goToMenu();
    });

    // Settings
    this.settingsSoundBtn.addEventListener("click", () => this.toggleSound());
    this.settingsDebugBtn.addEventListener("click", () => this.toggleDebug());
    this.settingsTimeSelect.addEventListener("change", () => {
      this.matchDuration = parseInt(this.settingsTimeSelect.value, 10);
      this.timeSelect.value = this.settingsTimeSelect.value;
    });
    this.settingsBotSelect.addEventListener("change", () => {
      this.numBots = parseInt(this.settingsBotSelect.value, 10);
      this.botSelect.value = this.settingsBotSelect.value;
    });

    // Online entry
    this.createRoomBtn.addEventListener("click", () => {
      void this.createOnlineRoom();
    });
    this.joinRoomBtn.addEventListener("click", () => {
      void this.joinOnlineRoom();
    });
    this.onlineNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.createOnlineRoom();
    });
    this.joinCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.joinOnlineRoom();
    });
    this.joinCodeInput.addEventListener("input", () => {
      this.joinCodeInput.value = this.joinCodeInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5);
    });

    // Lobby
    document.getElementById("lobbyLeaveBtn")?.addEventListener("click", () => {
      this.leaveOnline(true);
    });
    document.getElementById("copyInviteBtn")?.addEventListener("click", () => {
      void this.copyInviteLink();
    });
    this.lobbyFillBotsEl.addEventListener("change", () => {
      void this.configureRoom({ fillBots: this.lobbyFillBotsEl.checked });
    });
    this.lobbyTimeEl.addEventListener("change", () => {
      void this.configureRoom({
        matchDuration: parseInt(this.lobbyTimeEl.value, 10),
      });
    });
    this.lobbyLevelEl.addEventListener("change", () => {
      void this.configureRoom({ level: this.lobbyLevelEl.value as LevelId });
    });
    this.lobbyStartBtn.addEventListener("click", () => {
      void this.startOnlineMatch();
    });

    // Keyboard inputs
    window.addEventListener("keydown", (e) => {
      this.handleKeyDown(e);
    });

    window.addEventListener("keyup", (e) => {
      this.activeKeys.delete(e.code);
      if (this.matchMode === "online" && this.screen === "game") {
        this.sendOnlineDirection();
      }
    });

    window.addEventListener("blur", () => {
      this.activeKeys.clear();
      if (this.matchMode === "online" && this.screen === "game") {
        this.sendOnlineDirection(true);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (
        document.hidden &&
        this.matchMode === "online" &&
        this.screen === "game"
      ) {
        this.activeKeys.clear();
        this.sendOnlineDirection(true);
      }
    });

    // In-game buttons
    document
      .getElementById("restartBtn")
      ?.addEventListener("click", () => this.startMatch());
    this.playAgainBtn.addEventListener("click", () => {
      if (this.matchMode === "online") {
        void this.onlineRematch();
        return;
      }
      this.endModalEl.classList.add("hidden");
      this.startMatch();
    });
    this.changeLevelBtn.addEventListener("click", () => {
      if (this.matchMode === "online") {
        void this.onlineBackToLobby();
        return;
      }
      this.endModalEl.classList.add("hidden");
      this.openLevelSelect(this.playMode);
    });

    this.muteBtn?.addEventListener("click", () => this.toggleSound());
    this.debugBtn?.addEventListener("click", () => this.toggleDebug());

    // Bot count selector
    this.botSelect?.addEventListener("change", () => {
      this.numBots = parseInt(this.botSelect.value, 10);
      this.settingsBotSelect.value = this.botSelect.value;
      this.startMatch();
    });

    // Time limit selector
    this.timeSelect?.addEventListener("change", () => {
      this.matchDuration = parseInt(this.timeSelect.value, 10);
      this.settingsTimeSelect.value = this.timeSelect.value;
      this.startMatch();
    });
  }

  private setupOnlineClient() {
    this.online.setHandlers({
      onDisconnect: (reason) => this.handleOnlineDisconnect(reason),
      onRoomState: (state) => this.handleRoomState(state),
      onMatchStart: (payload) => this.handleMatchStart(payload),
      onSnapshot: (snapshot) => this.handleSnapshot(snapshot),
      onMatchEnd: (result) => this.handleMatchEnd(result),
      onError: (message) => this.showOnlineStatus(message, "error"),
    });
  }

  // ---------------- Screen flow ----------------

  private showScreen(id: ScreenId) {
    this.screen = id;
    this.menuScreen.classList.toggle("hidden", id !== "menu");
    this.levelScreen.classList.toggle("hidden", id !== "levels");
    this.settingsScreen.classList.toggle("hidden", id !== "settings");
    this.onlineScreen.classList.toggle("hidden", id !== "online");
    this.lobbyScreen.classList.toggle("hidden", id !== "lobby");
    this.gameShell.classList.toggle("hidden", id !== "game");
    if (id !== "game") {
      this.game.isPaused = true;
      if (this.matchMode === "online") this.sendOnlineDirection(true);
    }
  }

  private openLevelSelect(mode: PlayMode) {
    this.playMode = mode;
    this.levelScreenTitle.textContent =
      mode === "solo" ? "Select Level" : "Local Duo — Select Level";
    this.levelScreenSubtitle.textContent =
      mode === "solo"
        ? "Level 1 is the arena exactly as it plays today. Level Impossible fields the predictive kill squad."
        : "Local duo: Player 1 and Player 2 share this keyboard against the bot squad.";
    this.levelScreenHint.textContent =
      mode === "solo"
        ? "Move: WASD or Arrow keys • Bomb: Space • Pause: P • Menu: Esc"
        : "Player 1: WASD + Space • Player 2: Arrow keys + Enter • Pause: P • Menu: Esc";
    this.renderLevelCards();
    this.showScreen("levels");
  }

  private renderLevelCards() {
    this.levelCardsEl.innerHTML = "";
    for (const level of LEVELS) {
      const card = document.createElement("article");
      card.className = "level-card";
      card.style.setProperty("--level-accent", level.accent);
      card.innerHTML = `
        <header class="level-card-head">
          <div>
            <span class="level-diff">${level.difficulty}</span>
            <h3>${level.name}</h3>
            <p class="level-tagline">${level.tagline}</p>
          </div>
          <div class="level-emblem">${level.id === "classic" ? "1" : "∞"}</div>
        </header>
        <p class="level-desc">${level.description}</p>
        <ul class="level-features">
          ${level.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
        <button class="btn btn-primary btn-large level-play">▶ Play ${level.name}</button>
      `;
      card
        .querySelector(".level-play")
        ?.addEventListener("click", () => this.startLevel(level.id));
      this.levelCardsEl.appendChild(card);
    }
  }

  private startLevel(id: LevelId) {
    this.levelId = id;
    this.startMatch();
    this.showScreen("game");
    this.game.isPaused = false;
  }

  private goToMenu() {
    if (this.matchMode === "online" || this.online.room) {
      this.leaveOnline(false);
      return;
    }
    this.activeKeys.clear();
    this.endModalEl.classList.add("hidden");
    this.showScreen("menu");
  }

  private openOnlineScreen() {
    this.showOnlineStatus("", "");
    this.showScreen("online");
    this.onlineNameInput.focus();
  }

  private prefillName() {
    try {
      const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (saved) this.onlineNameInput.value = saved.slice(0, 16);
    } catch {
      // Local storage may be denied in private browsing; the input still works.
    }
  }

  private applyInviteLink() {
    const code = new URLSearchParams(window.location.search).get("room");
    if (!code) return;
    this.joinCodeInput.value = code.trim().toUpperCase().slice(0, 5);
    this.showScreen("online");
    this.showOnlineStatus(
      "Room code loaded from the invite link. Enter your name and join.",
      "success",
    );
  }

  // ---------------- Online room actions ----------------

  private async createOnlineRoom() {
    if (this.online.room) return;
    this.setOnlineButtonsBusy(true);
    this.showOnlineStatus("Creating room…", "");
    this.online.connect();
    const result = await this.online.createRoom(this.playerName());
    this.setOnlineButtonsBusy(false);

    if (!result.ok) {
      this.showOnlineStatus(result.error, "error");
      return;
    }

    this.matchMode = "online";
    this.onlineRoom = result.data.room;
    this.online.yourSlot = result.data.yourSlot;
    this.renderLobby();
    this.showScreen("lobby");
    this.showOnlineStatus(
      "Room created. Share the code or invite link with your friends.",
      "success",
    );
  }

  private async joinOnlineRoom() {
    if (this.online.room) return;
    const code = this.joinCodeInput.value.trim().toUpperCase();
    if (!code) {
      this.showOnlineStatus("Enter a room code first.", "error");
      return;
    }

    this.setOnlineButtonsBusy(true);
    this.showOnlineStatus("Joining room…", "");
    this.online.connect();
    const result = await this.online.joinRoom(code, this.playerName());
    this.setOnlineButtonsBusy(false);

    if (!result.ok) {
      this.showOnlineStatus(result.error, "error");
      return;
    }

    this.matchMode = "online";
    this.onlineRoom = result.data.room;
    this.online.yourSlot = result.data.yourSlot;
    this.renderLobby();
    this.showScreen("lobby");
    this.showOnlineStatus(
      "Joined the room. Waiting for the host to start…",
      "success",
    );
  }

  private async configureRoom(patch: Partial<RoomConfig>) {
    const result = await this.online.configure(patch);
    if (!result.ok) this.showOnlineStatus(result.error, "error");
  }

  private async startOnlineMatch() {
    const result = await this.online.start(this.lobbyFillBotsEl.checked);
    if (!result.ok) this.showOnlineStatus(result.error, "error");
  }

  private async onlineRematch() {
    const result = await this.online.rematch();
    if (!result.ok) {
      this.showOnlineStatus(result.error, "error");
      this.endWaitHintEl.textContent = result.error;
      this.endWaitHintEl.classList.remove("hidden");
      return;
    }
    this.endModalEl.classList.add("hidden");
  }

  private async onlineBackToLobby() {
    const result = await this.online.backToLobby();
    if (!result.ok) {
      this.showOnlineStatus(result.error, "error");
      this.endWaitHintEl.textContent = result.error;
      this.endWaitHintEl.classList.remove("hidden");
      return;
    }
    this.endModalEl.classList.add("hidden");
    this.showScreen("lobby");
    this.renderLobby();
  }

  private async copyInviteLink() {
    const room = this.online.room ?? this.onlineRoom;
    if (!room) return;

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", room.code);
    const invite = url.toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(invite);
        this.showOnlineStatus(
          "Invite link copied to the clipboard.",
          "success",
        );
      } else {
        window.prompt("Copy this invite link:", invite);
      }
    } catch {
      window.prompt("Copy this invite link:", invite);
    }
  }

  private leaveOnline(showOnlineScreen: boolean) {
    const wasOnline = this.matchMode === "online" || this.online.room !== null;
    this.matchMode = "local";
    this.online.leave();
    this.onlineRoom = null;
    this.onlineResult = null;
    this.onlineView.reset();
    this.onlineView.localSlot = 0;
    this.onlineCombatantSignature = "";
    this.lastOnlineDir = DIR_NONE;
    this.activeKeys.clear();
    this.gameShell.classList.remove("online-match");
    this.endModalEl.classList.add("hidden");
    this.endWaitHintEl.classList.add("hidden");
    this.resetEndModalButtons();
    this.showScreen(showOnlineScreen ? "online" : "menu");
    if (showOnlineScreen) {
      this.showOnlineStatus(
        wasOnline ? "You left the room." : "",
        wasOnline ? "success" : "",
      );
    }
  }

  private handleOnlineDisconnect(reason: string) {
    if (this.matchMode !== "online") return;
    this.matchMode = "local";
    this.online.disconnect();
    this.onlineRoom = null;
    this.onlineResult = null;
    this.onlineView.reset();
    this.onlineCombatantSignature = "";
    this.lastOnlineDir = DIR_NONE;
    this.activeKeys.clear();
    this.gameShell.classList.remove("online-match");
    this.endModalEl.classList.add("hidden");
    this.endWaitHintEl.classList.add("hidden");
    this.resetEndModalButtons();
    this.showScreen("online");
    this.showOnlineStatus(
      `Disconnected from the room${reason ? ` (${reason})` : ""}. Create or join again.`,
      "error",
    );
  }

  private handleRoomState(state: RoomState) {
    this.onlineRoom = state;

    if (state.phase === "lobby") {
      this.renderLobby();
      if (this.screen === "online" || this.screen === "game") {
        this.endModalEl.classList.add("hidden");
        this.showScreen("lobby");
      }
      return;
    }

    if (this.screen === "lobby" || this.screen === "online") {
      this.renderLobby();
    }
  }

  private handleMatchStart(payload: MatchStartPayload) {
    this.matchMode = "online";
    this.onlineRoom = payload.room;
    this.onlineResult = null;
    this.onlineView.localSlot = payload.yourSlot;
    this.onlineView.reset();
    this.onlineView.applySnapshot(payload.snapshot);
    this.onlineView.sync();

    this.lastOnlineDir = DIR_NONE;
    this.activeKeys.clear();
    this.onlineCombatantSignature = this.combatantSignature(
      this.onlineView.game,
    );
    this.renderCombatantCards();

    this.gameShell.classList.add("online-match");
    this.endModalEl.classList.add("hidden");
    this.endWaitHintEl.classList.add("hidden");
    this.resetEndModalButtons();
    this.p2RowEl.classList.add("hidden");
    this.p2ControlHintEl.classList.add("hidden");
    this.objectiveTextEl.textContent =
      "Last bomber standing wins. Bots fill empty seats.";

    const level = getLevel(payload.room.config.level);
    this.levelBadgeEl.textContent = `ONLINE · ${payload.room.code}`;
    this.levelBadgeEl.style.color = level.accent;
    this.levelBadgeEl.style.borderColor = level.accent;

    this.showScreen("game");
    this.renderer.render(this.onlineView.game);
    this.updateHud();
  }

  private handleSnapshot(snapshot: GameSnapshot) {
    if (this.matchMode !== "online") return;
    const previous = this.onlineView.latest;
    this.onlineView.applySnapshot(snapshot);
    this.onlineView.sync();
    this.playOnlineEffects(previous, snapshot);

    const signature = this.combatantSignature(this.onlineView.game);
    if (signature !== this.onlineCombatantSignature) {
      this.onlineCombatantSignature = signature;
      this.renderCombatantCards();
    }
  }

  private handleMatchEnd(result: MatchResult) {
    if (this.matchMode !== "online") return;
    this.onlineResult = result;
    this.onlineView.sync();
    this.updateHud();
    this.showOnlineEndModal(result);
  }

  private playOnlineEffects(previous: GameSnapshot | null, next: GameSnapshot) {
    if (!previous) return;
    if (next.bombs.length > previous.bombs.length) sound.playBombDrop();
    if (next.flames.length > previous.flames.length) sound.playExplosion();

    const previousFlameCells = new Set(
      previous.flames.flatMap((flame) =>
        flame.cells.map(([x, y]) => `${x},${y}`),
      ),
    );
    for (const flame of next.flames) {
      for (const [x, y] of flame.cells) {
        if (previousFlameCells.has(`${x},${y}`)) continue;
        this.onlineView.game.emitExplosion(x, y);
      }
    }

    for (const bomber of next.bombers) {
      const before = previous.bombers.find(
        (entry) => entry.slot === bomber.slot,
      );
      if (!before?.alive || bomber.alive) continue;
      const viewBomber = this.onlineView.game.bombers.find(
        (entry) => entry.idx === bomber.slot,
      );
      if (viewBomber) {
        this.onlineView.game.emitDeath(viewBomber);
        sound.playDeath();
      }
    }
  }

  private renderLobby() {
    const room = this.online.room ?? this.onlineRoom;
    if (!room) return;
    this.onlineRoom = room;

    const humans = room.seats.filter(
      (seat) => seat.id !== null && !seat.isBot,
    ).length;
    const bots = room.seats.filter((seat) => seat.isBot).length;
    const isHost = room.hostId === this.online.id;

    this.lobbyCodeEl.textContent = room.code;
    this.lobbyCountEl.textContent = `${humans} / ${room.maxPlayers}`;

    if (room.phase === "lobby") {
      const empty = room.maxPlayers - humans;
      this.lobbySubtitleEl.textContent =
        humans === 1
          ? "Waiting for players…"
          : `${humans} players in the room${bots > 0 ? ` · ${bots} bots` : ""}`;
      if (isHost && empty > 0 && room.config.fillBots) {
        this.lobbySubtitleEl.textContent += ` · ${empty} empty seat${empty === 1 ? "" : "s"} will be bots`;
      }
    } else if (room.phase === "playing") {
      this.lobbySubtitleEl.textContent = "Starting match…";
    } else {
      this.lobbySubtitleEl.textContent = "Match complete";
    }

    this.lobbyPlayersEl.innerHTML = "";
    for (const seat of room.seats) {
      const item = document.createElement("li");
      item.className = "lobby-player";
      if (!seat.id && !seat.isBot) item.classList.add("empty");
      if (seat.id === this.online.id) item.classList.add("you");

      const dot = document.createElement("span");
      dot.className = "lobby-seat-color";
      dot.style.color = seat.color;

      const copy = document.createElement("span");
      copy.className = "lobby-player-copy";

      const name = document.createElement("span");
      name.className = "lobby-player-name";
      name.textContent = seat.name || "Open slot";

      const meta = document.createElement("span");
      meta.className = "lobby-player-meta";
      meta.textContent = seat.isBot
        ? `Bot · Seat ${seat.slot + 1}`
        : !seat.id
          ? `Open slot · Seat ${seat.slot + 1}`
          : seat.connected
            ? `${seat.isHost ? "Host" : "Player"} · Seat ${seat.slot + 1}`
            : `Disconnected · Seat ${seat.slot + 1}`;

      copy.append(name, meta);

      const tags = document.createElement("span");
      tags.className = "lobby-player-tags";
      if (seat.isHost) tags.appendChild(this.lobbyTag("HOST", "host"));
      if (seat.id === this.online.id)
        tags.appendChild(this.lobbyTag("YOU", "you"));
      if (seat.isBot) tags.appendChild(this.lobbyTag("BOT", "bot"));

      item.append(dot, copy, tags);
      this.lobbyPlayersEl.appendChild(item);
    }

    this.lobbyFillBotsEl.checked = room.config.fillBots;
    this.lobbyTimeEl.value = String(room.config.matchDuration);
    this.lobbyLevelEl.value = room.config.level;

    this.lobbyFillBotsEl.disabled = !isHost;
    this.lobbyTimeEl.disabled = !isHost;
    this.lobbyLevelEl.disabled = !isHost;
    this.lobbyStartBtn.classList.toggle("hidden", !isHost);
    this.hostSettingsEl.classList.toggle("host-disabled", !isHost);
    this.lobbyHostHintEl.textContent = isHost
      ? "You are the host. Start when everyone is ready."
      : "Only the host can change settings or start the match.";
  }

  private lobbyTag(text: string, kind: string): HTMLSpanElement {
    const tag = document.createElement("span");
    tag.className = `lobby-tag ${kind}`;
    tag.textContent = text;
    return tag;
  }

  private playerName(): string {
    const name = this.onlineNameInput.value.trim().slice(0, 16) || "Player";
    this.onlineNameInput.value = name;
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } catch {
      // Ignore storage denials.
    }
    return name;
  }

  private setOnlineButtonsBusy(busy: boolean) {
    this.createRoomBtn.disabled = busy;
    this.joinRoomBtn.disabled = busy;
    this.createRoomBtn.textContent = busy ? "Working…" : "Create Room";
    this.joinRoomBtn.textContent = busy ? "Working…" : "Join Room";
  }

  private showOnlineStatus(message: string, kind: StatusKind = "") {
    const className = `online-status${kind ? ` ${kind}` : ""}`;
    this.onlineStatusEl.textContent = message;
    this.lobbyStatusEl.textContent = message;
    this.onlineStatusEl.className = className;
    this.lobbyStatusEl.className = className;

    if (this.onlineStatusTimer !== null) {
      window.clearTimeout(this.onlineStatusTimer);
      this.onlineStatusTimer = null;
    }
    if (message && kind !== "error") {
      this.onlineStatusTimer = window.setTimeout(() => {
        if (this.onlineStatusEl.textContent === message) {
          this.onlineStatusEl.textContent = "";
          this.lobbyStatusEl.textContent = "";
        }
        this.onlineStatusTimer = null;
      }, 8000);
    }
  }

  // ---------------- Match control ----------------

  public startMatch() {
    this.matchMode = "local";
    this.endModalEl.classList.add("hidden");
    this.endWaitHintEl.classList.add("hidden");
    this.resetEndModalButtons();
    this.gameShell.classList.remove("online-match");
    this.objectiveTextEl.textContent =
      "Eliminate all bots to Win! If you fall, it's Defeat (No Draws).";

    this.game.startMatch(this.numBots, this.matchDuration, {
      level: this.levelId,
      humanCount: this.playMode === "duo" ? 2 : 1,
    });

    const level = getLevel(this.levelId);
    this.levelBadgeEl.textContent = level.name.toUpperCase();
    this.levelBadgeEl.style.color = level.accent;
    this.levelBadgeEl.style.borderColor = level.accent;
    this.menuLevelLabel.textContent = level.name;

    this.p1BadgeEl.textContent = "PLAYER 1";
    this.p1NameEl.textContent = this.game.bombers[0]?.name ?? "White Bomber";
    this.p2RowEl.classList.toggle("hidden", this.game.humanCount < 2);
    this.p2ControlHintEl.classList.toggle("hidden", this.game.humanCount < 2);
    this.botSelect.value = String(this.numBots);
    this.timeSelect.value = String(this.matchDuration);
    this.renderCombatantCards();
  }

  private syncSettingsControls() {
    this.settingsTimeSelect.value = String(this.matchDuration);
    this.settingsBotSelect.value = String(this.numBots);
    this.setSoundLabel();
    this.setDebugLabel();
  }

  private toggleSound() {
    sound.toggleMute();
    this.setSoundLabel();
  }

  private setSoundLabel() {
    const muted = sound.isMuted();
    const label = muted ? "🔇 Sound: OFF" : "🔊 Sound: ON";
    this.muteBtn.textContent = label;
    this.muteBtn.classList.toggle("active", !muted);
    this.settingsSoundBtn.textContent = label;
    this.settingsSoundBtn.classList.toggle("active", !muted);
  }

  private toggleDebug() {
    this.renderer.showDebug = !this.renderer.showDebug;
    this.setDebugLabel();
  }

  private setDebugLabel() {
    const label = this.renderer.showDebug
      ? "🛠️ AI Debug: ON"
      : "🛠️ AI Debug: OFF";
    this.debugBtn.textContent = label;
    this.debugBtn.classList.toggle("active", this.renderer.showDebug);
    this.settingsDebugBtn.textContent = label;
    this.settingsDebugBtn.classList.toggle("active", this.renderer.showDebug);
  }

  private resetEndModalButtons() {
    this.playAgainBtn.classList.remove("hidden");
    this.playAgainBtn.textContent = "🎮 Play Again";
    this.changeLevelBtn.classList.remove("hidden");
    this.changeLevelBtn.textContent = "🗺️ Change Level";
    this.endMenuBtn.textContent = "☰ Menu";
    this.endWaitHintEl.classList.add("hidden");
    this.endWaitHintEl.textContent = "Waiting for the host to start a rematch…";
  }

  // ---------------- Input ----------------

  private handleKeyDown(e: KeyboardEvent) {
    if (this.screen !== "game") {
      if (e.code === "Escape") {
        if (this.screen === "lobby") {
          this.leaveOnline(true);
        } else if (this.screen === "online") {
          this.showScreen("menu");
        } else {
          this.showScreen("menu");
        }
      }
      return;
    }

    if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();

    if (this.matchMode === "online") {
      if (e.code === "Space") {
        if (!e.repeat) this.online.sendBomb();
        return;
      }
      if (e.code === "Escape") {
        this.leaveOnline(false);
        return;
      }
      if (e.code === "KeyM") {
        this.toggleSound();
        return;
      }
      if (MOVEMENT_KEYS.has(e.code)) {
        this.activeKeys.add(e.code);
        this.sendOnlineDirection();
      }
      return;
    }

    this.activeKeys.add(e.code);

    const duo = this.game.humanCount > 1;

    if (e.code === "Space") {
      const p1 = this.game.bombers[0];
      if (p1 && p1.alive) this.game.spawnBomb(p1);
    } else if (duo && (e.code === "Enter" || e.code === "NumpadEnter")) {
      const p2 = this.game.bombers[1];
      if (p2 && p2.alive) this.game.spawnBomb(p2);
    } else if (e.code === "KeyR") {
      this.startMatch();
    } else if (e.code === "KeyP") {
      this.game.isPaused = !this.game.isPaused;
    } else if (e.code === "KeyM") {
      this.toggleSound();
    } else if (e.code === "KeyT") {
      // Fast-forward timer to 2s to test sudden death wall drop
      this.game.matchTimer = 2;
    } else if (e.code === "F1") {
      e.preventDefault();
      this.toggleDebug();
    } else if (e.code === "Escape") {
      this.goToMenu();
    }
  }

  private processPlayerInput() {
    const p1 = this.game.bombers[0];
    if (p1 && p1.alive) {
      let dir: Direction = DIR_NONE;
      const up = this.activeKeys.has("ArrowUp") || this.activeKeys.has("KeyW");
      const down =
        this.activeKeys.has("ArrowDown") || this.activeKeys.has("KeyS");
      const left =
        this.activeKeys.has("ArrowLeft") || this.activeKeys.has("KeyA");
      const right =
        this.activeKeys.has("ArrowRight") || this.activeKeys.has("KeyD");

      if (up) dir = DIR_UP;
      else if (down) dir = DIR_DOWN;
      else if (left) dir = DIR_LEFT;
      else if (right) dir = DIR_RIGHT;

      p1.moveCommand(dir);
    }

    // Local duo: Player 2 owns the arrow keys
    if (this.game.humanCount > 1) {
      const p2 = this.game.bombers[1];
      if (p2 && p2.alive) {
        let dir: Direction = DIR_NONE;
        if (this.activeKeys.has("ArrowUp")) dir = DIR_UP;
        else if (this.activeKeys.has("ArrowDown")) dir = DIR_DOWN;
        else if (this.activeKeys.has("ArrowLeft")) dir = DIR_LEFT;
        else if (this.activeKeys.has("ArrowRight")) dir = DIR_RIGHT;
        p2.moveCommand(dir);
      }
    }
  }

  private currentOnlineDirection(): Direction {
    if (this.activeKeys.has("ArrowUp") || this.activeKeys.has("KeyW"))
      return DIR_UP;
    if (this.activeKeys.has("ArrowDown") || this.activeKeys.has("KeyS"))
      return DIR_DOWN;
    if (this.activeKeys.has("ArrowLeft") || this.activeKeys.has("KeyA"))
      return DIR_LEFT;
    if (this.activeKeys.has("ArrowRight") || this.activeKeys.has("KeyD"))
      return DIR_RIGHT;
    return DIR_NONE;
  }

  private sendOnlineDirection(force = false) {
    if (this.matchMode !== "online") return;
    const dir = this.currentOnlineDirection();
    if (!force && dir === this.lastOnlineDir) return;
    this.lastOnlineDir = dir;
    this.online.sendDirection(dir);
  }

  // ---------------- Loop & HUD ----------------

  private activeGame(): GameEngine {
    return this.matchMode === "online" ? this.onlineView.game : this.game;
  }

  private gameLoop(time: number) {
    if (this.lastTime === 0) this.lastTime = time;
    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    if (this.screen === "game") {
      if (this.matchMode === "online") {
        this.onlineView.sync();
        this.onlineView.game.updateParticles(dt);
        this.renderer.render(this.onlineView.game);
      } else {
        this.processPlayerInput();
        this.game.update(dt);
        this.renderer.render(this.game);
      }
      this.updateHud();
    }

    requestAnimationFrame(this.loopFrame);
  }

  private updateHud() {
    const game = this.activeGame();

    // 1. Timer display
    const mins = Math.floor(Math.max(0, game.matchTimer) / 60);
    const secs = Math.floor(Math.max(0, game.matchTimer) % 60);
    this.timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

    if (game.isUnlimitedTime) {
      this.timerLabelEl.textContent = "ELAPSED TIME";
      this.suddenDeathBadgeEl.classList.add("hidden");
      this.timerEl.style.color = "";
    } else if (game.isSuddenDeath) {
      this.timerLabelEl.textContent = `HURRY UP (RING ${game.suddenDeathRing})`;
      this.suddenDeathBadgeEl.classList.remove("hidden");
      this.timerEl.style.color = "#EF4444";
    } else {
      this.timerLabelEl.textContent = "ROUND TIME";
      this.suddenDeathBadgeEl.classList.add("hidden");
      this.timerEl.style.color = "";
    }

    // 2. Local player stats
    if (this.matchMode === "online") {
      const local = this.onlineView.localBomber();
      if (local) {
        this.p1BadgeEl.textContent = `YOU · SLOT ${local.idx + 1}`;
        this.p1NameEl.textContent = local.name;
        this.p1BombsEl.textContent = `${local.bombsActive}/${local.bombLimit}`;
        this.p1PowerEl.textContent = `${local.power}`;
        this.p1SpeedEl.textContent = `${Math.round(local.speed)}`;
        this.p1StatusEl.textContent = local.alive ? "ALIVE" : "ELIMINATED";
        this.p1StatusEl.className = local.alive
          ? "status-alive"
          : "status-dead";
      }
      this.p2RowEl.classList.add("hidden");
      this.p2ControlHintEl.classList.add("hidden");
    } else {
      const p1 = game.bombers[0];
      if (p1) {
        this.p1BadgeEl.textContent = "PLAYER 1";
        this.p1NameEl.textContent = p1.name;
        this.p1BombsEl.textContent = `${p1.bombsActive}/${p1.bombLimit}`;
        this.p1PowerEl.textContent = `${p1.power}`;
        this.p1SpeedEl.textContent = `${Math.round(p1.speed)}`;
        this.p1StatusEl.textContent = p1.alive ? "ALIVE" : "ELIMINATED";
        this.p1StatusEl.className = p1.alive ? "status-alive" : "status-dead";
      }

      if (game.humanCount > 1) {
        const p2 = game.bombers[1];
        if (p2) {
          this.p2StatusEl.textContent = p2.alive ? "ALIVE" : "ELIMINATED";
          this.p2StatusEl.className = p2.alive ? "status-alive" : "status-dead";
          this.p2StatsEl.textContent = `💣 ${p2.bombsActive}/${p2.bombLimit} · 🔥 ${p2.power} · ⚡ ${Math.round(p2.speed)}`;
        }
      }
    }

    // 3. Combatant status counts
    const totalBombers = game.bombers.length;
    const aliveCount = game.bombers.filter((b) => b.alive).length;
    this.aliveCounterEl.textContent = `${aliveCount} / ${totalBombers} Alive`;

    // 4. Combatant status cards
    for (const bomber of game.bombers) {
      const statusEl = document.getElementById(
        `combatant-status-${bomber.idx}`,
      );
      const cardEl = document.getElementById(`combatant-card-${bomber.idx}`);
      if (statusEl) {
        statusEl.textContent = bomber.alive ? "ALIVE" : "ELIMINATED";
        statusEl.className = bomber.alive ? "status-alive" : "status-dead";
      }
      if (cardEl) {
        cardEl.classList.toggle("dead-card", !bomber.alive);
      }
    }

    // 5. Game Over Modal (local matches; online is driven by `match:end`)
    if (
      this.matchMode !== "online" &&
      !game.isMatchActive &&
      this.endModalEl.classList.contains("hidden")
    ) {
      this.showEndModal();
    }
  }

  private renderCombatantCards() {
    const game = this.activeGame();
    const combatants =
      this.matchMode === "online"
        ? game.bombers
        : game.bombers.filter((bomber) => bomber.isAi);

    this.botCardsContainer.innerHTML = "";
    for (const bomber of combatants) {
      const card = document.createElement("div");
      card.id = `combatant-card-${bomber.idx}`;
      card.className = "bot-card";
      if (
        this.matchMode === "online" &&
        bomber.idx === this.onlineView.localSlot
      ) {
        card.classList.add("you-card");
      }

      const header = document.createElement("div");
      header.className = "bot-header";

      const badge = document.createElement("span");
      badge.className = "bot-badge";
      badge.style.backgroundColor = bomber.color;
      badge.style.boxShadow = `0 0 10px ${bomber.color}`;

      const name = document.createElement("span");
      name.className = "bot-name";
      name.textContent = bomber.name;

      header.append(badge, name);

      if (this.matchMode === "online") {
        if (bomber.isAi) header.appendChild(this.lobbyTag("BOT", "bot"));
        if (bomber.idx === this.onlineView.localSlot) {
          header.appendChild(this.lobbyTag("YOU", "you"));
        }
      }

      const info = document.createElement("div");
      info.className = "bot-info";
      const status = document.createElement("span");
      status.id = `combatant-status-${bomber.idx}`;
      status.className = "status-alive";
      status.textContent = "ALIVE";
      info.appendChild(status);

      card.append(header, info);
      this.botCardsContainer.appendChild(card);
    }
  }

  private combatantSignature(game: GameEngine): string {
    return game.bombers
      .map(
        (bomber) =>
          `${bomber.idx}:${bomber.name}:${bomber.isAi ? 1 : 0}:${bomber.color}`,
      )
      .join("|");
  }

  private showEndModal() {
    this.endModalEl.classList.remove("hidden");
    this.resetEndModalButtons();

    const level = getLevel(this.game.levelId);
    const winner = this.game.winner;

    if (winner) {
      this.endIconEl.textContent = "🏆";
      this.endTitleEl.textContent = "VICTORY!";
      this.endTitleEl.style.color = "#38BDF8";
      this.endSubtitleEl.textContent =
        this.game.humanCount > 1
          ? `${winner.name} survived ${level.name} — the bot squad is down.`
          : `You eliminated the bot squad on ${level.name}! Champion of the Arena.`;
    } else {
      this.endIconEl.textContent = "💀";
      this.endTitleEl.textContent = "DEFEAT!";
      this.endTitleEl.style.color = "#EF4444";
      this.endSubtitleEl.textContent =
        this.game.humanCount > 1
          ? `The squad wiped out both players on ${level.name}.`
          : `White Bomber was eliminated on ${level.name}! The bot squad prevailed.`;
    }
  }

  private showOnlineEndModal(result: MatchResult) {
    const room = this.online.room ?? this.onlineRoom;
    const isHost = room?.hostId === this.online.id;
    const localSlot = this.online.yourSlot ?? this.onlineView.localSlot;
    const localStanding = result.standings.find(
      (standing) => standing.slot === localSlot,
    );
    const winner = result.winner;
    const localWon = winner?.slot === localSlot;
    const levelName = getLevel(this.onlineView.game.levelId).name;

    this.endModalEl.classList.remove("hidden");
    this.endWaitHintEl.classList.add("hidden");
    this.endWaitHintEl.textContent = "Waiting for the host to start a rematch…";

    if (winner && localWon) {
      this.endIconEl.textContent = "🏆";
      this.endTitleEl.textContent = "VICTORY!";
      this.endTitleEl.style.color = "#38BDF8";
      this.endSubtitleEl.textContent = `You were the last bomber standing in ${levelName}.`;
      sound.playVictory();
    } else if (winner) {
      this.endIconEl.textContent = winner.isBot ? "🤖" : "💀";
      this.endTitleEl.textContent = winner.isBot ? "BOT VICTORY" : "DEFEAT";
      this.endTitleEl.style.color = "#EF4444";
      this.endSubtitleEl.textContent = `${winner.name} won the room on ${levelName}.`;
    } else {
      this.endIconEl.textContent = "☠️";
      this.endTitleEl.textContent = "ARENA WIPED";
      this.endTitleEl.style.color = "#EF4444";
      this.endSubtitleEl.textContent =
        result.reason === "abandoned"
          ? "The room was abandoned before a winner could be decided."
          : localStanding?.alive
            ? "No combatant survived the final blast."
            : "Every human bomber was eliminated — the bots took the arena.";
    }

    this.playAgainBtn.classList.toggle("hidden", !isHost);
    this.playAgainBtn.textContent = "🔄 Rematch";
    this.changeLevelBtn.classList.toggle("hidden", !isHost);
    this.changeLevelBtn.textContent = "🏟️ Back to Lobby";
    this.endMenuBtn.textContent = "🚪 Leave Room";
    this.endWaitHintEl.classList.toggle("hidden", Boolean(isHost));
  }
}

// Initialize on DOM ready
window.addEventListener("DOMContentLoaded", () => {
  new BombermanApp();
});
