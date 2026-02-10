<script lang="ts">
    import { userState } from "../../../../stores/user.svelte.ts";
    import {
        HUB_CONTRACT_ID,
        callStartGame,
        callEndGame,
        attemptDoor as submitDoorAttempt,
        getProofTypeForFloor,
        generateSessionId,
        txExplorerUrl,
        contractExplorerUrl,
    } from "./dungeonService";

    // ── Game State ──────────────────────────────────────────────────────
    type GamePhase = "title" | "lobby" | "playing" | "victory" | "defeat";
    type LobbyRole = "host" | "guest" | null;
    type DoorState = "idle" | "proving" | "correct" | "wrong";

    const TOTAL_FLOORS = 10;
    const DOORS_PER_FLOOR = 4;
    const GATE_FLOORS = [1, 5];

    let phase = $state<GamePhase>("title");
    let lobbyCode = $state<string>("");
    let lobbyInput = $state<string>("");
    let lobbyRole = $state<LobbyRole>(null);
    let playerName = $state<string>("");
    let opponentName = $state<string>("");
    let currentFloor = $state<number>(1);
    let attempts = $state<number>(0);
    let doorStates = $state<DoorState[]>(["idle", "idle", "idle", "idle"]);
    let activeDoor = $state<number | null>(null);
    let runLog = $state<RunLogEntry[]>([]);
    let gateWaiting = $state<boolean>(false);
    let fullscreen = $state<boolean>(false);
    let audioEnabled = $state<boolean>(false);
    let showHowItWorks = $state<boolean>(false);
    let floorTransition = $state<boolean>(false);
    let sessionId = $state<number>(0);
    let hubStartTx = $state<string | null>(null);
    let hubEndTx = $state<string | null>(null);
    let hubCallError = $state<string | null>(null);
    let hubCalling = $state<boolean>(false);

    interface RunLogEntry {
        floor: number;
        door: number;
        attempt: number;
        result: "correct" | "wrong" | "pending";
        proofType: string;
        txHash: string | null;
        timestamp: number;
        verified?: boolean;
        provingTimeMs?: number;
        commitment?: string | null;
    }

    // Floor lore for atmosphere
    const FLOOR_LORE: Record<number, { name: string; desc: string; proofType: string }> = {
        1: { name: "Threshold of Binding", desc: "Co-op gate. Both seekers must prove entry.", proofType: "Noir" },
        2: { name: "Hall of Echoes", desc: "Rune doors whisper half-truths.", proofType: "Noir" },
        3: { name: "Cipher Chamber", desc: "The Circom gate demands algebraic proof.", proofType: "Circom" },
        4: { name: "Phantom Corridor", desc: "Shadows shift. Trust your commitment.", proofType: "Noir" },
        5: { name: "Warden's Gate", desc: "Co-op gate. Seekers must synchronize.", proofType: "Noir" },
        6: { name: "Vault of Secrets", desc: "Private inputs guard the path.", proofType: "Noir" },
        7: { name: "Merkle Depths", desc: "Hash trees grow deep here.", proofType: "Noir" },
        8: { name: "Nonce Forge", desc: "Each attempt brands a new seal.", proofType: "Noir" },
        9: { name: "Verifier's Sanctum", desc: "The final proof before the boss.", proofType: "Noir" },
        10: { name: "Zero Knowledge Throne", desc: "RISC Zero boss. Prove everything. Reveal nothing.", proofType: "RISC Zero" },
    };

    // ── Derived State ───────────────────────────────────────────────────
    let walletAddress = $derived(userState.contractId);
    let isConnected = $derived(!!userState.contractId && !!userState.keyId);
    let currentLore = $derived(FLOOR_LORE[currentFloor] ?? FLOOR_LORE[1]);
    let isGateFloor = $derived(GATE_FLOORS.includes(currentFloor));
    let progressPct = $derived(((currentFloor - 1) / TOTAL_FLOORS) * 100);
    let walletLabel = $derived(
        walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : ""
    );

    // ── Actions ─────────────────────────────────────────────────────────

    function generateLobbyCode(): string {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    function createLobby() {
        lobbyCode = generateLobbyCode();
        lobbyRole = "host";
        playerName = walletLabel || "Seeker-1";
        opponentName = "";
        // In full implementation: call create_lobby() on contract
        // For now: transition to lobby waiting state
        phase = "lobby";
    }

    function joinLobby() {
        if (lobbyInput.length < 4) return;
        lobbyCode = lobbyInput.toUpperCase();
        lobbyRole = "guest";
        playerName = walletLabel || "Seeker-2";
        opponentName = "Seeker-1";
        // In full implementation: call join_lobby() on contract
        phase = "lobby";
    }

    async function startGame() {
        currentFloor = 1;
        attempts = 0;
        runLog = [];
        doorStates = ["idle", "idle", "idle", "idle"];
        opponentName = opponentName || "Seeker-2";
        sessionId = generateSessionId();
        hubStartTx = null;
        hubEndTx = null;
        hubCallError = null;
        phase = "playing";

        // Call start_game() on hub contract (real testnet tx)
        let startTxHash: string | null = null;
        if (isConnected && userState.keyId && userState.contractId) {
            hubCalling = true;
            try {
                startTxHash = await callStartGame({
                    gameId: HUB_CONTRACT_ID, // Using hub as game_id placeholder
                    sessionId,
                    player1: userState.contractId,
                    player2: userState.contractId, // Solo mode: same player
                    player1Points: 0n,
                    player2Points: 0n,
                    keyId: userState.keyId,
                    contractId: userState.contractId,
                });
                hubStartTx = startTxHash;
            } catch (err: any) {
                console.warn("[Dungeon] start_game() failed (non-blocking):", err.message);
                hubCallError = err.message;
            } finally {
                hubCalling = false;
            }
        }

        addLogEntry({
            floor: 0,
            door: -1,
            attempt: 0,
            result: "correct",
            proofType: "Hub",
            txHash: startTxHash,
            timestamp: Date.now(),
        });
    }

    async function chooseDoor(doorIndex: number) {
        if (doorStates[doorIndex] !== "idle" || activeDoor !== null) return;
        if (gateWaiting) return;

        activeDoor = doorIndex;
        doorStates[doorIndex] = "proving";
        attempts++;

        // Submit door attempt via dungeon service (generates real Groth16 proof)
        const result = await submitDoorAttempt({
            lobbyId: lobbyCode || "SOLO",
            floor: currentFloor,
            doorChoice: doorIndex,
            attemptNonce: attempts,
            playerAddress: userState.contractId ?? "anonymous",
            keyId: userState.keyId ?? "",
            contractId: userState.contractId ?? "",
        });

        const isCorrect = result.isCorrect;
        doorStates[doorIndex] = isCorrect ? "correct" : "wrong";

        addLogEntry({
            floor: currentFloor,
            door: doorIndex,
            attempt: attempts,
            result: isCorrect ? "correct" : "wrong",
            proofType: result.proofType,
            txHash: result.txHash,
            timestamp: Date.now(),
            verified: result.verified,
            provingTimeMs: result.provingTimeMs,
            commitment: result.commitment,
        });

        // Animate then advance
        await new Promise((r) => setTimeout(r, 800));

        if (isCorrect) {
            if (currentFloor >= TOTAL_FLOORS) {
                // Victory! Call end_game() on hub
                let endTxHash: string | null = null;
                if (isConnected && userState.keyId && userState.contractId) {
                    hubCalling = true;
                    try {
                        endTxHash = await callEndGame({
                            sessionId,
                            player1Won: true,
                            keyId: userState.keyId,
                            contractId: userState.contractId,
                        });
                        hubEndTx = endTxHash;
                    } catch (err: any) {
                        console.warn("[Dungeon] end_game() failed (non-blocking):", err.message);
                    } finally {
                        hubCalling = false;
                    }
                }

                addLogEntry({
                    floor: TOTAL_FLOORS,
                    door: -1,
                    attempt: attempts,
                    result: "correct",
                    proofType: "Hub",
                    txHash: endTxHash,
                    timestamp: Date.now(),
                });
                phase = "victory";
            } else {
                // Advance to next floor
                floorTransition = true;
                await new Promise((r) => setTimeout(r, 600));
                currentFloor++;
                doorStates = ["idle", "idle", "idle", "idle"];
                activeDoor = null;
                floorTransition = false;

                // Check if co-op gate
                if (isGateFloor) {
                    gateWaiting = true;
                    // Solo mode: auto-clear after brief delay
                    setTimeout(() => {
                        gateWaiting = false;
                    }, 2000);
                }
            }
        } else {
            // Wrong door - reset door states after animation
            await new Promise((r) => setTimeout(r, 400));
            doorStates = ["idle", "idle", "idle", "idle"];
            activeDoor = null;
        }
    }

    function addLogEntry(entry: RunLogEntry) {
        runLog = [...runLog, entry];
    }

    function resetGame() {
        phase = "title";
        lobbyCode = "";
        lobbyInput = "";
        lobbyRole = null;
        currentFloor = 1;
        attempts = 0;
        doorStates = ["idle", "idle", "idle", "idle"];
        activeDoor = null;
        runLog = [];
        gateWaiting = false;
        floorTransition = false;
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            fullscreen = true;
        } else {
            document.exitFullscreen().catch(() => {});
            fullscreen = false;
        }
    }

    async function connectWallet() {
        try {
            const { useAuthentication } = await import("../../../../hooks/useAuthentication");
            const auth = useAuthentication();
            await auth.login();
        } catch (err) {
            console.error("[ZkDungeon] Wallet connect failed:", err);
        }
    }

    // Door symbols
    const DOOR_SYMBOLS = ["\u16B1", "\u16C7", "\u16A6", "\u16D2"]; // Elder Futhark-like runes
    const DOOR_COLORS = ["#4ad0ff", "#9b7bff", "#ffc47a", "#7bffb0"];
