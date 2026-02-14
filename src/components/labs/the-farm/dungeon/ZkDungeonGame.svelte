<script lang="ts">
    import { userState } from "../../../../stores/user.svelte.ts";
    import { evaluateDoorAttempt, type Mode as DungeonMode } from "../../../../lib/dungeon/evaluateDoorAttempt";
    import { getFloorDefinition, type DoorDefinition, type DoorId } from "../../../../lib/dungeon/policies";
    import { dungeonLore, type DungeonRoomId } from "../../../../data/dungeon/lore";
    import { publishDungeonStampMainnet, type DungeonStampKind } from "../../../../lib/dungeon/publishDungeonStampMainnet";
    import { sha256Hex, sha256HexOfJson } from "../../../../lib/the-farm/digest";
    import {
        attemptDoor as submitDoorAttempt,
        txExplorerUrl,
    } from "./dungeonService";

    // ── Game State ──────────────────────────────────────────────────────
    type GamePhase = "title" | "lobby" | "airlock" | "playing" | "ledger" | "victory" | "defeat";
    type LobbyRole = "host" | "guest" | null;
    type DoorState = "idle" | "proving" | "correct" | "wrong";
    type RelayStatus = "disconnected" | "connecting" | "connected" | "error";

    const TOTAL_FLOORS = 3;
    const GATE_FLOORS = [1];

    let phase = $state<GamePhase>("title");
    let runId = $state<string>("");
    let runStartedAt = $state<number>(0);
    let entryStamp = $state<{ status: "idle" | "simulating" | "assembling" | "signing" | "submitted" | "confirmed" | "error"; txHash?: string; error?: string }>(
        { status: "idle" }
    );
    let withdrawalStamp = $state<{ status: "idle" | "simulating" | "assembling" | "signing" | "submitted" | "confirmed" | "error"; txHash?: string; error?: string }>(
        { status: "idle" }
    );
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
    let showHowItWorks = $state<boolean>(false);
    let floorTransition = $state<boolean>(false);
    let trainingMode = $state<boolean>(false);
    let attestedTierId = $state<number | null>(null);
    let trainingTierOverride = $state<number>(0);
    let credentialLoadError = $state<string | null>(null);
    let lastForensics = $state<import("./dungeonService").DoorAttemptResult | null>(null);

    // Relay (real multiplayer presence via server state, Labs-only)
    type DungeonRosterEntry = {
        id: string;
        account: string;
        name: string;
        joinedAt: number;
        lastSeenAt: number;
        ready: boolean;
        floor: number;
        attempts: number;
    };
    type DungeonEvent =
        | { seq: number; kind: "system"; message: string; ts: number }
        | { seq: number; kind: "ready"; account: string; ready: boolean; ts: number }
        | { seq: number; kind: "start"; ts: number }
        | { seq: number; kind: "progress"; account: string; floor: number; attempts: number; ts: number };
    type DungeonEventInput =
        | { kind: "ready"; account: string; ready: boolean; ts: number }
        | { kind: "start"; ts: number }
        | { kind: "progress"; account: string; floor: number; attempts: number; ts: number };

    let relayStatus = $state<RelayStatus>("disconnected");
    let relayError = $state<string | null>(null);
    let relayToken = $state<string>("");
    let relayCursor = $state<number>(0);
    let relayRoster = $state<DungeonRosterEntry[]>([]);
    let readySelf = $state<boolean>(false);
    let pollHandle = $state<number | null>(null);

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
        reasonCode?: string;
    }

    // ── Derived State ───────────────────────────────────────────────────
    let walletAddress = $derived(userState.contractId);
    let isConnected = $derived(!!userState.contractId && !!userState.keyId);
    let isGateFloor = $derived(GATE_FLOORS.includes(currentFloor));
    let progressPct = $derived(((currentFloor - 1) / TOTAL_FLOORS) * 100);
    let walletLabel = $derived(
        walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : ""
    );
    let floorDef = $derived(getFloorDefinition(currentFloor));
    let effectiveTierId = $derived(attestedTierId !== null ? attestedTierId : trainingTierOverride);
    let effectiveMode = $derived<DungeonMode>(trainingMode ? "training" : "normal");
    let hasOpponent = $derived(relayRoster.filter((r) => r.account !== walletAddress).length > 0);
    let allReady = $derived(relayRoster.length >= 2 && relayRoster.every((r) => r.ready));
    let opponentProgress = $derived(relayRoster.find((r) => r.account !== walletAddress) || null);
    let opponentReady = $derived(!!opponentProgress && opponentProgress.ready);
    let multiplayerEnabled = $derived(relayToken.length > 0 && relayRoster.length >= 2);
    let roomId = $derived<DungeonRoomId>(
        phase === "airlock" ? "airlock" : phase === "ledger" || phase === "victory" ? "ledger" : floorDef.roomId
    );
    let roomLore = $derived(dungeonLore[roomId]);
    let roomHeaderArt = $derived<string>(
        roomId === "airlock"
            ? "/labs/zkdungeon/art/room-airlock.webp"
            : roomId === "intake"
                ? "/labs/zkdungeon/art/room-intake.webp"
                : roomId === "catalog"
                    ? "/labs/zkdungeon/art/room-catalog.webp"
                    : roomId === "cold"
                        ? "/labs/zkdungeon/art/room-cold.webp"
                        : "/labs/zkdungeon/art/room-ledger.webp"
    );
    let guardianArt = $derived<string>(
        roomId === "catalog"
            ? "/labs/zkdungeon/art/guardian-noir.webp"
            : roomId === "cold"
                ? "/labs/zkdungeon/art/guardian-risc0.webp"
                : "/labs/zkdungeon/art/guardian-groth16.webp"
    );
    let verifierBadgeArt = $derived<string>(
        roomId === "catalog"
            ? "/labs/zkdungeon/art/badge-noir.webp"
            : roomId === "cold"
                ? "/labs/zkdungeon/art/badge-risc0.webp"
                : "/labs/zkdungeon/art/badge-groth16.webp"
    );

    function txExplorerUrlMainnet(txHash: string): string {
        return `https://stellar.expert/explorer/public/tx/${txHash}`;
    }

    function doorDef(doorId: DoorId): DoorDefinition {
        return floorDef.doors.find((d) => d.id === doorId) as DoorDefinition;
    }

    function doorWouldAccept(door: DoorDefinition): boolean {
        const out = evaluateDoorAttempt({
            floor: currentFloor,
            doorId: door.id,
            proofOk: true,
            provenInputs: { tierId: effectiveTierId },
            lobbyState: { enabled: false },
            mode: effectiveMode,
        });
        return out.accepted;
    }

    $effect(() => {
        attestedTierId = null;
        credentialLoadError = null;

        if (!isConnected || !walletAddress) return;

        let cancelled = false;
        (async () => {
            const { readFarmAttestationTier } = await import("../../../../lib/dungeon/readFarmAttestationTier");
            const res = await readFarmAttestationTier(walletAddress);
            if (cancelled) return;
            if (res.ok) {
                attestedTierId = res.tierId;
            } else {
                credentialLoadError = res.reason;
            }
        })().catch((err) => {
            if (cancelled) return;
            credentialLoadError = err instanceof Error ? err.message : String(err);
        });

        return () => {
            cancelled = true;
        };
    });

    // ── Actions ─────────────────────────────────────────────────────────

    function generateLobbyCode(): string {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    function stopRelayPolling() {
        if (pollHandle !== null) {
            window.clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    function applyRoster(roster: DungeonRosterEntry[]) {
        relayRoster = roster;
        if (!walletAddress) return;
        const other = roster.find((r) => r.account !== walletAddress);
        opponentName = other?.name || "";
    }

    async function relayJoin(roomId: string) {
        relayStatus = "connecting";
        relayError = null;

        const account = userState.contractId || "";
        if (!account) throw new Error("Wallet not connected");

        const resp = await fetch(`/api/dungeon/rooms/${encodeURIComponent(roomId)}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account,
                name: playerName || walletLabel || "Seeker",
            }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(text || `Join failed (${resp.status})`);
        }

        const data = (await resp.json()) as { token: string; roster: DungeonRosterEntry[]; cursor: number };
        relayToken = data.token || "";
        relayCursor = typeof data.cursor === "number" ? data.cursor : 0;
        applyRoster(Array.isArray(data.roster) ? data.roster : []);
        relayStatus = "connected";
    }

    async function relayPollOnce() {
        if (!relayToken || !lobbyCode) return;

        const resp = await fetch(
            `/api/dungeon/rooms/${encodeURIComponent(lobbyCode)}/events?cursor=${encodeURIComponent(String(relayCursor))}`,
            { headers: { Authorization: `Bearer ${relayToken}` } },
        );

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(text || `Relay poll failed (${resp.status})`);
        }

        const data = (await resp.json()) as {
            roster: DungeonRosterEntry[];
            events: DungeonEvent[];
            cursor: number;
        };

        relayCursor = typeof data.cursor === "number" ? data.cursor : relayCursor;
        applyRoster(Array.isArray(data.roster) ? data.roster : []);

        const events = Array.isArray(data.events) ? data.events : [];
        for (const evt of events) {
            if (evt.kind === "start") {
                if (phase === "lobby") {
                    await startGameLocal({ fromRemote: true });
                }
            }
        }

        if (gateWaiting && multiplayerEnabled) {
            const roster = relayRoster;
            if (roster.length >= 2 && roster.every((r) => r.floor >= currentFloor)) {
                gateWaiting = false;
            }
        }
    }

    async function relayPost(event: DungeonEventInput) {
        if (!relayToken || !lobbyCode) return;
        const resp = await fetch(`/api/dungeon/rooms/${encodeURIComponent(lobbyCode)}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${relayToken}`,
            },
            body: JSON.stringify(event),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(text || `Relay post failed (${resp.status})`);
        }
    }

    function startRelayPolling() {
        stopRelayPolling();
        if (!relayToken || !lobbyCode) return;
        pollHandle = window.setInterval(() => {
            relayPollOnce().catch((err) => {
                relayStatus = "error";
                relayError = err instanceof Error ? err.message : String(err);
            });
        }, 850);
    }

    async function setReady(nextReady: boolean) {
        readySelf = nextReady;
        if (!walletAddress) return;
        await relayPost({ kind: "ready", account: walletAddress, ready: nextReady, ts: Date.now() });
    }

    async function createLobby() {
        warmupDungeonVerifiers();

        lobbyCode = generateLobbyCode();
        lobbyRole = "host";
        playerName = walletLabel || "Seeker-1";
        opponentName = "";
        phase = "lobby";

        try {
            await relayJoin(lobbyCode);
            await setReady(true);
            startRelayPolling();
        } catch (err) {
            relayStatus = "error";
            relayError = err instanceof Error ? err.message : String(err);
        }
    }

    async function joinLobby() {
        warmupDungeonVerifiers();

        if (lobbyInput.length < 4) return;
        lobbyCode = lobbyInput.toUpperCase();
        lobbyRole = "guest";
        playerName = walletLabel || "Seeker-2";
        opponentName = "";
        phase = "lobby";

        try {
            await relayJoin(lobbyCode);
            startRelayPolling();
        } catch (err) {
            relayStatus = "error";
            relayError = err instanceof Error ? err.message : String(err);
        }
    }

    async function startGameLocal(opts?: { fromRemote?: boolean }) {
        currentFloor = 1;
        attempts = 0;
        runLog = [];
        doorStates = ["idle", "idle", "idle", "idle"];
        gateWaiting = false;
        lastForensics = null;
        phase = "playing";

        addLogEntry({
            floor: 0,
            door: -1,
            attempt: 0,
            result: "correct",
            proofType: "Local",
            txHash: null,
            timestamp: Date.now(),
        });

        if (relayToken && walletAddress) {
            try {
                await relayPost({
                    kind: "progress",
                    account: walletAddress,
                    floor: 1,
                    attempts: 0,
                    ts: Date.now(),
                });
            } catch {}
        }

        if (opts?.fromRemote && relayToken) startRelayPolling();
    }

    async function hostStartGame() {
        if (hasOpponent) await relayPost({ kind: "start", ts: Date.now() });
        await startGameLocal();
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
            tierId: effectiveTierId,
            mode: effectiveMode,
            lobbyState: {
                enabled: multiplayerEnabled,
                waiting: gateWaiting,
                reason: gateWaiting ? "Waiting for the other player to reach this floor" : undefined,
            },
        });

        lastForensics = result;
        const accepted = result.accepted;
        doorStates[doorIndex] = accepted ? "correct" : "wrong";

        addLogEntry({
            floor: currentFloor,
            door: doorIndex,
            attempt: attempts,
            result: accepted ? "correct" : "wrong",
            proofType: result.proofType,
            txHash: result.txHash,
            timestamp: Date.now(),
            verified: result.proofOk,
            provingTimeMs: result.provingTimeMs,
            commitment: result.commitment,
            reasonCode: result.reasonCode,
        });

        // Progress event (keep roster attempts fresh even on wrong doors)
        if (relayToken && walletAddress) {
            try {
                await relayPost({
                    kind: "progress",
                    account: walletAddress,
                    floor: currentFloor,
                    attempts,
                    ts: Date.now(),
                });
            } catch {}
        }

        // Animate then advance
        await new Promise((r) => setTimeout(r, 800));

        if (accepted) {
            if (currentFloor >= TOTAL_FLOORS) {
                addLogEntry({
                    floor: TOTAL_FLOORS,
                    door: -1,
                    attempt: attempts,
                    result: "correct",
                    proofType: "Local",
                    txHash: null,
                    timestamp: Date.now(),
                });
                phase = "ledger";
            } else {
                // Advance to next floor
                floorTransition = true;
                await new Promise((r) => setTimeout(r, 600));
                const nextFloor = currentFloor + 1;
                currentFloor = nextFloor;
                doorStates = ["idle", "idle", "idle", "idle"];
                activeDoor = null;
                floorTransition = false;
                lastForensics = null;

                // Progress event (multiplayer presence)
                if (relayToken && walletAddress) {
                    try {
                        await relayPost({
                            kind: "progress",
                            account: walletAddress,
                            floor: nextFloor,
                            attempts,
                            ts: Date.now(),
                        });
                    } catch {}
                }

                // Gate floors: after clearing 1 and 5, wait for both players to reach the next floor.
                if (GATE_FLOORS.includes(nextFloor - 1)) {
                    gateWaiting = true;
                    if (!multiplayerEnabled) {
                        setTimeout(() => {
                            gateWaiting = false;
                        }, 1400);
                    }
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
        relayToken = "";
        relayCursor = 0;
        relayRoster = [];
        relayStatus = "disconnected";
        relayError = null;
        readySelf = false;
        stopRelayPolling();
        currentFloor = 1;
        attempts = 0;
        doorStates = ["idle", "idle", "idle", "idle"];
        activeDoor = null;
        runLog = [];
        gateWaiting = false;
        floorTransition = false;
        lastForensics = null;
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

    async function proceedFromAirlock() {
        // Gameplay begins after Room 0. (Room 0 can be recorded on-chain, but demo mode can proceed without it.)
        await startGameLocal();
    }

    let zkWarmupStarted = false;
    function warmupDungeonVerifiers(): void {
        if (zkWarmupStarted) return;
        zkWarmupStarted = true;

        // Preload Noir (bb.js backend) + RISC0 WASM verifier in the background.
        // This keeps Room 2/3 transitions snappy and avoids "first-verify" stalls.
        void (async () => {
            try {
                const [{ preloadNoirVerifier }, { preloadRisc0Verifier }, noirBundle] = await Promise.all([
                    import("../../../../lib/the-farm/verifiers/noir"),
                    import("../../../../lib/the-farm/verifiers/risc0"),
                    import("../../../../data/the-farm/noirBundle"),
                ]);
                preloadNoirVerifier(noirBundle.noirVerifierBytecode);
                preloadRisc0Verifier();
            } catch {
                // Non-fatal; verifier calls will surface any real issues.
            }
        })();
    }

    async function stampOnChain(kind: DungeonStampKind) {
        if (!userState.contractId || !userState.keyId) {
            throw new Error("Connect your passkey wallet first.");
        }

        const plan = ["GROTH16", "NOIR_ULTRAHONK", "RISC0_RECEIPT"];
        const statementHash = await sha256HexOfJson({
            dungeon: "kale-seed-vault",
            kind,
            runId,
            startedAt: runStartedAt,
            plan,
            floorsCompleted: currentFloor - 1,
            attempts,
        });
        const verifierHash = await sha256Hex(`zkdungeon:stamp:v1:${kind}`);

        const target = kind === "ENTRY" ? entryStamp : withdrawalStamp;
        if (target.status === "simulating" || target.status === "assembling" || target.status === "signing") return;

        if (kind === "ENTRY") entryStamp = { status: "simulating" };
        else withdrawalStamp = { status: "simulating" };

        const res = await publishDungeonStampMainnet({
            owner: userState.contractId,
            keyId: userState.keyId,
            kind,
            statementHash,
            verifierHash,
            onStage: (stage) => {
                const update = (tx: typeof entryStamp) => {
                    if (kind === "ENTRY") entryStamp = tx;
                    else withdrawalStamp = tx;
                };
                if (stage === "simulating") update({ status: "simulating" });
                if (stage === "assembling") update({ status: "assembling" });
                if (stage === "signing") update({ status: "signing" });
                if (stage === "submitted") update({ status: "submitted" });
                if (stage === "confirmed") update({ status: "confirmed" });
            },
        });

        if (!res.ok) {
            if (kind === "ENTRY") entryStamp = { status: "error", error: res.error, txHash: res.txHash };
            else withdrawalStamp = { status: "error", error: res.error, txHash: res.txHash };
            return;
        }

        if (kind === "ENTRY") entryStamp = { status: "confirmed", txHash: res.txHash };
        else withdrawalStamp = { status: "confirmed", txHash: res.txHash };
    }

    function finishRun() {
        phase = "victory";
    }

    async function playSolo() {
        warmupDungeonVerifiers();

        lobbyCode = "SOLO";
        lobbyRole = null;
        playerName = walletLabel || "Solo Seeker";
        opponentName = "";
        relayToken = "";
        relayRoster = [];
        relayStatus = "disconnected";
        relayError = null;
        stopRelayPolling();

        // Initialize a new run and enter the Airlock (Room 0) before gameplay.
        runId = crypto.randomUUID();
        runStartedAt = Date.now();
        entryStamp = { status: "idle" };
        withdrawalStamp = { status: "idle" };
        phase = "airlock";
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
        <p class="dg-eyebrow">THE FARM LABS</p>
        <h1 class="dg-game-title">KALE-SEED VAULT</h1>
        <p class="dg-subtitle">A guided compliance run through three protocol wings: Groth16 → Noir → RISC0. Two optional mainnet passkey audit stamps.</p>

        <div class="dg-title-actions">
            <button class="dg-btn dg-btn-primary" onclick={playSolo}>
                PLAY SOLO
            </button>

            {#if isConnected}
                <p class="dg-wallet-badge">{walletLabel}</p>
                <button class="dg-btn dg-btn-secondary" onclick={createLobby}>CREATE 2P LOBBY</button>
                <div class="dg-join-row">
                    <label class="dg-join-label" for="dg-room-code">ROOM CODE</label>
                    <div class="dg-join-controls">
                        <input
                            id="dg-room-code"
                            class="dg-input"
                            type="text"
                            inputmode="text"
                            autocomplete="one-time-code"
                            placeholder="ENTER 6-CHAR CODE"
                            maxlength="12"
                            bind:value={lobbyInput}
                            onkeydown={(e) => e.key === "Enter" && joinLobby()}
                        />
                        <button class="dg-btn dg-btn-primary dg-btn-join" onclick={joinLobby}>JOIN LOBBY</button>
                    </div>
                </div>
            {:else}
                <button class="dg-btn dg-btn-secondary" onclick={connectWallet}>
                    CONNECT WALLET (2P)
                </button>
                <p class="dg-hint">2-player lobby uses a Labs-only relay (no SEP-10 auth yet).</p>
            {/if}
        </div>

        <div class="dg-cred-card" aria-live="polite">
            <p class="dg-cred-line">
                CLEARANCE: TIER {effectiveTierId}
                {#if attestedTierId !== null}
                    <span class="dg-cred-source">ON-CHAIN</span>
                {:else}
                    <span class="dg-cred-source dg-cred-source-demo">DEMO</span>
                {/if}
            </p>
            {#if credentialLoadError}
                <p class="dg-cred-warn">On-chain clearance unavailable: {credentialLoadError}</p>
            {/if}

            <div class="dg-cred-controls">
                <label class="dg-toggle">
                    <input type="checkbox" bind:checked={trainingMode} />
                    <span>TRAINING MODE (SHOWS MECHANICS)</span>
                </label>

                {#if trainingMode && attestedTierId === null}
                    <div class="dg-cred-override">
                        <label class="dg-join-label" for="dg-demo-tier">DEMO TIER</label>
                        <select
                            id="dg-demo-tier"
                            class="dg-select"
                            bind:value={trainingTierOverride}
                        >
                            <option value={0}>0 (SPROUT)</option>
                            <option value={1}>1 (GROWER)</option>
                            <option value={2}>2 (HARVEST)</option>
                            <option value={3}>3 (WHALE)</option>
                        </select>
                    </div>
                {/if}
            </div>
        </div>

        <button class="dg-link-btn" onclick={() => showHowItWorks = !showHowItWorks}>
            {showHowItWorks ? "CLOSE" : "HOW IT WORKS"}
        </button>

        {#if showHowItWorks}
        <div class="dg-how-it-works">
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">1</span>
                <div>
                    <strong>Airlock (optional mainnet stamp)</strong>
                    <p>Stamp entry as a digest-only audit record via passkey (reviewer-proof), or proceed in demo mode.</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">2</span>
                <div>
                    <strong>Read the placard, then choose a door</strong>
                    <p>Doors show explicit policy tags. A valid credential can still be denied if the policy mismatch is real.</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">3</span>
                <div>
                    <strong>Verifier changes by room</strong>
                    <p>Room 1 uses Groth16 per attempt. Rooms 2–3 run real Noir/RISC0 verifiers on training credentials (explicitly labeled).</p>
                </div>
            </div>
            <div class="dg-hiw-item">
                <span class="dg-hiw-num">4</span>
                <div>
                    <strong>Ledger chamber (optional mainnet record)</strong>
                    <p>Record a completion digest on-chain via passkey. This is a record, not on-chain proof verification.</p>
                </div>
            </div>
        </div>
        {/if}
    </div>

    <div class="dg-title-footer">
        <a href="/labs/the-farm" class="dg-footer-link">DASHBOARD</a>
        <span class="dg-footer-sep">|</span>
        <button class="dg-footer-link" onclick={toggleFullscreen}>FULLSCREEN</button>
    </div>
</div>

<!-- ── Lobby ──────────────────────────────────────────────────────── -->
{:else if phase === "airlock"}
<div class="dg-root dg-vault-screen dg-airlock">
    <div class="dg-vault-bg" aria-hidden="true"></div>
    <div class="dg-vault-shell">
        <button class="dg-back-btn" onclick={resetGame}>&larr; BACK</button>

        <div class="dg-vault-header">
            <img class="dg-room-art" src={roomHeaderArt} alt="" loading="eager" />
            <div class="dg-vault-roomtitle">
                <p class="dg-eyebrow">THE KALE-SEED VAULT</p>
                <h2 class="dg-lobby-title">{roomLore.roomTitle}</h2>
                <p class="dg-subtitle">{roomLore.roomSubtitle}</p>
            </div>
        </div>

        <div class="dg-vault-grid">
            <section class="dg-panel dg-panel-lore" aria-label="Lore Scroll">
                <div class="dg-panel-head">LORE SCROLL</div>
                {#each roomLore.briefingMarkdown.split("\n\n") as para (para)}
                    <p class="dg-lore-p">{para}</p>
                {/each}
            </section>

            <section class="dg-panel dg-panel-placard" aria-label="Protocol Placard">
                <div class="dg-panel-head">PROTOCOL PLACARD</div>
                <p class="dg-placard">{roomLore.protocolPlacard}</p>
                <div class="dg-placard-sub">{roomLore.verifierExplainer}</div>

                <div class="dg-stamp-box">
                    <div class="dg-stamp-title">ENTRY STAMP (MAINNET)</div>
                    <div class="dg-stamp-status">STATUS: {entryStamp.status.toUpperCase()}</div>
                    {#if entryStamp.txHash}
                        <a class="dg-stamp-link" href={txExplorerUrlMainnet(entryStamp.txHash)} target="_blank" rel="noreferrer">
                            VIEW TX {entryStamp.txHash.slice(0, 8)}...
                        </a>
                    {/if}
                    {#if entryStamp.error}
                        <div class="dg-stamp-error">{entryStamp.error}</div>
                    {/if}

                    {#if isConnected}
                        <button
                            class="dg-btn dg-btn-primary"
                            disabled={entryStamp.status === "simulating" || entryStamp.status === "assembling" || entryStamp.status === "signing"}
                            onclick={() => stampOnChain("ENTRY")}
                        >
                            STAMP ENTRY ON-CHAIN (PASSKEY)
                        </button>
                    {:else}
                        <button class="dg-btn dg-btn-secondary" onclick={connectWallet}>CONNECT WALLET (PASSKEY)</button>
                    {/if}
                </div>

                <div class="dg-vault-actions">
                    <button class="dg-btn dg-btn-primary" onclick={proceedFromAirlock}>
                        ENTER INTAKE WING →
                    </button>
                    {#if !isConnected}
                        <p class="dg-hint">Demo mode: you can proceed without an on-chain entry stamp.</p>
                    {/if}
                </div>
            </section>
        </div>
    </div>
</div>

<!-- ── Lobby ──────────────────────────────────────────────────────── -->
{:else if phase === "lobby"}
<div class="dg-root dg-lobby-screen">
    <div class="dg-stars"></div>
    <div class="dg-lobby-content">
        <button class="dg-back-btn" onclick={resetGame}>&larr; BACK</button>
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

        <div class="dg-relay-status" aria-live="polite">
            <span class="dg-relay-pill dg-relay-{relayStatus}">
                RELAY: {relayStatus.toUpperCase()}
            </span>
            {#if relayError}
                <span class="dg-relay-detail">{relayError}</span>
            {/if}
        </div>

        <div class="dg-lobby-players">
            <div class="dg-lobby-player dg-lobby-player-ready">
                <span class="dg-lobby-player-icon">P1</span>
                <span class="dg-lobby-player-name">{playerName}</span>
                <span class="dg-lobby-player-status">READY</span>
            </div>
            <div class="dg-lobby-player {opponentName ? 'dg-lobby-player-ready' : 'dg-lobby-player-waiting'}">
                <span class="dg-lobby-player-icon">P2</span>
                <span class="dg-lobby-player-name">{opponentName || "..."}</span>
                <span class="dg-lobby-player-status">{opponentName ? (opponentReady ? "READY" : "NOT READY") : "WAITING"}</span>
            </div>
        </div>

        {#if lobbyRole === "host"}
            <p class="dg-hint">Share the code with another player, or start solo.</p>
            <button class="dg-btn dg-btn-primary" disabled={hasOpponent && !allReady} onclick={hostStartGame}>
                {hasOpponent ? (allReady ? "START GAME" : "WAITING FOR READY") : "START SOLO"}
            </button>
        {:else}
            <button
                class="dg-btn dg-btn-primary"
                onclick={async () => {
                    try {
                        await setReady(true);
                    } catch (err) {
                        relayStatus = "error";
                        relayError = err instanceof Error ? err.message : String(err);
                    }
                }}
                disabled={readySelf || relayStatus !== "connected"}
            >
                {readySelf ? "READY" : "READY UP"}
            </button>
            <p class="dg-hint">Host will start the run when both players are ready.</p>
        {/if}
    </div>
</div>

<!-- ── Playing ────────────────────────────────────────────────────── -->
{:else if phase === "playing"}
<div class="dg-root dg-vault-screen dg-game" class:dg-floor-transition={floorTransition}>
    <div class="dg-vault-bg" aria-hidden="true"></div>
    <div class="dg-vault-shell">
        <!-- HUD -->
        <div class="dg-hud">
            <div class="dg-hud-left">
                <span class="dg-hud-floor">ROOM {currentFloor}/{TOTAL_FLOORS}</span>
                <span class="dg-hud-proof-type">
                    {#if floorDef.verifierType === "GROTH16"}
                        VERIFIER: GROTH16 (BN254)
                    {:else if floorDef.verifierType === "NOIR_ULTRAHONK"}
                        VERIFIER: ULTRAHONK (NOIR)
                    {:else}
                        VERIFIER: RISC0 RECEIPT (ZKVM)
                    {/if}
                    {#if floorDef.verifierType !== "GROTH16"}
                        <span class="dg-proof-note">TRAINING CREDENTIAL</span>
                    {/if}
                </span>
            </div>
            <div class="dg-hud-center">
                <div class="dg-progress-bar">
                    <div class="dg-progress-fill" style="width: {progressPct}%"></div>
                </div>
            </div>
            <div class="dg-hud-right">
                <span class="dg-hud-attempts">ATTEMPTS: {attempts}</span>
                {#if multiplayerEnabled && opponentProgress}
                    <span class="dg-hud-opponent">
                        P2 R{opponentProgress.floor} A{opponentProgress.attempts}
                    </span>
                {/if}
                <button class="dg-hud-btn" onclick={toggleFullscreen}>
                    {fullscreen ? "EXIT FS" : "FS"}
                </button>
            </div>
        </div>

        <div class="dg-room-grid">
            <!-- Left: Lore + placard + forensics -->
            <section class="dg-panel dg-panel-lore" aria-label="Lore Scroll">
                <div class="dg-panel-head">LORE SCROLL</div>
                <div class="dg-room-title">{roomLore.roomTitle}</div>
                <div class="dg-room-sub">{roomLore.roomSubtitle}</div>
                {#each roomLore.briefingMarkdown.split("\n\n") as para (para)}
                    <p class="dg-lore-p">{para}</p>
                {/each}

                <div class="dg-panel-split"></div>
                <div class="dg-panel-head">PROTOCOL PLACARD</div>
                <p class="dg-placard">{roomLore.protocolPlacard}</p>
                <div class="dg-placard-sub">{roomLore.verifierExplainer}</div>

                {#if lastForensics}
                    <div class="dg-panel-split"></div>
                    <div class="dg-panel-head">FORENSICS</div>
                    <div class="dg-forensics dg-forensics-{lastForensics.accepted ? 'ok' : 'no'}" aria-live="polite">
                        <p class="dg-forensics-outcome">
                            {lastForensics.accepted ? "ACCESS GRANTED" : "ACCESS DENIED"}
                        </p>
                        <p class="dg-forensics-why">{lastForensics.reasonHuman}</p>
                        <div class="dg-forensics-grid">
                            <div class="dg-forensics-item">
                                <span class="k">Door Policy</span>
                                <span class="v">{lastForensics.forensics.policyRule}</span>
                            </div>
                            <div class="dg-forensics-item">
                                <span class="k">Verifier</span>
                                <span class="v">
                                    {lastForensics.proofOk ? "PROOF VALID" : "PROOF INVALID"}
                                    {#if lastForensics.trainingOnly}
                                        <span class="dg-proof-note">TRAINING</span>
                                    {/if}
                                </span>
                            </div>
                            <div class="dg-forensics-item">
                                <span class="k">Your Credential</span>
                                <span class="v">{lastForensics.forensics.yourCredentialSummary}</span>
                            </div>
                            <div class="dg-forensics-item">
                                <span class="k">Mismatch</span>
                                <span class="v">{lastForensics.forensics.mismatchExplanation}</span>
                            </div>
                            <div class="dg-forensics-item">
                                <span class="k">Next Action</span>
                                <span class="v">{lastForensics.forensics.nextAction}</span>
                            </div>
                        </div>

                        {#if trainingMode && lastForensics.debug}
                            <div class="dg-forensics-debug">
                                <p class="dg-debug-title">TRAINING: COMPARISON TRACE</p>
                                <ul class="dg-debug-list">
                                    {#each lastForensics.debug.comparisons as line}
                                        <li>{line}</li>
                                    {/each}
                                </ul>
                            </div>
                        {/if}
                    </div>
                {/if}
            </section>

            <!-- Center: Doors -->
            <section class="dg-panel dg-panel-doors" aria-label="Doors">
                <div class="dg-floor-header">
                    <h2 class="dg-floor-name">POLICY: {floorDef.policyName}</h2>
                    <p class="dg-floor-desc">{floorDef.briefing}</p>
                    <div class="dg-floor-controls">
                        <label class="dg-toggle">
                            <input type="checkbox" bind:checked={trainingMode} />
                            <span>TRAINING MODE</span>
                        </label>
                        <span class="dg-hint-pill">CLEARANCE: TIER {effectiveTierId}</span>
                        {#if attestedTierId !== null}
                            <span class="dg-cred-source">ON-CHAIN</span>
                        {:else}
                            <span class="dg-cred-source dg-cred-source-demo">DEMO</span>
                        {/if}
                    </div>
                </div>

                {#if gateWaiting}
                    <div class="dg-gate-overlay">
                        <div class="dg-gate-panel">
                            <p class="dg-gate-title">CO-OP GATE</p>
                            <p class="dg-gate-desc">Waiting for both auditors to reach this room...</p>
                            <div class="dg-gate-spinner"></div>
                        </div>
                    </div>
                {:else}
                    <div class="dg-doors">
                        {#each doorStates as state, i}
                            {@const def = doorDef(i as any)}
                            <button
                                class="dg-door dg-door-{state}"
                                class:dg-door-suggested={trainingMode && doorWouldAccept(def)}
                                disabled={state !== "idle" || activeDoor !== null}
                                onclick={() => chooseDoor(i)}
                            >
                                <span class="dg-door-rune">{DOOR_SYMBOLS[i]}</span>
                                <span class="dg-door-label">DOOR {i + 1}</span>
                                <div class="dg-door-tags" aria-label="Door policy tags">
                                    {#each def.tags as tag}
                                        <span class="dg-door-tag">{tag.short}</span>
                                    {/each}
                                </div>
                                {#if state === "proving"}
                                    <span class="dg-door-status">VERIFYING...</span>
                                {:else if state === "correct"}
                                    <span class="dg-door-status dg-status-correct">OPENED</span>
                                {:else if state === "wrong"}
                                    <span class="dg-door-status dg-status-wrong">SEALED</span>
                                {/if}
                                <div class="dg-door-glow" style="--door-color: {DOOR_COLORS[i]}"></div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </section>

            <!-- Right: Notebook / log -->
            <section class="dg-panel dg-panel-notebook" aria-label="Runner's Notebook">
                <div class="dg-panel-head">RUNNER'S NOTEBOOK</div>
                <div class="dg-notebook-art">
                    <img class="dg-notebook-guardian" src={guardianArt} alt="" loading="lazy" />
                    <img class="dg-notebook-badge" src={verifierBadgeArt} alt="" loading="lazy" />
                </div>
                <div class="dg-note-line">
                    RUN ID: <span class="dg-mono">{runId ? runId.slice(0, 8) + "..." : "—"}</span>
                </div>
                <div class="dg-note-line">
                    ENTRY STAMP: <span class="dg-mono">{entryStamp.status}</span>
                    {#if entryStamp.txHash}
                        <a class="dg-mini-link" href={txExplorerUrlMainnet(entryStamp.txHash)} target="_blank" rel="noreferrer">tx</a>
                    {/if}
                </div>
                <div class="dg-note-line">
                    WITHDRAWAL: <span class="dg-mono">{withdrawalStamp.status}</span>
                    {#if withdrawalStamp.txHash}
                        <a class="dg-mini-link" href={txExplorerUrlMainnet(withdrawalStamp.txHash)} target="_blank" rel="noreferrer">tx</a>
                    {/if}
                </div>

                <div class="dg-panel-split"></div>
                <div class="dg-run-log">
                    <div class="dg-run-log-header">
                        <span>RUN LOG</span>
                        <span class="dg-run-log-count">{runLog.length}</span>
                    </div>
                    <div class="dg-run-log-entries">
                        {#each runLog.toReversed() as entry}
                            <div class="dg-log-entry dg-log-{entry.result}">
                                {#if entry.floor === 0}
                                    <span class="dg-log-text">Run initialized</span>
                                {:else if entry.door === -1}
                                    <span class="dg-log-text">Puzzle rooms cleared</span>
                                {:else}
                                    <span class="dg-log-floor">R{entry.floor}</span>
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
                                <span class="dg-log-tx dg-log-tx-pending">--</span>
                            </div>
                        {/each}
                    </div>
                </div>

                <div class="dg-panel-split"></div>
                <p class="dg-hint">
                    Rooms 2–3 use verified training credentials (real verifiers) unless live proving is added later.
                </p>
                <img class="dg-notebook-blueprint" src="/labs/zkdungeon/art/vault-blueprint-map.webp" alt="" loading="lazy" />
            </section>
        </div>
    </div>
</div>

<!-- ── Ledger Chamber ──────────────────────────────────────────────── -->
{:else if phase === "ledger"}
<div class="dg-root dg-vault-screen dg-ledger">
    <div class="dg-vault-bg" aria-hidden="true"></div>
    <div class="dg-vault-shell">
        <button class="dg-back-btn" onclick={resetGame}>&larr; BACK</button>

        <div class="dg-vault-header">
            <img class="dg-room-art" src={roomHeaderArt} alt="" loading="eager" />
            <div class="dg-vault-roomtitle">
                <p class="dg-eyebrow">THE KALE-SEED VAULT</p>
                <h2 class="dg-lobby-title">{roomLore.roomTitle}</h2>
                <p class="dg-subtitle">{roomLore.roomSubtitle}</p>
            </div>
        </div>

        <div class="dg-vault-grid">
            <section class="dg-panel dg-panel-lore" aria-label="Lore Scroll">
                <div class="dg-panel-head">LORE SCROLL</div>
                {#each roomLore.briefingMarkdown.split("\n\n") as para (para)}
                    <p class="dg-lore-p">{para}</p>
                {/each}
            </section>

            <section class="dg-panel dg-panel-placard" aria-label="Protocol Placard">
                <div class="dg-panel-head">PROTOCOL PLACARD</div>
                <p class="dg-placard">{roomLore.protocolPlacard}</p>
                <div class="dg-placard-sub">{roomLore.verifierExplainer}</div>

                <div class="dg-stamp-box">
                    <div class="dg-stamp-title">WITHDRAWAL RECORD (MAINNET)</div>
                    <div class="dg-stamp-status">STATUS: {withdrawalStamp.status.toUpperCase()}</div>
                    {#if withdrawalStamp.txHash}
                        <a class="dg-stamp-link" href={txExplorerUrlMainnet(withdrawalStamp.txHash)} target="_blank" rel="noreferrer">
                            VIEW TX {withdrawalStamp.txHash.slice(0, 8)}...
                        </a>
                    {/if}
                    {#if withdrawalStamp.error}
                        <div class="dg-stamp-error">{withdrawalStamp.error}</div>
                    {/if}

                    {#if isConnected}
                        <button
                            class="dg-btn dg-btn-primary"
                            disabled={withdrawalStamp.status === "simulating" || withdrawalStamp.status === "assembling" || withdrawalStamp.status === "signing"}
                            onclick={() => stampOnChain("WITHDRAWAL")}
                        >
                            RECORD SEED WITHDRAWAL ON-CHAIN (PASSKEY)
                        </button>
                    {:else}
                        <button class="dg-btn dg-btn-secondary" onclick={connectWallet}>CONNECT WALLET (PASSKEY)</button>
                    {/if}
                </div>

                <div class="dg-vault-actions">
                    <button class="dg-btn dg-btn-primary" onclick={finishRun}>
                        FINISH RUN →
                    </button>
                    {#if withdrawalStamp.status !== "confirmed"}
                        <p class="dg-hint">No completion stamp yet. Reviewer-proof run includes the withdrawal record.</p>
                    {/if}
                </div>
            </section>
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
        <p class="dg-victory-subtitle">Seed vault tour completed. Room verifiers are real; on-chain stamps are digest-only records signed with your passkey (if used).</p>

        <div class="dg-victory-stats">
            <div class="dg-stat">
                <span class="dg-stat-value">{TOTAL_FLOORS}</span>
                <span class="dg-stat-label">ROOMS</span>
            </div>
            <div class="dg-stat">
                <span class="dg-stat-value">{attempts}</span>
                <span class="dg-stat-label">ATTEMPTS</span>
            </div>
            <div class="dg-stat">
                <span class="dg-stat-value">{runLog.filter(e => e.door >= 0).length}</span>
                <span class="dg-stat-label">PROOFS</span>
            </div>
        </div>

        <div class="dg-victory-log-summary">
            <p class="dg-victory-log-title">PROOF TYPES USED</p>
            <div class="dg-proof-types">
                {#each [...new Set(runLog.filter(e => e.door >= 0).map(e => e.proofType))] as pt}
                    <span class="dg-proof-badge">{pt}</span>
                {/each}
            </div>
        </div>

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
        width: 280px;
        max-width: 90vw;
        outline: none;
    }

    /* ── Kale-Seed Vault Layout ─────────────────────────────────────── */
    .dg-vault-screen {
        position: relative;
        min-height: 100vh;
        background: radial-gradient(1200px 700px at 15% 10%, rgba(154, 230, 0, 0.10), transparent 60%),
            radial-gradient(900px 600px at 80% 30%, rgba(74, 208, 255, 0.12), transparent 55%),
            radial-gradient(900px 700px at 70% 90%, rgba(155, 123, 255, 0.10), transparent 60%),
            #03060b;
        overflow-x: hidden;
        overflow-y: auto;
    }

    .dg-vault-bg {
        position: absolute;
        inset: 0;
        background-image:
            url("/labs/zkdungeon/art/texture-midnight-kale.webp"),
            url("/labs/zkdungeon/art/vault-blueprint-map.webp");
        background-size: 1024px 1024px, cover;
        background-position: center, center;
        opacity: 0.35;
        filter: saturate(1.05) contrast(1.05);
        pointer-events: none;
    }

    .dg-vault-shell {
        position: relative;
        max-width: 1500px;
        margin: 0 auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .dg-vault-header {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
    }

    .dg-room-art {
        width: 100%;
        height: auto;
        max-height: 260px;
        object-fit: cover;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow: 0 14px 60px rgba(0, 0, 0, 0.55);
    }

    @media (min-width: 1100px) {
        /* Reduce vertical "hero" height so the Airlock primary action stays above the fold. */
        .dg-vault-header {
            grid-template-columns: 1.25fr 0.75fr;
            align-items: end;
            gap: 16px;
        }
        .dg-room-art {
            max-height: 220px;
        }
    }

    @media (max-height: 760px) {
        .dg-room-art {
            max-height: 190px;
        }
        .dg-vault-shell {
            padding: 18px;
        }
    }

    .dg-vault-grid,
    .dg-room-grid {
        display: grid;
        grid-template-columns: 1.05fr 1.2fr 0.75fr;
        gap: 16px;
        align-items: start;
    }

    .dg-panel {
        background: rgba(8, 12, 20, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 18px;
        backdrop-filter: blur(10px);
        box-shadow: 0 18px 70px rgba(0, 0, 0, 0.40);
        overflow: hidden;
    }

    .dg-panel-head {
        padding: 12px 14px;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(232, 240, 255, 0.70);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background-image: url("/labs/zkdungeon/art/texture-placard.webp");
        background-size: 512px 512px;
        background-repeat: repeat;
    }

    .dg-panel-lore {
        padding-bottom: 12px;
        background-image: url("/labs/zkdungeon/art/texture-midnight-kale.webp");
        background-size: 1024px 1024px;
        background-repeat: repeat;
        background-color: rgba(8, 12, 20, 0.78);
        background-blend-mode: overlay;
    }

    .dg-panel-doors {
        padding-bottom: 18px;
    }

    .dg-panel-placard {
        padding-bottom: 16px;
    }

    .dg-panel-notebook {
        padding: 0 0 14px;
    }

    .dg-room-title {
        padding: 12px 14px 0;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.03em;
    }

    .dg-room-sub {
        padding: 0 14px 10px;
        font-size: 12px;
        color: rgba(232, 240, 255, 0.65);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .dg-lore-p {
        padding: 0 14px;
        margin: 10px 0;
        line-height: 1.55;
        color: rgba(232, 240, 255, 0.82);
        font-size: 13px;
    }

    .dg-panel-split {
        height: 1px;
        background: rgba(255, 255, 255, 0.08);
        margin: 12px 14px;
    }

    .dg-placard {
        padding: 0 14px;
        margin: 10px 0 0;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: rgba(232, 240, 255, 0.92);
    }

    .dg-placard-sub {
        padding: 8px 14px 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(232, 240, 255, 0.68);
    }

    .dg-proof-note {
        margin-left: 8px;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(232, 240, 255, 0.72);
    }

    .dg-notebook-art {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        padding: 14px;
    }

    .dg-notebook-guardian {
        width: 100%;
        height: auto;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.10);
    }

    .dg-notebook-badge {
        width: 76px;
        height: 76px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(0, 0, 0, 0.25);
    }

    .dg-notebook-blueprint {
        width: calc(100% - 28px);
        margin: 10px 14px 0;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        opacity: 0.85;
    }

    .dg-note-line {
        padding: 0 14px;
        margin: 8px 0;
        font-size: 12px;
        color: rgba(232, 240, 255, 0.75);
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .dg-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        letter-spacing: 0.03em;
    }

    .dg-mini-link {
        margin-left: 8px;
        color: rgba(74, 208, 255, 0.85);
        text-decoration: none;
    }

    .dg-mini-link:hover {
        text-decoration: underline;
    }

    /* Airlock + ledger */
    .dg-stamp-box {
        margin: 14px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(0, 0, 0, 0.22);
    }

    .dg-stamp-title {
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(232, 240, 255, 0.88);
        margin-bottom: 6px;
    }

    .dg-stamp-status {
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(232, 240, 255, 0.65);
        margin-bottom: 8px;
    }

    .dg-stamp-link {
        display: inline-block;
        font-size: 12px;
        color: rgba(74, 208, 255, 0.88);
        text-decoration: none;
        margin-bottom: 8px;
    }

    .dg-stamp-link:hover {
        text-decoration: underline;
    }

    .dg-stamp-error {
        margin-top: 8px;
        font-size: 12px;
        color: rgba(255, 196, 122, 0.92);
    }

    .dg-vault-actions {
        padding: 0 14px 14px;
    }

    /* Responsive */
    @media (max-width: 1100px) {
        .dg-vault-grid,
        .dg-room-grid {
            grid-template-columns: 1fr;
        }
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
        width: min(520px, 94vw);
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: stretch;
        padding: 12px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        background: rgba(255,255,255,0.03);
    }

    .dg-join-label {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        color: var(--dg-text-dim);
        text-transform: uppercase;
    }

    .dg-join-controls {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }

    .dg-btn-join {
        min-width: 170px;
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

    .dg-cred-card {
        margin-top: 14px;
        padding: 14px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        text-align: left;
    }

    .dg-cred-line {
        margin: 0;
        font-family: var(--dg-font-display);
        font-size: 10px;
        letter-spacing: 2px;
        color: rgba(255,255,255,0.86);
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .dg-cred-source {
        font-size: 9px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(74, 222, 128, 0.35);
        background: rgba(74, 222, 128, 0.08);
        color: rgba(74, 222, 128, 0.95);
    }

    .dg-cred-source-demo {
        border-color: rgba(255, 196, 122, 0.35);
        background: rgba(255, 196, 122, 0.08);
        color: rgba(255, 196, 122, 0.95);
    }

    .dg-cred-warn {
        margin: 10px 0 0;
        font-size: 11px;
        color: rgba(255, 196, 122, 0.85);
        line-height: 1.35;
    }

    .dg-cred-controls {
        margin-top: 12px;
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
    }

    .dg-cred-override {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
    }

    .dg-select {
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.86);
        font-family: var(--dg-font-display);
        font-size: 10px;
        letter-spacing: 1px;
        text-transform: uppercase;
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

    .dg-relay-status {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
        margin: -8px 0 18px;
    }

    .dg-relay-pill {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.05);
        color: var(--dg-text-dim);
    }
    .dg-relay-connected {
        color: rgba(74, 222, 128, 0.95);
        border-color: rgba(74, 222, 128, 0.35);
        background: rgba(74, 222, 128, 0.08);
    }
    .dg-relay-connecting {
        color: rgba(255, 196, 122, 0.95);
        border-color: rgba(255, 196, 122, 0.35);
        background: rgba(255, 196, 122, 0.08);
    }
    .dg-relay-error {
        color: rgba(248, 113, 113, 0.95);
        border-color: rgba(248, 113, 113, 0.35);
        background: rgba(248, 113, 113, 0.08);
    }

    .dg-relay-detail {
        font-size: 11px;
        color: rgba(248, 113, 113, 0.85);
        max-width: 60ch;
        text-wrap: balance;
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

    .dg-hud-opponent {
        font-family: var(--dg-font-display);
        font-size: 10px;
        letter-spacing: 1px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.75);
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

    .dg-floor-controls {
        margin-top: 14px;
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }

    .dg-toggle {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04);
        color: var(--dg-text-dim);
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 1px;
        cursor: pointer;
        user-select: none;
    }

    .dg-toggle input {
        width: 14px;
        height: 14px;
        accent-color: var(--dg-accent);
    }

    .dg-hint-pill {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 196, 122, 0.35);
        background: rgba(255, 196, 122, 0.08);
        color: rgba(255, 196, 122, 0.95);
    }

    .dg-forensics {
        width: min(820px, 96vw);
        margin: -8px auto 18px;
        padding: 16px 16px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        text-align: left;
    }

    .dg-forensics-ok {
        border-color: rgba(74, 222, 128, 0.25);
        background: rgba(74, 222, 128, 0.06);
    }

    .dg-forensics-no {
        border-color: rgba(248, 113, 113, 0.25);
        background: rgba(248, 113, 113, 0.06);
    }

    .dg-forensics-outcome {
        margin: 0 0 6px;
        font-family: var(--dg-font-display);
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: rgba(255,255,255,0.92);
    }

    .dg-forensics-why {
        margin: 0 0 12px;
        font-size: 12px;
        color: rgba(255,255,255,0.78);
        line-height: 1.45;
    }

    .dg-forensics-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    @media (max-width: 700px) {
        .dg-forensics-grid {
            grid-template-columns: 1fr;
        }
    }

    .dg-forensics-item {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .dg-forensics-item .k {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        color: rgba(255,255,255,0.55);
        text-transform: uppercase;
    }

    .dg-forensics-item .v {
        font-size: 12px;
        color: rgba(255,255,255,0.82);
        line-height: 1.35;
    }

    .dg-forensics-debug {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px dashed rgba(255,255,255,0.12);
    }

    .dg-debug-title {
        margin: 0 0 8px;
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: rgba(255, 196, 122, 0.95);
    }

    .dg-debug-list {
        margin: 0;
        padding-left: 18px;
        color: rgba(255,255,255,0.70);
        font-family: "JetBrains Mono", monospace;
        font-size: 11px;
        line-height: 1.45;
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

    .dg-door-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        margin-top: -2px;
    }

    .dg-door-tag {
        font-family: var(--dg-font-display);
        font-size: 8px;
        letter-spacing: 1px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.70);
        text-transform: uppercase;
    }

    .dg-door-suggested {
        outline: 2px solid rgba(255, 196, 122, 0.25);
        box-shadow: 0 0 0 6px rgba(255, 196, 122, 0.05);
    }

    .dg-door-status {
        font-family: var(--dg-font-display);
        font-size: 9px;
        letter-spacing: 1px;
        padding: 4px 10px;
        border-radius: 4px;
    }

    .dg-status-correct {
        color: var(--dg-correct);
        background: rgba(74,222,128,0.1);
    }

    .dg-status-wrong {
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

    .dg-proof-groth16 {
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
