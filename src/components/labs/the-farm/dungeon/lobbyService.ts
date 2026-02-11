/**
 * Lobby Service — BroadcastChannel-based multiplayer for ZK Dungeon.
 *
 * Uses BroadcastChannel API for real-time cross-tab communication.
 * Both players share a lobby code that maps to the same channel.
 * All game state transitions are broadcast to both players.
 */

// ── Message Types ───────────────────────────────────────────────────────────

export type LobbyMessageType =
    | "LOBBY_CREATED"
    | "PLAYER_JOINED"
    | "PLAYER_READY"
    | "GAME_STARTING"
    | "DOOR_ATTEMPT"
    | "FLOOR_CLEARED"
    | "GATE_CLEAR"
    | "GAME_FINISHED"
    | "PING"
    | "PONG";

export interface LobbyMessage {
    type: LobbyMessageType;
    sender: string; // Player address (short hash or full)
    timestamp: number;
    data?: Record<string, unknown>;
}

export interface LobbyPlayer {
    address: string;
    label: string;
    ready: boolean;
    currentFloor: number;
    lastSeen: number;
}

export interface LobbyState {
    code: string;
    host: LobbyPlayer | null;
    guest: LobbyPlayer | null;
    status: "waiting" | "ready" | "active" | "finished";
    sessionId: number;
}

// ── Channel Management ──────────────────────────────────────────────────────

const CHANNEL_PREFIX = "zk-dungeon-lobby-";

let _channel: BroadcastChannel | null = null;
let _state: LobbyState | null = null;
let _listeners: Array<(msg: LobbyMessage) => void> = [];
let _pingInterval: ReturnType<typeof setInterval> | null = null;

function getChannel(code: string): BroadcastChannel {
    if (_channel) {
        _channel.close();
    }
    _channel = new BroadcastChannel(CHANNEL_PREFIX + code);
    _channel.onmessage = (event: MessageEvent<LobbyMessage>) => {
        handleMessage(event.data);
    };
    return _channel;
}

function broadcast(msg: LobbyMessage) {
    _channel?.postMessage(msg);
}