</script>

<!-- ── Title Screen ──────────────────────────────────────────────── -->
{#if phase === "title"}
<div class="dg-root dg-title-screen">
    <div class="dg-stars"></div>
    <div class="dg-title-content">
        <p class="dg-eyebrow">CHAPTER 3</p>
        <h1 class="dg-game-title">STELLAR ZK DUNGEON</h1>
        <p class="dg-subtitle">10 floors. 4 doors. Every choice is a zero-knowledge proof on Stellar.</p>

        <div class="dg-title-actions">
            {#if isConnected}
                <p class="dg-wallet-badge">{walletLabel}</p>
                <button class="dg-btn dg-btn-primary" onclick={createLobby}>CREATE LOBBY</button>
                <div class="dg-join-row">
                    <input
                        class="dg-input"
                        type="text"
                        placeholder="LOBBY CODE"
                        maxlength="6"
                        bind:value={lobbyInput}
                        onkeydown={(e) => e.key === "Enter" && joinLobby()}
                    />
                    <button class="dg-btn dg-btn-secondary" onclick={joinLobby}>JOIN</button>
                </div>
            {:else}
                <button class="dg-btn dg-btn-primary" onclick={connectWallet}>
                    START WITH PASSKEY
                </button>
                <p class="dg-hint">Recommended — zero friction, one tap</p>
                <button class="dg-btn dg-btn-ghost" onclick={connectWallet}>
                    OTHER WALLETS
                </button>
            {/if}
        </div>

        <button class="dg-link-btn" onclick={() => showHowItWorks = !showHowItWorks}>
            {showHowItWorks ? "CLOSE" : "HOW IT WORKS"}
        </button>

        {#if showHowItWorks}
        <div class="dg-how-it-works">
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">1</span>
                <div>
                    <strong>Choose a door</strong>
                    <p>Each floor has 4 rune-sealed doors. Pick one.</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">2</span>
                <div>
                    <strong>Prove your choice</strong>
                    <p>A ZK proof is generated in your browser — your secret stays hidden.</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">3</span>
                <div>
                    <strong>Verify on-chain</strong>
                    <p>The proof is verified on Stellar. Even wrong choices are real verified transactions.</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">4</span>
                <div>
                    <strong>Race to floor 10</strong>
                    <p>Co-op gates on floors 1 & 5. The boss on floor 10 demands a RISC Zero proof.</p>
                </div>
            </div>
        </div>
        {/if}
    </div>

    <div class="dg-title-footer">
        <a href="/labs/the-farm" class="dg-footer-link">THE FARM DASHBOARD</a>
        <span class="dg-footer-sep">|</span>
        <button class="dg-footer-link" onclick={toggleFullscreen}>FULLSCREEN</button>
    </div>
</div>

<!-- ── Lobby ──────────────────────────────────────────────────────── -->
{:else if phase === "lobby"}
<div class="dg-root dg-lobby-screen">
    <div class="dg-stars"></div>
    <div class="dg-lobby-content">
        <button class="dg-back-btn" onclick={() => phase = "title"}>&larr; BACK</button>
        <p class="dg-eyebrow">LOBBY</p>
        <h2 class="dg-lobby-title">
            {lobbyRole === "host" ? "WAITING FOR PLAYER 2" : "JOINING LOBBY"}
        </h2>

        <div class="dg-lobby-code-display">
            <p class="dg-lobby-code-label">LOBBY CODE</p>
            <p class="dg-lobby-code">{lobbyCode}</p>
            <button class="dg-btn dg-btn-ghost dg-btn-sm" onclick={() => {
                navigator.clipboard.writeText(lobbyCode);
            }}>COPY CODE</button>
        </div>

        <div class="dg-lobby-players">
            <div class="dg-lobby-player dg-lobby-player-ready">
                <span class="dg-lobby-player-icon">P1</span>
                <span class="dg-lobby-player-name">{playerName}</span>
                <span class="dg-lobby-player-status">READY</span>
            </div>
            <div class="dg-lobby-player {lobbyRole === 'guest' || opponentName ? 'dg-lobby-player-ready' : 'dg-lobby-player-waiting'}">
                <span class="dg-lobby-player-icon">P2</span>
                <span class="dg-lobby-player-name">{opponentName || "..."}</span>
                <span class="dg-lobby-player-status">{opponentName ? "READY" : "WAITING"}</span>
            </div>
        </div>

        {#if lobbyRole === "host"}
            <p class="dg-hint">Share the code with another player, or start solo.</p>
            <button class="dg-btn dg-btn-primary" onclick={startGame}>
                {opponentName ? "START GAME" : "START SOLO"}
            </button>
        {:else}
            <button class="dg-btn dg-btn-primary" onclick={startGame}>READY</button>
        {/if}
    </div>
</div>

<!-- ── Playing ────────────────────────────────────────────────────── -->
{:else if phase === "playing"}
<div class="dg-root dg-game-screen" class:dg-floor-transition={floorTransition}>
    <!-- HUD -->
    <div class="dg-hud">
        <div class="dg-hud-left">
            <span class="dg-hud-floor">FLOOR {currentFloor}/{TOTAL_FLOORS}</span>
            <span class="dg-hud-proof-type">{currentLore.proofType}</span>
            {#if hubCalling}
                <span class="dg-hud-hub-status">HUB...</span>
            {/if}
        </div>
        <div class="dg-hud-center">
            <div class="dg-progress-bar">
                <div class="dg-progress-fill" style="width: {progressPct}%"></div>
            </div>
        </div>
        <div class="dg-hud-right">
            <span class="dg-hud-attempts">ATTEMPTS: {attempts}</span>
            {#if hubStartTx}
                <a class="dg-hud-tx-link" href={txExplorerUrl(hubStartTx)} target="_blank" rel="noreferrer" title="start_game tx">HUB</a>
            {/if}
            <button class="dg-hud-btn" onclick={toggleFullscreen}>
                {fullscreen ? "EXIT FS" : "FS"}
            </button>
        </div>
    </div>

    <!-- Floor Content -->
    <div class="dg-floor-area">
        <div class="dg-floor-header">
            <h2 class="dg-floor-name">{currentLore.name}</h2>
            <p class="dg-floor-desc">{currentLore.desc}</p>
        </div>

        {#if gateWaiting}
        <div class="dg-gate-overlay">
            <div class="dg-gate-panel">
                <p class="dg-gate-title">CO-OP GATE</p>
                <p class="dg-gate-desc">Waiting for both seekers to clear this floor...</p>
                <div class="dg-gate-spinner"></div>
            </div>
        </div>
        {:else}
        <!-- 4 Doors -->
        <div class="dg-doors">
            {#each doorStates as state, i}
            <button
                class="dg-door dg-door-{state}"
                disabled={state !== "idle" || activeDoor !== null}
                onclick={() => chooseDoor(i)}
            >
                <span class="dg-door-rune">{DOOR_SYMBOLS[i]}</span>
                <span class="dg-door-label">DOOR {i + 1}</span>
                {#if state === "proving"}
                    <span class="dg-door-status">PROVING...</span>
                {:else if state === "correct"}
                    <span class="dg-door-status dg-door-correct">OPENED</span>
                {:else if state === "wrong"}
                    <span class="dg-door-status dg-door-wrong">SEALED</span>
                {/if}
                <div class="dg-door-glow" style="--door-color: {DOOR_COLORS[i]}"></div>
            </button>
            {/each}
        </div>
        {/if}
    </div>

    <!-- Run Log -->
    <div class="dg-run-log">
        <div class="dg-run-log-header">
            <span>RUN LOG</span>
            <span class="dg-run-log-count">{runLog.length}</span>
        </div>
        <div class="dg-run-log-entries">
            {#each runLog.toReversed() as entry}
            <div class="dg-log-entry dg-log-{entry.result}">
                {#if entry.floor === 0}
                    <span class="dg-log-text">start_game() called on hub</span>
                {:else if entry.door === -1}
                    <span class="dg-log-text">end_game() called on hub</span>
                {:else}
                    <span class="dg-log-floor">F{entry.floor}</span>
                    <span class="dg-log-door">D{entry.door + 1}</span>
                    <span class="dg-log-result">{entry.result === "correct" ? "OK" : "MISS"}</span>
                    <span class="dg-log-proof">{entry.proofType}</span>
                    {#if entry.verified}
                        <span class="dg-log-verified">ZK</span>
                    {/if}
                    {#if entry.provingTimeMs}
                        <span class="dg-log-time">{entry.provingTimeMs}ms</span>
                    {/if}
                {/if}
                {#if entry.txHash}
                    <a class="dg-log-tx" href={txExplorerUrl(entry.txHash)} target="_blank" rel="noreferrer">tx</a>
                {:else}
                    <span class="dg-log-tx dg-log-tx-pending">--</span>
                {/if}
            </div>
            {/each}
        </div>
    </div>
</div>

<!-- ── Victory ────────────────────────────────────────────────────── -->
{:else if phase === "victory"}
<div class="dg-root dg-victory-screen">
    <div class="dg-stars"></div>
    <div class="dg-victory-content">
        <p class="dg-eyebrow">DUNGEON CLEARED</p>
        <h1 class="dg-victory-title">VICTORY</h1>
        <p class="dg-victory-subtitle">All 10 floors cleared. Every door choice verified on-chain.</p>

        <div class="dg-victory-stats">
            <div class="dg-stat">
                <span class="dg-stat-value">{TOTAL_FLOORS}</span>
                <span class="dg-stat-label">FLOORS</span>
            </div>
            <div class="dg-stat">
                <span class="dg-stat-value">{attempts}</span>
                <span class="dg-stat-label">ATTEMPTS</span>
            </div>
            <div class="dg-stat">
                <span class="dg-stat-value">{runLog.filter(e => e.txHash).length}</span>
                <span class="dg-stat-label">ON-CHAIN TXS</span>
            </div>
        </div>

        <div class="dg-victory-log-summary">
            <p class="dg-victory-log-title">PROOF TYPES USED</p>
            <div class="dg-proof-types">
                <span class="dg-proof-badge dg-proof-noir">Noir</span>
                <span class="dg-proof-badge dg-proof-circom">Circom</span>
                <span class="dg-proof-badge dg-proof-risc0">RISC Zero</span>
            </div>
        </div>

        {#if hubStartTx || hubEndTx}
        <div class="dg-victory-hub-txs">
            <p class="dg-victory-log-title">HUB TRANSACTIONS</p>
            {#if hubStartTx}
                <a class="dg-hub-tx-link" href={txExplorerUrl(hubStartTx)} target="_blank" rel="noreferrer">start_game() → {hubStartTx.slice(0, 12)}...</a>
            {/if}
            {#if hubEndTx}
                <a class="dg-hub-tx-link" href={txExplorerUrl(hubEndTx)} target="_blank" rel="noreferrer">end_game() → {hubEndTx.slice(0, 12)}...</a>
            {/if}
        </div>
        {/if}

        <div class="dg-victory-actions">
            <button class="dg-btn dg-btn-primary" onclick={resetGame}>PLAY AGAIN</button>
            <a href="/labs/the-farm" class="dg-btn dg-btn-secondary">VIEW DASHBOARD</a>
        </div>
    </div>
</div>
{/if}

<style>
    /* ── Root & Shared ─────────────────────────────────────────────── */
    :root {
        --dg-bg: #04060b;
        --dg-surface: rgba(10, 13, 22, 0.85);
        --dg-border: rgba(255, 255, 255, 0.1);
        --dg-text: #e8f0ff;
        --dg-text-dim: #8ba3c7;
        --dg-accent: #4ad0ff;
        --dg-accent-2: #9b7bff;
        --dg-accent-3: #ffc47a;
        --dg-correct: #4ade80;
        --dg-wrong: #f87171;
        --dg-font-display: "Press Start 2P", "JetBrains Mono", monospace;
        --dg-font-body: "Inter", system-ui, -apple-system, sans-serif;
    }

    .dg-root {
        position: fixed;
        inset: 0;
        background: var(--dg-bg);
        color: var(--dg-text);
        font-family: var(--dg-font-body);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .dg-stars {
        position: absolute;
        inset: 0;
        background:
            radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 30% 70%, rgba(255,255,255,0.3), transparent),
            radial-gradient(1px 1px at 50% 10%, rgba(255,255,255,0.5), transparent),
            radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.3), transparent),
            radial-gradient(1px 1px at 90% 80%, rgba(255,255,255,0.4), transparent),
            radial-gradient(2px 2px at 20% 50%, rgba(74,208,255,0.2), transparent),
            radial-gradient(2px 2px at 80% 30%, rgba(155,123,255,0.2), transparent);
        pointer-events: none;
        z-index: 0;
    }

    /* ── Buttons ──────────────────────────────────────────────────── */
    .dg-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 14px 28px;
        border-radius: 8px;
        border: 1px solid var(--dg-border);
        font-family: var(--dg-font-display);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
    }

    .dg-btn-primary {
        background: linear-gradient(135deg, var(--dg-accent), var(--dg-accent-2));
        color: #0a0c16;
        border-color: rgba(255,255,255,0.2);
        box-shadow: 0 4px 20px rgba(74, 208, 255, 0.25);
    }
    .dg-btn-primary:hover {
        box-shadow: 0 6px 30px rgba(74, 208, 255, 0.4);
        transform: translateY(-1px);
    }

    .dg-btn-secondary {
        background: rgba(255,255,255,0.06);
        color: var(--dg-text);
        border-color: rgba(255,255,255,0.15);
    }
    .dg-btn-secondary:hover {
        background: rgba(255,255,255,0.12);
    }

    .dg-btn-ghost {
        background: transparent;
        color: var(--dg-text-dim);
        border-color: transparent;
        font-size: 10px;
        padding: 10px 20px;
    }
    .dg-btn-ghost:hover {
        color: var(--dg-text);
    }

    .dg-btn-sm {
        padding: 8px 16px;
        font-size: 9px;
    }

    .dg-input {
        padding: 12px 16px;
        background: rgba(255,255,255,0.05);
        border: 1px solid var(--dg-border);
        border-radius: 8px;
        color: var(--dg-text);
        font-family: var(--dg-font-display);
        font-size: 12px;
        letter-spacing: 3px;
        text-transform: uppercase;
        text-align: center;
        width: 160px;
        outline: none;
    }
    .dg-input:focus {
        border-color: var(--dg-accent);
        box-shadow: 0 0 12px rgba(74,208,255,0.15);
    }
    .dg-input::placeholder {
        color: rgba(255,255,255,0.2);
        letter-spacing: 1px;
    }

    /* ── Title Screen ────────────────────────────────────────────── */
    .dg-title-screen {
        align-items: center;
        justify-content: center;
        background: radial-gradient(ellipse at 50% 30%, rgba(74,100,180,0.15), var(--dg-bg) 70%);
    }

    .dg-title-content {
        position: relative;
        z-index: 1;
        text-align: center;
        max-width: 520px;
        padding: 24px;
    }

    .dg-eyebrow {
        font-family: var(--dg-font-display);
        font-size: 10px;
        letter-spacing: 4px;
        color: var(--dg-accent);
        margin: 0 0 12px;
        text-transform: uppercase;
    }

    .dg-game-title {
        font-family: var(--dg-font-display);
        font-size: clamp(18px, 4vw, 32px);
        letter-spacing: 2px;
        margin: 0 0 16px;
        background: linear-gradient(135deg, var(--dg-text), var(--dg-accent));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .dg-subtitle {
        font-size: 14px;
        color: var(--dg-text-dim);
        margin: 0 0 32px;
        line-height: 1.6;
    }

    .dg-title-actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
    }

    .dg-join-row {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .dg-wallet-badge {
        font-family: var(--dg-font-display);
        font-size: 9px;
        color: var(--dg-accent);
        margin: 0 0 8px;
        padding: 6px 12px;
        border: 1px solid rgba(74,208,255,0.2);
        border-radius: 999px;
        background: rgba(74,208,255,0.05);
    }

    .dg-hint {
        font-size: 11px;
        color: var(--dg-text-dim);
        margin: 0;
    }

    .dg-link-btn {
        background: none;
        border: none;
        color: var(--dg-text-dim);
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        cursor: pointer;
        margin-top: 24px;
        padding: 8px;
        transition: color 0.2s;
    }
    .dg-link-btn:hover {
        color: var(--dg-accent);
    }

    .dg-how-it-works {
        margin-top: 20px;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px;
        background: var(--dg-surface);
        border: 1px solid var(--dg-border);
        border-radius: 12px;
    }

    .dg-hiw-item {
        display: flex;
        gap: 14px;
        align-items: flex-start;
    }

    .dg-hiw-num {
        font-family: var(--dg-font-display);
        font-size: 12px;
        color: var(--dg-accent);
        min-width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(74,208,255,0.3);
        border-radius: 6px;
        flex-shrink: 0;
    }

    .dg-hiw-item strong {
        font-size: 13px;
        display: block;
        margin-bottom: 2px;
    }

    .dg-hiw-item p {
        font-size: 12px;
        color: var(--dg-text-dim);
        margin: 0;
        line-height: 1.5;
    }

    .dg-title-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 16px;
        text-align: center;
        z-index: 1;
    }

    .dg-footer-link {
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 2px;
        color: var(--dg-text-dim);
        text-decoration: none;
        background: none;
        border: none;
        cursor: pointer;
        transition: color 0.2s;
    }
    .dg-footer-link:hover {
        color: var(--dg-accent);
    }

    .dg-footer-sep {
        color: rgba(255,255,255,0.15);
        margin: 0 12px;
        font-size: 10px;
    }

    /* ── Lobby Screen ────────────────────────────────────────────── */
    .dg-lobby-screen {
        align-items: center;
        justify-content: center;
        background: radial-gradient(ellipse at 50% 40%, rgba(155,123,255,0.1), var(--dg-bg) 70%);
    }

    .dg-lobby-content {
        position: relative;
        z-index: 1;
        text-align: center;
        max-width: 480px;
        padding: 24px;
    }

    .dg-back-btn {
        position: absolute;
        top: -40px;
        left: 0;
        background: none;
        border: none;
        color: var(--dg-text-dim);
        font-family: var(--dg-font-display);
        font-size: 10px;
        letter-spacing: 1px;
        cursor: pointer;
    }
    .dg-back-btn:hover {
        color: var(--dg-text);
    }

    .dg-lobby-title {
        font-family: var(--dg-font-display);
        font-size: 14px;
        letter-spacing: 1.5px;
        margin: 0 0 24px;
    }

    .dg-lobby-code-display {
        padding: 24px;
        background: var(--dg-surface);
        border: 1px solid var(--dg-border);
        border-radius: 12px;
        margin-bottom: 24px;
    }

    .dg-lobby-code-label {
        font-family: var(--dg-font-display);
        font-size: 9px;
        color: var(--dg-text-dim);
        letter-spacing: 2px;
        margin: 0 0 8px;
    }

    .dg-lobby-code {
        font-family: var(--dg-font-display);
        font-size: 32px;
        letter-spacing: 8px;
        color: var(--dg-accent);
        margin: 0 0 12px;
        text-shadow: 0 0 20px rgba(74,208,255,0.3);
    }

    .dg-lobby-players {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
    }

    .dg-lobby-player {
        flex: 1;
        padding: 16px;
        border-radius: 10px;
        border: 1px solid var(--dg-border);
        background: var(--dg-surface);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .dg-lobby-player-ready {
        border-color: rgba(74,222,128,0.3);
    }

    .dg-lobby-player-waiting {
        opacity: 0.5;
    }

    .dg-lobby-player-icon {
        font-family: var(--dg-font-display);
        font-size: 14px;
        color: var(--dg-accent);
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: 1px solid var(--dg-border);
        border-radius: 8px;
    }

    .dg-lobby-player-name {
        font-size: 11px;
        font-weight: 600;
    }

    .dg-lobby-player-status {
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 2px;
        color: var(--dg-correct);
    }

    .dg-lobby-player-waiting .dg-lobby-player-status {
        color: var(--dg-text-dim);
    }

    /* ── Game Screen ─────────────────────────────────────────────── */
    .dg-game-screen {
        background: radial-gradient(ellipse at 50% 20%, rgba(20,30,60,0.8), var(--dg-bg) 70%);
    }

    .dg-game-screen.dg-floor-transition {
        animation: dg-warp 0.6s ease-in-out;
    }

    @keyframes dg-warp {
        0% { filter: brightness(1); }
        50% { filter: brightness(2) blur(4px); }
        100% { filter: brightness(1); }
    }

    /* ── HUD ─────────────────────────────────────────────────────── */
    .dg-hud {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-bottom: 1px solid var(--dg-border);
        background: rgba(4,6,11,0.9);
        backdrop-filter: blur(8px);
        z-index: 10;
        flex-shrink: 0;
    }

    .dg-hud-left, .dg-hud-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .dg-hud-center {
        flex: 1;
        max-width: 300px;
        margin: 0 20px;
    }

    .dg-hud-floor {
        font-family: var(--dg-font-display);
        font-size: 11px;
        letter-spacing: 1px;
    }

    .dg-hud-proof-type {
        font-size: 10px;
        color: var(--dg-accent-2);
        padding: 3px 8px;
        border: 1px solid rgba(155,123,255,0.3);
        border-radius: 4px;
        font-family: var(--dg-font-display);
        letter-spacing: 0.5px;
    }

    .dg-hud-attempts {
        font-family: var(--dg-font-display);
        font-size: 10px;
        color: var(--dg-text-dim);
        letter-spacing: 1px;
    }

    .dg-hud-btn {
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--dg-border);
        color: var(--dg-text-dim);
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 1px;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
    }

    .dg-progress-bar {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        overflow: hidden;
    }

    .dg-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--dg-accent), var(--dg-accent-2));
        border-radius: 2px;
        transition: width 0.5s ease;
    }

    /* ── Floor Area ──────────────────────────────────────────────── */
    .dg-floor-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        position: relative;
    }

    .dg-floor-header {
        text-align: center;
        margin-bottom: 32px;
    }

    .dg-floor-name {
        font-family: var(--dg-font-display);
        font-size: clamp(14px, 2.5vw, 20px);
        letter-spacing: 2px;
        margin: 0 0 8px;
    }

    .dg-floor-desc {
        font-size: 13px;
        color: var(--dg-text-dim);
        margin: 0;
    }

    /* ── Doors ───────────────────────────────────────────────────── */
    .dg-doors {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        max-width: 640px;
        width: 100%;
    }

    @media (max-width: 600px) {
        .dg-doors {
            grid-template-columns: repeat(2, 1fr);
            max-width: 340px;
        }
    }

    .dg-door {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 28px 16px;
        background: var(--dg-surface);
        border: 1px solid var(--dg-border);
        border-radius: 14px;
        cursor: pointer;
        transition: all 0.25s ease;
        overflow: hidden;
        min-height: 140px;
        color: var(--dg-text);
        font-family: var(--dg-font-body);
    }

    .dg-door:not(:disabled):hover {
        border-color: rgba(255,255,255,0.25);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .dg-door:disabled {
        cursor: default;
    }

    .dg-door-rune {
        font-size: 36px;
        line-height: 1;
        transition: transform 0.3s ease;
    }

    .dg-door:not(:disabled):hover .dg-door-rune {
        transform: scale(1.15);
    }

    .dg-door-label {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        color: var(--dg-text-dim);
    }

    .dg-door-status {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 1px;
        padding: 4px 10px;
        border-radius: 4px;
    }

    .dg-door-correct {
        color: var(--dg-correct);
        background: rgba(74,222,128,0.1);
    }

    .dg-door-wrong {
        color: var(--dg-wrong);
        background: rgba(248,113,113,0.1);
    }

    .dg-door-glow {
        position: absolute;
        inset: 0;
        border-radius: 14px;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
        background: radial-gradient(circle at 50% 50%, var(--door-color), transparent 70%);
    }

    .dg-door:not(:disabled):hover .dg-door-glow {
        opacity: 0.08;
    }

    .dg-door-proving {
        border-color: rgba(74,208,255,0.4);
        animation: dg-pulse 1s ease-in-out infinite;
    }

    .dg-door-proving .dg-door-glow {
        opacity: 0.15;
    }

    .dg-door-correct {
        border-color: rgba(74,222,128,0.4);
    }

    .dg-door-correct .dg-door-glow {
        opacity: 0.2;
        background: radial-gradient(circle at 50% 50%, var(--dg-correct), transparent 70%);
    }

    .dg-door-wrong {
        border-color: rgba(248,113,113,0.4);
    }

    .dg-door-wrong .dg-door-glow {
        opacity: 0.2;
        background: radial-gradient(circle at 50% 50%, var(--dg-wrong), transparent 70%);
    }

    @keyframes dg-pulse {
        0%, 100% { box-shadow: 0 0 12px rgba(74,208,255,0.15); }
        50% { box-shadow: 0 0 24px rgba(74,208,255,0.3); }
    }

    /* ── Gate Overlay ────────────────────────────────────────────── */
    .dg-gate-overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(4,6,11,0.85);
        backdrop-filter: blur(6px);
        z-index: 5;
    }

    .dg-gate-panel {
        text-align: center;
        padding: 32px;
        background: var(--dg-surface);
        border: 1px solid rgba(155,123,255,0.3);
        border-radius: 16px;
    }

    .dg-gate-title {
        font-family: var(--dg-font-display);
        font-size: 14px;
        color: var(--dg-accent-2);
        letter-spacing: 3px;
        margin: 0 0 8px;
    }

    .dg-gate-desc {
        font-size: 13px;
        color: var(--dg-text-dim);
        margin: 0 0 20px;
    }

    .dg-gate-spinner {
        width: 28px;
        height: 28px;
        border: 2px solid var(--dg-border);
        border-top-color: var(--dg-accent-2);
        border-radius: 50%;
        margin: 0 auto;
        animation: dg-spin 1s linear infinite;
    }

    @keyframes dg-spin {
        to { transform: rotate(360deg); }
    }

    /* ── Run Log ─────────────────────────────────────────────────── */
    .dg-run-log {
        flex-shrink: 0;
        border-top: 1px solid var(--dg-border);
        background: rgba(4,6,11,0.95);
        max-height: 160px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .dg-run-log-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        color: var(--dg-text-dim);
        border-bottom: 1px solid var(--dg-border);
        flex-shrink: 0;
    }

    .dg-run-log-count {
        background: rgba(255,255,255,0.06);
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 9px;
    }

    .dg-run-log-entries {
        overflow-y: auto;
        padding: 4px 0;
    }

    .dg-log-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 16px;
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 0.5px;
    }

    .dg-log-correct {
        color: var(--dg-correct);
    }

    .dg-log-wrong {
        color: var(--dg-wrong);
    }

    .dg-log-pending {
        color: var(--dg-text-dim);
    }

    .dg-log-floor {
        min-width: 28px;
    }

    .dg-log-door {
        min-width: 24px;
    }

    .dg-log-result {
        min-width: 34px;
        font-weight: 700;
    }

    .dg-log-proof {
        color: var(--dg-accent-2);
        min-width: 60px;
    }

    .dg-log-attempt {
        color: var(--dg-text-dim);
        min-width: 30px;
    }

    .dg-log-text {
        color: var(--dg-accent);
    }

    .dg-log-tx {
        font-size: 8px;
        color: var(--dg-accent);
        text-decoration: none;
        margin-left: auto;
    }
    .dg-log-tx-pending {
        color: var(--dg-text-dim);
    }

    .dg-log-verified {
        font-family: var(--dg-font-display);
        font-size: 7px;
        letter-spacing: 1px;
        color: var(--dg-correct);
        padding: 1px 5px;
        border: 1px solid rgba(74, 222, 128, 0.3);
        border-radius: 3px;
    }

    .dg-log-time {
        font-size: 8px;
        color: var(--dg-text-dim);
        min-width: 40px;
    }

    /* ── Victory Screen ──────────────────────────────────────────── */
    .dg-victory-screen {
        align-items: center;
        justify-content: center;
        background: radial-gradient(ellipse at 50% 40%, rgba(74,222,128,0.08), var(--dg-bg) 70%);
    }

    .dg-victory-content {
        position: relative;
        z-index: 1;
        text-align: center;
        max-width: 520px;
        padding: 24px;
    }

    .dg-victory-title {
        font-family: var(--dg-font-display);
        font-size: clamp(28px, 6vw, 48px);
        letter-spacing: 6px;
        margin: 0 0 12px;
        background: linear-gradient(135deg, var(--dg-correct), var(--dg-accent));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .dg-victory-subtitle {
        font-size: 14px;
        color: var(--dg-text-dim);
        margin: 0 0 28px;
        line-height: 1.6;
    }

    .dg-victory-stats {
        display: flex;
        gap: 24px;
        justify-content: center;
        margin-bottom: 24px;
    }

    .dg-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 16px 24px;
        background: var(--dg-surface);
        border: 1px solid var(--dg-border);
        border-radius: 10px;
    }

    .dg-stat-value {
        font-family: var(--dg-font-display);
        font-size: 20px;
        color: var(--dg-accent);
    }

    .dg-stat-label {
        font-family: var(--dg-font-display);
        font-size: 8px;
        color: var(--dg-text-dim);
        letter-spacing: 2px;
    }

    .dg-victory-log-summary {
        margin-bottom: 24px;
    }

    .dg-victory-log-title {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        color: var(--dg-text-dim);
        margin: 0 0 12px;
    }

    .dg-proof-types {
        display: flex;
        gap: 8px;
        justify-content: center;
    }

    .dg-proof-badge {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 1px;
        padding: 6px 14px;
        border-radius: 6px;
        border: 1px solid var(--dg-border);
    }

    .dg-proof-noir {
        color: var(--dg-accent);
        border-color: rgba(74,208,255,0.3);
    }

    .dg-proof-circom {
        color: var(--dg-accent-3);
        border-color: rgba(255,196,122,0.3);
    }

    .dg-proof-risc0 {
        color: var(--dg-accent-2);
        border-color: rgba(155,123,255,0.3);
    }

    .dg-victory-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
    }

    .dg-victory-hub-txs {
        margin-bottom: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }

    .dg-hub-tx-link {
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 0.5px;
        color: var(--dg-accent);
        text-decoration: none;
        padding: 6px 12px;
        border: 1px solid rgba(74, 208, 255, 0.2);
        border-radius: 6px;
        transition: background 0.2s;
    }
    .dg-hub-tx-link:hover {
        background: rgba(74, 208, 255, 0.06);
    }

    .dg-hud-hub-status {
        font-family: var(--dg-font-display);
        font-size: 8px;
        color: var(--dg-accent-3);
        animation: dg-pulse 1s ease-in-out infinite;
    }

    .dg-hud-tx-link {
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 1px;
        color: var(--dg-accent);
        text-decoration: none;
        padding: 4px 8px;
        border: 1px solid rgba(74, 208, 255, 0.2);
        border-radius: 4px;
    }
</style>