function handleMessage(msg: LobbyMessage) {
    if (!_state) return;

    switch (msg.type) {
        case "PLAYER_JOINED": {
            if (_state.host && msg.sender !== _state.host.address) {
                _state.guest = {
                    address: msg.sender,
                    label: shortAddr(msg.sender),
                    ready: false,
                    currentFloor: 1,
                    lastSeen: Date.now(),
                };
                _state.status = "ready";
                // Send back acknowledgment so guest knows host exists
                broadcast({
                    type: "PONG",
                    sender: _state.host.address,
                    timestamp: Date.now(),
                    data: { hostAddress: _state.host.address },
                });
            }
            break;
        }
        case "PONG": {
            // Guest receives confirmation that host exists
            if (_state.guest && !_state.host) {
                _state.host = {
                    address: msg.sender,
                    label: shortAddr(msg.sender),
                    ready: true,
                    currentFloor: 1,
                    lastSeen: Date.now(),
                };
            }
            if (_state.host) {
                _state.host.lastSeen = Date.now();
            }
            break;
        }
        case "PING": {
            // Keep-alive from partner
            const partner = _state.host?.address === msg.sender ? _state.host : _state.guest;
            if (partner) {
                partner.lastSeen = Date.now();
            }
            break;
        }
        case "PLAYER_READY": {
            const player = _state.host?.address === msg.sender ? _state.host : _state.guest;
            if (player) {
                player.ready = true;
                player.lastSeen = Date.now();
            }
            break;
        }
        case "GAME_STARTING": {
            _state.status = "active";
            _state.sessionId = (msg.data?.sessionId as number) ?? _state.sessionId;
            break;
        }
        case "FLOOR_CLEARED": {
            const floorPlayer = _state.host?.address === msg.sender ? _state.host : _state.guest;
            if (floorPlayer) {
                floorPlayer.currentFloor = (msg.data?.floor as number) ?? floorPlayer.currentFloor;
                floorPlayer.lastSeen = Date.now();
            }
            break;
        }
        case "GATE_CLEAR": {
            // Partner has cleared a gate floor — relay to listeners
            break;
        }
        case "DOOR_ATTEMPT": {
            // Partner made a door attempt — relay to listeners
            break;
        }
        case "GAME_FINISHED": {
            _state.status = "finished";
            break;
        }
    }

    // Notify all listeners
    for (const listener of _listeners) {
        listener(msg);
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function shortAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr || "???";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Create a new lobby as host.
 */
export function createLobby(lobbyCode: string, hostAddress: string, sessionId: number): LobbyState {
    getChannel(lobbyCode);

    _state = {
        code: lobbyCode,
        host: {
            address: hostAddress,
            label: shortAddr(hostAddress),
            ready: true,
            currentFloor: 1,
            lastSeen: Date.now(),
        },
        guest: null,
        status: "waiting",
        sessionId,
    };

    broadcast({
        type: "LOBBY_CREATED",
        sender: hostAddress,
        timestamp: Date.now(),
        data: { code: lobbyCode, sessionId },
    });

    startPing(hostAddress);
    return _state;
}

/**
 * Join an existing lobby as guest.
 */
export function joinLobby(lobbyCode: string, guestAddress: string): LobbyState {
    getChannel(lobbyCode);

    _state = {
        code: lobbyCode,
        host: null,
        guest: {
            address: guestAddress,
            label: shortAddr(guestAddress),
            ready: true,
            currentFloor: 1,
            lastSeen: Date.now(),
        },
        status: "waiting",
        sessionId: 0,
    };

    broadcast({
        type: "PLAYER_JOINED",
        sender: guestAddress,
        timestamp: Date.now(),
        data: { code: lobbyCode },
    });

    startPing(guestAddress);
    return _state;
}

/**
 * Signal readiness to start the game.
 */
export function signalReady(address: string) {
    broadcast({
        type: "PLAYER_READY",
        sender: address,
        timestamp: Date.now(),
    });
}

/**
 * Broadcast that the game is starting.
 */
export function signalGameStart(address: string, sessionId: number) {
    if (_state) _state.status = "active";
    broadcast({
        type: "GAME_STARTING",
        sender: address,
        timestamp: Date.now(),
        data: { sessionId },
    });
}

/**
 * Broadcast a door attempt result.
 */
export function broadcastDoorAttempt(
    address: string,
    floor: number,
    door: number,
    result: "correct" | "wrong",
    txHash: string | null,
    proofType: string,
) {
    broadcast({
        type: "DOOR_ATTEMPT",
        sender: address,
        timestamp: Date.now(),
        data: { floor, door, result, txHash, proofType },
    });
}

/**
 * Broadcast that a floor has been cleared.
 */
export function broadcastFloorCleared(address: string, floor: number) {
    if (_state) {
        const self = _state.host?.address === address ? _state.host : _state.guest;
        if (self) self.currentFloor = floor;
    }
    broadcast({
        type: "FLOOR_CLEARED",
        sender: address,
        timestamp: Date.now(),
        data: { floor },
    });
}

/**
 * Broadcast gate clear (partner cleared a co-op gate).
 */
export function broadcastGateClear(address: string, floor: number) {
    broadcast({
        type: "GATE_CLEAR",
        sender: address,
        timestamp: Date.now(),
        data: { floor },
    });
}

/**
 * Broadcast game finished.
 */
export function broadcastGameFinished(address: string, won: boolean) {
    if (_state) _state.status = "finished";
    broadcast({
        type: "GAME_FINISHED",
        sender: address,
        timestamp: Date.now(),
        data: { won },
    });
}

/**
 * Subscribe to lobby messages.
 */
export function onMessage(callback: (msg: LobbyMessage) => void): () => void {
    _listeners.push(callback);
    return () => {
        _listeners = _listeners.filter((l) => l !== callback);
    };
}

/**
 * Get current lobby state (reactive snapshot).
 */
export function getLobbyState(): LobbyState | null {
    return _state;
}

/**
 * Check if partner is connected (seen within last 5s).
 */
export function isPartnerConnected(): boolean {
    if (!_state) return false;
    const partner = _state.guest ?? _state.host;
    if (!partner) return false;
    return Date.now() - partner.lastSeen < 5000;
}

/**
 * Destroy the lobby and clean up.
 */
export function destroyLobby() {
    if (_pingInterval) {
        clearInterval(_pingInterval);
        _pingInterval = null;
    }
    if (_channel) {
        _channel.close();
        _channel = null;
    }
    _state = null;
    _listeners = [];
}

// ── Internals ───────────────────────────────────────────────────────────────

function startPing(address: string) {
    if (_pingInterval) clearInterval(_pingInterval);
    _pingInterval = setInterval(() => {
        broadcast({
            type: "PING",
            sender: address,
            timestamp: Date.now(),
        });
    }, 2000);
}
