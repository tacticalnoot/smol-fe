<script lang="ts">
    import { untrack } from "svelte";
    import { userState, getPasskeyKit } from "../../../stores/user.svelte.ts";
    import {
        balanceState,
        updateContractBalance,
    } from "../../../stores/balance.svelte.ts";
    import FarmBadge from "./FarmBadge.svelte";
    import {
        BADGE_REGISTRY,
        TIER_CONFIG,
        getTierForBalance,
        getTierIdForBalance,
        formatKaleBalance,
        buildProofPacket,
        saveEarnedBadge,
        loadAllBadges,
        type EarnedBadge,
        type TierProofInputs,
        type ProofResult,
        type ZkGameProof,
    } from "./zkTypes";
    // Dynamic Logic Modules (Types only)
    import type * as ZkProofModule from "./zkProof";
    import type * as ZkGamesModule from "./zkGames";

    // ── State ──────────────────────────────────────────────────────────────
    let proving = $state(false);
    let error = $state<string | null>(null);
    let copied = $state(false);
    let earned = $state<Record<string, EarnedBadge>>({});
    let audioOn = $state(false);
    let mounted = $state(false);
    let activeProof = $state<GalleryProof | null>(null);
    let showCelebration = $state(false);
    let gameProofs = $state<Record<string, ZkGameProof>>({});
    let gameError = $state<string | null>(null);
    let gameCopied = $state<string | null>(null);
    let gameForging = $state<string | null>(null);
    let gameWallet = $state<string | null>(null);
    let verifying = $state(false);
    let verifyResult = $state<boolean | null>(null);
    let proofData = $state<ProofResult | null>(null);
    let txHash = $state<string | null>(null);

    let onChainVerified = $state<boolean | null>(null);

    // Dynamic Modules
    let zkLogic = $state<typeof ZkProofModule | null>(null);
    let zkGamesLogic = $state<typeof ZkGamesModule | null>(null);

    type GalleryProof = {
        id: string;
        title: string;
        summary: string;
        proof: string;
        circuit: string;
        status: string;
        file: string;
        wallet: string;
        tags: string[];
        tested: string;
        inputs: string[];
        outputs: string[];
        note: string;
        requiresKale?: boolean;
        requirementCopy?: string;
    };

    type ZkGame = {
        id: string;
        title: string;
        summary: string;
        goal: string;
        circuit: string;
        actionLabel: string;
        requirements: number[];
        color: string;
    };

    type ZkGameSession = ZkGame & {
        progress: number;
        level: number;
        score: number;
        actionLog: string[];
        status: "idle" | "playing" | "complete";
        proof?: ZkGameProof;
    };

    const baseZkGames: ZkGame[] = [
        {
            id: "tic-tac-tac",
            title: "Stellar Tic-Tac-Tac",
            summary: "Prove a winning line without revealing the full board.",
            goal: "Complete 3 smart moves to unlock the win proof.",
            circuit: "GridMate v0.1",
            actionLabel: "Place glyph",
            requirements: [3, 5, 7],
            color: "#38bdf8",
        },
        {
            id: "asteroid-dodge",
            title: "Asteroid Dodge",
            summary: "Prove you dodged hazards for a full run, no path leaks.",
            goal: "Survive the dodge sequence to mint a run proof.",
            circuit: "DodgeSeal v0.2",
            actionLabel: "Dodge",
            requirements: [5, 7, 9],
            color: "#f472b6",
        },
        {
            id: "pattern-runner",
            title: "Pattern Runner",
            summary: "Prove you matched a secret rhythm streak.",
            goal: "Hit the rhythm targets to unlock the streak proof.",
            circuit: "RhythmLock v0.1",
            actionLabel: "Tap beat",
            requirements: [4, 6, 8],
            color: "#c084fc",
        },
    ];

    let zkGames = $state<ZkGameSession[]>(
        baseZkGames.map((game) => ({
            ...game,
            progress: 0,
            level: 1,
            score: 0,
            actionLog: [],
            status: "idle",
        })),
    );

    // 4 focused proofs: 1 live + 3 Smol-native concepts
    const galleryProofs: GalleryProof[] = [
        {
            id: "kale-bloom",
            title: "Kale Bloom",
            summary:
                "Prove your KALE tier via Groth16 on BN254. On-chain verification via Protocol 25.",
            proof: "Groth16 ZK-SNARK on BN254 curve",
            circuit: "tier_proof.circom",
            status: "LIVE",
            file: "/proofs/smol-proof-of-farm.json",
            wallet: "Your connected wallet",
            tags: ["zk", "groth16", "on-chain"],
            tested: "Verified on Stellar mainnet",
            inputs: ["address hash", "balance", "salt", "tier threshold"],
            outputs: ["commitment", "tier valid flag"],
            note: "Generate above, then verify on-chain via the tier-verifier contract.",
            requiresKale: true,
            requirementCopy: "Requires KALE balance to generate proof.",
        },
        {
            id: "melody-mint",
            title: "Melody Mint",
            summary:
                "Prove you minted N songs as NFTs without revealing which songs.",
            proof: "Planned: Merkle inclusion proof",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-melody-mint.json",
            wallet: "Your connected wallet",
            tags: ["nft", "merkle", "privacy"],
            tested: "Design concept",
            inputs: ["mint root", "leaf proofs", "mint count threshold"],
            outputs: ["threshold met flag", "root valid flag"],
            note: "Would prove music NFT minting activity while preserving creator privacy.",
            requiresKale: false,
            requirementCopy: "Concept proof — coming soon.",
        },
        {
            id: "mixtape-seal",
            title: "Mixtape Seal",
            summary:
                "Prove you curated a mixtape with N tracks without revealing the playlist.",
            proof: "Planned: Commitment chain proof",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-mixtape-seal.json",
            wallet: "Your connected wallet",
            tags: ["curation", "commitment", "privacy"],
            tested: "Design concept",
            inputs: ["mixtape hash", "track count", "curator address"],
            outputs: ["curator attestation", "track threshold flag"],
            note: "Would prove curation activity while keeping playlist private.",
            requiresKale: false,
            requirementCopy: "Concept proof — coming soon.",
        },
        {
            id: "first-listen",
            title: "First Listen",
            summary:
                "Prove you played N songs on the platform without revealing listening history.",
            proof: "Planned: Nullifier-based play proof",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-first-listen.json",
            wallet: "Your connected wallet",
            tags: ["streaming", "nullifier", "privacy"],
            tested: "Design concept",
            inputs: ["play nullifiers", "threshold", "listener address"],
            outputs: ["listener attestation", "play count valid"],
            note: "Would prove listening activity without revealing specific songs.",
            requiresKale: false,
            requirementCopy: "Concept proof — coming soon.",
        },
    ];

    // ── Derived ────────────────────────────────────────────────────────────
    let isAuth = $derived(!!userState.contractId);
    let balance = $derived(balanceState.balance);
    let loading = $derived(balanceState.loading);
    let tier = $derived(balance !== null ? getTierForBalance(balance) : 0);
    let tierCfg = $derived(TIER_CONFIG[tier]);
    let hasProof = $derived(!!earned["proof-of-farm"]);
    let hasKale = $derived(balance !== null && balance > 0n);
    let gameWalletLabel = $derived(
        gameWallet ? `${gameWallet.slice(0, 6)}…${gameWallet.slice(-4)}` : "",
    );
    const confettiPieces = Array.from({ length: 24 }, (_, idx) => idx);

    // ── Effects ────────────────────────────────────────────────────────────
    $effect(() => {
        mounted = true;

        // Dynamically load ZK logic to prevent SSR/Load crash
        (async () => {
            try {
                const [zk, games] = await Promise.all([
                    import("./zkProof"),
                    import("./zkGames"),
                ]);
                zkLogic = zk;
                zkGamesLogic = games;
                console.log("[Farm] ZK Logic loaded");
            } catch (e) {
                console.error("[Farm] Failed to load ZK logic", e);
            }
        })();

        return () => {
            stopAmbient();
        };
    });

    // Load badges + refresh balance when authenticated
    // Load badges + refresh balance when authenticated
    $effect(() => {
        if (isAuth && userState.contractId) {
            earned = loadAllBadges(userState.contractId);
            updateContractBalance(userState.contractId);

            if (zkLogic) {
                zkLogic.checkAttestation(userState.contractId).then((res) => {
                    if (res.verified) {
                        onChainVerified = true;
                        console.log(
                            "[Farm] Confirmed existing on-chain attestation",
                            res,
                        );
                    }
                });
            }
        } else {
            earned = {};
        }
    });

    $effect(() => {
        if (typeof window === "undefined") return;

        // Wait for dynamic module to load
        if (!zkGamesLogic) return;

        const walletId =
            userState.contractId ?? zkGamesLogic.getOrCreateGameWalletId();
        gameWallet = walletId;
        const loadedProofs = zkGamesLogic.loadGameProofs(walletId);
        gameProofs = loadedProofs;

        // Use untrack to prevent infinite loop since we are writing to zkGames
        // AND use loadedProofs (local) instead of gameProofs (state) to avoid tracking that dependency
        zkGames = untrack(() => zkGames).map((game) => ({
            ...game,
            proof: loadedProofs[game.id],
        }));
    });

    // ── REAL ZK Proof Generation ────────────────────────────────────────────
    async function generateProof() {
        if (!userState.contractId || balance === null) return;
        error = null;
        proving = true;
        proofData = null;
        txHash = null;
        onChainVerified = null;

        try {
            // 1. Compute inputs for the ZK circuit
            if (!zkLogic)
                throw new Error("ZK Logic not loaded yet. Please wait.");

            const addressHash = await zkLogic.hashAddress(userState.contractId);
            const salt = zkLogic.generateRandomSalt();
            const tierId = getTierIdForBalance(balance);

            console.log("[ZK] Generating real Groth16 proof...", {
                tier: tierId,
                tierName: TIER_CONFIG[tierId]?.name,
            });

            // 2. Generate the REAL ZK proof
            const result = await zkLogic.generateTierProof(
                addressHash,
                balance,
                salt,
                tierId,
            );

            proofData = result;
            console.log("[ZK] Proof generated:", result.proof);

            // 3. Save locally with proof data
            const badge: EarnedBadge = {
                id: "proof-of-farm",
                earnedAt: Date.now(),
                data: {
                    tier: tierId,
                    tierName: TIER_CONFIG[tierId]?.name,
                    tierIcon: TIER_CONFIG[tierId]?.icon,
                    commitment: result.publicSignals[1], // commitment from proof
                    salt: salt.toString(),
                    proof: result.proof, // Store the real proof
                    publicSignals: result.publicSignals,
                    isRealZk: true, // Flag: this is REAL ZK
                },
            };

            saveEarnedBadge(userState.contractId, badge);
            earned = loadAllBadges(userState.contractId);
            showCelebration = true;
            playChime();
            setTimeout(() => {
                showCelebration = false;
            }, 2600);
        } catch (e: any) {
            console.error("[ZK] Proof generation failed:", e);
            error = e.message || "Proof generation failed";
        } finally {
            proving = false;
        }
    }

    async function copyProofPacket() {
        if (!userState.contractId) return;
        const badge = earned["proof-of-farm"];
        if (!badge) return;
        copied = false;
        try {
            const packet = buildProofPacket(badge, userState.contractId);
            await navigator.clipboard.writeText(
                JSON.stringify(packet, null, 2),
            );
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        } catch (e: any) {
            error = e.message || "Unable to copy proof payload";
        }
    }

    // ── REAL On-Chain Verification ──────────────────────────────────────────
    async function verifyProof() {
        if (!userState.contractId) return;
        const badge = earned["proof-of-farm"];
        if (!badge?.data?.proof) {
            error = "No real ZK proof found. Generate a new proof first.";
            return;
        }

        verifying = true;
        verifyResult = null;
        error = null;
        txHash = null;
        onChainVerified = null;

        try {
            console.log("[ZK] Starting on-chain verification...");

            // 1. Verify locally first (fast check)
            if (!zkLogic) throw new Error("ZK Logic not loaded");
            const isValid = await zkLogic.verifyProofLocally(
                badge.data.proof as any,
                badge.data.publicSignals as string[],
            );

            if (!isValid) {
                throw new Error("Local verification failed. Proof is invalid.");
            }
            verifyResult = true;

            // 2. Submit to Soroban tier-verifier contract
            console.log("[ZK] Submitting to mainnet contract...");

            // Get passkey kit
            const kit = await getPasskeyKit();
            if (!kit) {
                throw new Error("Wallet not connected or kit not available.");
            }

            // Prepare inputs
            // Cast badge data to expected type since earnBadge uses a generic record
            const proofData = badge.data as {
                proof: any;
                commitment: string;
                tier: number;
            };

            // Helper to convert bigint string to 32-byte Uint8Array
            const toBytes32 = (n: bigint | string) => {
                let b = BigInt(n);
                const bytes = new Uint8Array(32);
                for (let i = 31; i >= 0; i--) {
                    bytes[i] = Number(b & 0xffn);
                    b >>= 8n;
                }
                return bytes; // Big-endian
            };

            const commitmentBytes = toBytes32(proofData.commitment);

            const result = await zkLogic.submitProofToContract(
                kit,
                userState.contractId,
                proofData.tier,
                commitmentBytes,
                proofData.proof,
            );

            if (result.success && result.txHash) {
                txHash = result.txHash;
                onChainVerified = true;
                console.log("[ZK] On-chain verification successful!", txHash);
                playChime();
            } else {
                throw new Error(result.error || "Transaction failed");
            }
        } catch (e: any) {
            console.error("[ZK] Verification error:", e);
            error = e.message || "Verification failed";
            verifyResult = false;
        } finally {
            verifying = false;
        }
    }

    // ── Ambient Audio (Web Audio API, <60 lines) ──────────────────────────
    let audioCtx: AudioContext | null = null;
    let ambientGain: GainNode | null = null;
    let oscs: OscillatorNode[] = [];

    function toggleAudio() {
        audioOn = !audioOn;
        audioOn ? startAmbient() : stopAmbient();
    }

    function startAmbient() {
        if (audioCtx) return;
        audioCtx = new AudioContext();
        ambientGain = audioCtx.createGain();
        ambientGain.gain.value = 0.06;
        ambientGain.connect(audioCtx.destination);

        // Two detuned oscillators — C4 + E4 with slow LFO vibrato
        [261.63, 329.63].forEach((freq) => {
            const osc = audioCtx!.createOscillator();
            const g = audioCtx!.createGain();
            g.gain.value = 0.5;
            osc.type = "sine";
            osc.frequency.value = freq;

            const lfo = audioCtx!.createOscillator();
            const lfoG = audioCtx!.createGain();
            lfo.frequency.value = 0.15;
            lfoG.gain.value = 2.5;
            lfo.connect(lfoG);
            lfoG.connect(osc.frequency);
            lfo.start();

            osc.connect(g);
            g.connect(ambientGain!);
            osc.start();
            oscs.push(osc, lfo);
        });
    }

    function stopAmbient() {
        oscs.forEach((o) => {
            try {
                o.stop();
            } catch {}
        });
        oscs = [];
        audioCtx?.close().catch(() => {});
        audioCtx = null;
        ambientGain = null;
    }

    function playChime() {
        const transient = !audioCtx;
        const ctx = audioCtx ?? new AudioContext();
        const notes = [261.63, 329.63, 392.0, 493.88]; // C-E-G-B
        notes.forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "triangle";
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
            g.gain.exponentialRampToValueAtTime(
                0.001,
                ctx.currentTime + i * 0.18 + 0.7,
            );
            o.connect(g);
            g.connect(ctx.destination);
            if (transient && i === notes.length - 1) {
                o.onended = () => {
                    ctx.close().catch(() => {});
                };
            }
            o.start(ctx.currentTime + i * 0.18);
            o.stop(ctx.currentTime + i * 0.18 + 0.7);
        });
    }

    function openProof(proof: GalleryProof) {
        activeProof = proof;
    }

    function closeProof() {
        activeProof = null;
    }

    function getRequirement(game: ZkGameSession): number {
        return game.requirements[
            Math.min(game.level - 1, game.requirements.length - 1)
        ];
    }

    function updateGame(gameId: string, updates: Partial<ZkGameSession>) {
        zkGames = zkGames.map((game) =>
            game.id === gameId ? { ...game, ...updates } : game,
        );
    }

    function logGameAction(game: ZkGameSession) {
        const actionOptions: Record<string, string[]> = {
            "tic-tac-tac": ["glyph-corner", "glyph-center", "glyph-edge"],
            "asteroid-dodge": ["dodge-left", "dodge-right", "boost"],
            "pattern-runner": ["tap-gold", "tap-emerald", "tap-rose"],
        };
        const actions = actionOptions[game.id] ?? ["tap"];
        const action = actions[Math.floor(Math.random() * actions.length)];
        const scoreGain = 10 + Math.floor(Math.random() * 12);
        const nextProgress = game.progress + 1;
        const requirement =
            game.requirements[
                Math.min(game.level - 1, game.requirements.length - 1)
            ];
        const nextStatus = nextProgress >= requirement ? "complete" : "playing";

        updateGame(game.id, {
            actionLog: [...game.actionLog, action],
            progress: nextProgress,
            score: game.score + scoreGain,
            status: nextStatus,
        });
    }

    function resetGame(game: ZkGameSession) {
        updateGame(game.id, {
            progress: 0,
            level: game.level,
            score: 0,
            actionLog: [],
            status: "idle",
        });
    }

    async function forgeGameProof(game: ZkGameSession) {
        const walletId = gameWallet ?? userState.contractId;
        if (!walletId || game.status !== "complete") return;
        gameError = null;
        gameForging = game.id;
        try {
            if (!zkGamesLogic) throw new Error("ZK Logic not loaded");
            const proof = await zkGamesLogic.createGameProof(
                game.id,
                game.title,
                walletId,
                game.level,
                game.score,
                {
                    actions: game.actionLog,
                    goal: game.goal,
                },
            );
            zkGamesLogic.saveGameProof(walletId, proof);
            gameProofs = zkGamesLogic.loadGameProofs(walletId);
            const nextLevel = Math.min(
                game.level + 1,
                game.requirements.length,
            );
            updateGame(game.id, {
                proof,
                level: nextLevel,
                progress: 0,
                score: 0,
                actionLog: [],
                status: "idle",
            });
        } catch (e: any) {
            gameError = e.message || "Unable to forge game proof";
        } finally {
            gameForging = null;
        }
    }

    async function copyGameProof(game: ZkGameSession) {
        if (!game.proof) return;
        gameCopied = null;
        try {
            if (!zkGamesLogic) throw new Error("ZK Logic not loaded");
            const packet = zkGamesLogic.buildGameProofPacket(game.proof);
            await navigator.clipboard.writeText(
                JSON.stringify(packet, null, 2),
            );
            gameCopied = game.id;
            setTimeout(() => {
                gameCopied = null;
            }, 2000);
        } catch (e: any) {
            gameError = e.message || "Unable to copy proof packet";
        }
    }
</script>

<div class="farm-root" class:farm-mounted={mounted}>
    <!-- ── Background Particles (reduced to 6) ── -->
    <div class="particles" aria-hidden="true">
        {#each Array(6) as _, i}
            <span
                class="particle"
                style="--d:{0.6 + Math.random() * 0.6};--x:{Math.random() *
                    100};--s:{8 + Math.random() * 14}"
            ></span>
        {/each}
    </div>

    <div class="farm-content">
        <!-- ── Header ── -->
        <header class="farm-header">
            <h1 class="farm-title">
                <span class="title-the">THE</span>
                <span class="title-farm">FARM</span>
            </h1>
            <p class="farm-subtitle">Zero-Knowledge Proofs on Stellar</p>
            {#if isAuth}
                <div class="farm-tag">
                    <span class="tag-dot"></span>
                    <span>Connected</span>
                </div>
            {/if}
        </header>

        {#if !isAuth}
            <!-- ── Landing (not authenticated) ── -->
            <div class="landing-cta">
                <p class="landing-line">Prove your KALE farming tier</p>
                <p class="landing-line dim">without revealing your balance.</p>
                <p class="landing-connect">
                    Connect via the header to enter your farm
                </p>
            </div>
        {:else if loading && balance === null}
            <!-- ── Loading balance ── -->
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p class="loading-text">Reading your KALE balance...</p>
            </div>
        {:else}
            <!-- Proof Section -->
            <section class="proof-section">
                <div class="proof-card">
                    <!-- Tier Display -->
                    <div class="proof-tier">
                        <span class="tier-icon">{tierCfg.icon}</span>
                        <div class="tier-info">
                            <span
                                class="tier-name"
                                style="color:{tierCfg.color}"
                                >{tierCfg.name}</span
                            >
                            {#if balance !== null}
                                <span class="tier-balance"
                                    >{formatKaleBalance(balance)} KALE</span
                                >
                            {/if}
                        </div>
                    </div>

                    {#if hasProof}
                        <!-- Proof Generated -->
                        <div class="proof-done">
                            <p class="proof-done-label">✓ ZK Proof Ready</p>
                            <div class="proof-actions">
                                <button
                                    class="proof-btn primary"
                                    type="button"
                                    onclick={verifyProof}
                                    disabled={verifying || onChainVerified}
                                >
                                    {#if verifying}Verifying...{:else if onChainVerified}Verified
                                        ✓{:else}Verify On-Chain{/if}
                                </button>
                                <button
                                    class="proof-btn"
                                    type="button"
                                    onclick={copyProofPacket}
                                >
                                    {copied ? "Copied" : "Copy"}
                                </button>
                            </div>
                            {#if onChainVerified && txHash}
                                <a
                                    href={`https://stellar.expert/explorer/public/tx/${txHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    class="proof-tx"
                                >
                                    TX: {txHash.slice(0, 8)}...{txHash.slice(
                                        -8,
                                    )}
                                </a>
                            {/if}
                            {#if error}
                                <p class="proof-error">{error}</p>
                            {/if}
                        </div>
                    {:else if proving}
                        <!-- Generating -->
                        <div class="proof-loading">
                            <div class="loading-spinner"></div>
                            <p>Generating proof...</p>
                        </div>
                    {:else}
                        <!-- Generate Button -->
                        {#if !hasKale}
                            <p class="proof-nudge">
                                Need KALE to generate proof. <a href="/kale"
                                    >Get KALE →</a
                                >
                            </p>
                        {/if}
                        {#if error}
                            <p class="proof-error">{error}</p>
                        {/if}
                        <button
                            class="proof-generate"
                            type="button"
                            onclick={generateProof}
                            disabled={balance === null}
                        >
                            Generate ZK Proof
                        </button>
                    {/if}
                </div>
            </section>

            <!-- Concept Strip -->
            <section class="concepts-section">
                <h2 class="concepts-label">Coming Soon</h2>
                <div class="concepts-strip">
                    {#each galleryProofs.filter((p) => p.status === "CONCEPT") as concept}
                        <div class="concept-card">
                            <span class="concept-title">{concept.title}</span>
                            <span class="concept-summary"
                                >{concept.summary.split(".")[0]}.</span
                            >
                        </div>
                    {/each}
                </div>
            </section>
        {/if}
    </div>

    <section class="game-section">
        <div class="game-header">
            <h2 class="section-label">ZK Arcade</h2>
            <p class="game-subtitle">
                Play to generate SHA-256 commitments. Complete the action
                sequence, then seal your proof.
            </p>
            {#if !isAuth}
                <p class="game-subtitle game-wallet">
                    Guest wallet active: {gameWalletLabel} (no Kale Farm login needed).
                </p>
            {/if}
        </div>
        {#if gameError}
            <p class="game-error">{gameError}</p>
        {/if}
        <div class="game-grid">
            {#each zkGames as game}
                <article class="game-card" style={`--accent:${game.color}`}>
                    <div class="game-card-top">
                        <div>
                            <h3 class="game-title">{game.title}</h3>
                            <p class="game-summary">{game.summary}</p>
                        </div>
                        <span class="game-level">Level {game.level}</span>
                    </div>
                    <p class="game-goal">{game.goal}</p>
                    <div class="game-progress">
                        <div class="game-progress-top">
                            <span>Progress</span>
                            <span
                                >{game.progress}/{getRequirement(game)} actions</span
                            >
                        </div>
                        <div class="game-progress-bar">
                            <span
                                class="game-progress-fill"
                                style={`width:${Math.min(
                                    (game.progress / getRequirement(game)) *
                                        100,
                                    100,
                                )}%`}
                            ></span>
                        </div>
                        <div class="game-progress-meta">
                            <span>Score: {game.score}</span>
                            <span>Status: {game.status}</span>
                        </div>
                    </div>
                    <div class="game-actions">
                        <button
                            class="game-action-btn"
                            type="button"
                            onclick={() => logGameAction(game)}
                            disabled={game.status === "complete"}
                        >
                            {game.actionLabel}
                        </button>
                        <button
                            class="game-action-btn ghost"
                            type="button"
                            onclick={() => resetGame(game)}
                        >
                            Reset run
                        </button>
                        <button
                            class="game-action-btn primary"
                            type="button"
                            onclick={() => forgeGameProof(game)}
                            disabled={game.status !== "complete" ||
                                gameForging === game.id}
                        >
                            {gameForging === game.id
                                ? "Sealing..."
                                : "Seal commitment"}
                        </button>
                    </div>
                    {#if game.proof}
                        <div class="game-proof">
                            <div>
                                <p class="game-proof-label">Action hash</p>
                                <p class="game-proof-value">
                                    {game.proof.actionHash}
                                </p>
                            </div>
                            <div>
                                <p class="game-proof-label">Commitment</p>
                                <p class="game-proof-value">
                                    {game.proof.commitment}
                                </p>
                            </div>
                            <button
                                class="game-copy-btn"
                                type="button"
                                onclick={() => copyGameProof(game)}
                            >
                                {gameCopied === game.id
                                    ? "Copied proof packet"
                                    : "Copy proof packet"}
                            </button>
                        </div>
                    {/if}
                </article>
            {/each}
        </div>
    </section>

    <!-- Footer -->
    <footer class="farm-footer">
        <p class="footer-tech">
            Built on Stellar Protocol 25 · Groth16 · BN254
        </p>
        <p class="footer-links">
            <a
                href="https://github.com/tacticalnoot/smol-fe/tree/main/circuits/tier_proof"
                target="_blank"
                rel="noreferrer">Circuit Source</a
            >
            <span class="footer-divider">·</span>
            <a
                href="https://stellar.expert/explorer/public"
                target="_blank"
                rel="noreferrer">Stellar Explorer</a
            >
        </p>
    </footer>
</div>

<style>
    /* ── Root ── */
    .farm-root {
        position: relative;
        min-height: 100vh;
        width: 100%;
        background: linear-gradient(
            170deg,
            #020617 0%,
            #041008 40%,
            #020617 100%
        );
        background-size: 200% 200%;
        animation: bg-drift 20s ease-in-out infinite;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.6s ease;
    }
    .farm-mounted {
        opacity: 1;
    }
    @keyframes bg-drift {
        0%,
        100% {
            background-position: 0% 0%;
        }
        50% {
            background-position: 100% 100%;
        }
    }

    /* ── Particles ── */
    .particles {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
    }
    .particle {
        position: absolute;
        bottom: -10px;
        left: calc(var(--x) * 1%);
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: rgba(154, 230, 0, 0.3);
        animation: float calc(var(--s) * 1s) linear infinite;
        animation-delay: calc(var(--d) * -10s);
    }
    @keyframes float {
        0% {
            transform: translateY(0) translateX(0);
            opacity: 0;
        }
        5% {
            opacity: 1;
        }
        95% {
            opacity: 0.6;
        }
        100% {
            transform: translateY(-100vh) translateX(calc(var(--d) * 30px));
            opacity: 0;
        }
    }

    /* ── Stems ── */
    .stems {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 25vh;
        pointer-events: none;
        z-index: 0;
    }
    .stem {
        position: absolute;
        bottom: 0;
        left: calc(var(--left) * 1%);
        width: 2px;
        height: calc(var(--h) * 1%);
        background: linear-gradient(
            to top,
            rgba(154, 230, 0, 0.15),
            transparent
        );
        transform-origin: bottom center;
        animation: sway 4s ease-in-out infinite;
        animation-delay: calc(var(--delay) * 1s);
        border-radius: 1px;
    }
    @keyframes sway {
        0%,
        100% {
            transform: rotate(-3deg);
        }
        50% {
            transform: rotate(3deg);
        }
    }

    /* ── Audio Toggle ── */
    .audio-toggle {
        position: fixed;
        bottom: 80px;
        right: 16px;
        z-index: 50;
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666;
        cursor: pointer;
        backdrop-filter: blur(8px);
        transition: all 0.2s ease;
    }
    .audio-toggle:hover {
        color: #9ae600;
        border-color: rgba(154, 230, 0, 0.3);
    }

    /* ── Content ── */
    .farm-content {
        position: relative;
        z-index: 10;
        max-width: 540px;
        margin: 0 auto;
        padding: 100px 20px 120px;
        display: flex;
        flex-direction: column;
        gap: 32px;
    }

    /* ── Header ── */
    .farm-header {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }
    .farm-title {
        display: flex;
        gap: 12px;
        align-items: baseline;
    }
    .title-the {
        font-family: "Press Start 2P", monospace;
        font-size: 14px;
        color: #555;
        letter-spacing: 4px;
    }
    .title-farm {
        font-family: "Press Start 2P", monospace;
        font-size: 32px;
        color: #9ae600;
        filter: drop-shadow(0 0 20px rgba(154, 230, 0, 0.4));
        letter-spacing: 4px;
    }
    .farm-subtitle {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #555;
        letter-spacing: 3px;
        text-transform: uppercase;
    }
    .farm-tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 8px;
        font-family: "Press Start 2P", monospace;
        color: #4ade80;
        background: rgba(74, 222, 128, 0.08);
        border: 1px solid rgba(74, 222, 128, 0.2);
        border-radius: 999px;
        padding: 4px 12px;
        margin-top: 4px;
    }
    .tag-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse-dot 2s ease-in-out infinite;
    }
    @keyframes pulse-dot {
        0%,
        100% {
            opacity: 0.4;
        }
        50% {
            opacity: 1;
        }
    }

    /* ── Landing ── */
    .landing-cta {
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 40px 0;
    }
    .landing-line {
        font-family: "Press Start 2P", monospace;
        font-size: 11px;
        color: #ccc;
        line-height: 2;
    }
    .landing-line.dim {
        color: #666;
    }
    .landing-connect {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #9ae600;
        margin-top: 20px;
        animation: pulse-text 2s ease-in-out infinite;
    }
    @keyframes pulse-text {
        0%,
        100% {
            opacity: 0.5;
        }
        50% {
            opacity: 1;
        }
    }

    /* ── Proof Section ── */
    .proof-section {
        width: 100%;
    }
    .proof-card {
        background: rgba(13, 13, 15, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 24px;
        backdrop-filter: blur(12px);
    }
    .proof-tier {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
    }
    .tier-icon {
        font-size: 48px;
    }
    .tier-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .tier-name {
        font-family: "Press Start 2P", monospace;
        font-size: 14px;
    }
    .tier-balance {
        font-family: "Press Start 2P", monospace;
        font-size: 10px;
        color: #9ae600;
        opacity: 0.8;
    }
    .proof-done {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .proof-done-label {
        font-family: "Press Start 2P", monospace;
        font-size: 10px;
        color: #4ade80;
    }
    .proof-actions {
        display: flex;
        gap: 8px;
    }
    .proof-btn {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        padding: 10px 16px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
        color: #ccc;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .proof-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .proof-btn.primary {
        background: linear-gradient(135deg, #9ae600 0%, #7bc400 100%);
        color: #000;
        border-color: #9ae600;
    }
    .proof-btn.primary:hover {
        filter: brightness(1.1);
    }
    .proof-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .proof-tx {
        font-family: monospace;
        font-size: 10px;
        color: #9ae600;
        text-decoration: underline;
    }
    .proof-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 20px;
        color: #888;
        font-size: 11px;
    }
    .proof-generate {
        width: 100%;
        font-family: "Press Start 2P", monospace;
        font-size: 10px;
        padding: 16px;
        border-radius: 12px;
        border: none;
        background: linear-gradient(135deg, #9ae600 0%, #7bc400 100%);
        color: #000;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .proof-generate:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
    }
    .proof-generate:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }
    .proof-nudge {
        font-size: 10px;
        color: #888;
        text-align: center;
        margin-bottom: 16px;
    }
    .proof-nudge a {
        color: #9ae600;
        text-decoration: underline;
    }
    .proof-error {
        font-size: 10px;
        color: #f87171;
        text-align: center;
        margin-bottom: 12px;
    }

    /* ── Concepts Section ── */
    .concepts-section {
        width: 100%;
        margin-top: 8px;
    }
    .concepts-label {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #555;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 2px;
    }
    .concepts-strip {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .concept-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
    }
    .concept-title {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #9ae600;
    }
    .concept-summary {
        font-size: 10px;
        color: #666;
        line-height: 1.5;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 60px 0;
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 2px solid rgba(154, 230, 0, 0.15);
        border-top-color: #9ae600;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    .loading-text {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #666;
    }

    /* ── Dreamboard ── */
    .dreamboard {
        display: flex;
        flex-direction: column;
        gap: 32px;
    }
    .section-label {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #444;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 12px;
    }
    .badge-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
    @media (max-width: 480px) {
        .badge-grid {
            grid-template-columns: 1fr;
        }
    }

    /* ── ZK Mini Game Lab ── */
    .game-section {
        margin-top: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .game-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .game-subtitle {
        color: #64748b;
        font-size: 12px;
    }
    .game-wallet {
        color: #5eead4;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 1px;
    }
    .game-error {
        color: #f87171;
        font-size: 12px;
    }
    .game-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
    }
    .game-card {
        background: rgba(11, 18, 26, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 18px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: relative;
        overflow: hidden;
    }
    .game-card::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(
            circle at top,
            color-mix(in srgb, var(--accent, #38bdf8) 24%, transparent),
            transparent 60%
        );
        opacity: 0.7;
        pointer-events: none;
    }
    .game-card > * {
        position: relative;
        z-index: 1;
    }
    .game-card-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
    }
    .game-title {
        font-size: 14px;
        margin: 0;
        color: #f8fafc;
    }
    .game-summary {
        margin: 4px 0 0;
        font-size: 12px;
        color: #94a3b8;
    }
    .game-level {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.2);
        border: 1px solid rgba(94, 234, 212, 0.25);
        color: #5eead4;
        font-size: 10px;
        white-space: nowrap;
    }
    .game-goal {
        font-size: 12px;
        color: #e2e8f0;
        margin: 0;
    }
    .game-progress {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .game-progress-top {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
    }
    .game-progress-bar {
        height: 6px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.2);
        overflow: hidden;
    }
    .game-progress-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent, #38bdf8), #22d3ee);
    }
    .game-progress-meta {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
    }
    .game-actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 8px;
    }
    .game-action-btn {
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(30, 41, 59, 0.6);
        color: #e2e8f0;
        font-size: 10px;
        cursor: pointer;
        transition:
            transform 0.2s ease,
            border 0.2s ease;
    }
    .game-action-btn:hover {
        transform: translateY(-1px);
        border-color: rgba(148, 163, 184, 0.5);
    }
    .game-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .game-action-btn.ghost {
        background: transparent;
    }
    .game-action-btn.primary {
        background: linear-gradient(135deg, var(--accent, #38bdf8), #22d3ee);
        color: #0f172a;
        font-weight: 600;
    }
    .game-proof {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .game-proof-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        margin: 0;
    }
    .game-proof-value {
        font-size: 10px;
        word-break: break-all;
        margin: 4px 0 0;
        color: #e2e8f0;
    }
    .game-copy-btn {
        padding: 8px;
        border-radius: 10px;
        border: 1px solid rgba(94, 234, 212, 0.5);
        background: rgba(20, 184, 166, 0.2);
        color: #5eead4;
        font-size: 10px;
        cursor: pointer;
    }

    /* ── Gallery ── */
    .gallery-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .gallery-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .gallery-header-right {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .gallery-subtitle {
        font-size: 8px;
        color: #4ade80;
        font-family: "Press Start 2P", monospace;
        letter-spacing: 1px;
    }
    .gallery-cta {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #051015;
        background: linear-gradient(135deg, #22c55e, #14b8a6);
        border: none;
        border-radius: 999px;
        padding: 8px 16px;
        cursor: pointer;
        letter-spacing: 1px;
        box-shadow: 0 10px 18px rgba(20, 184, 166, 0.25);
        transition:
            transform 0.2s ease,
            box-shadow 0.2s ease,
            opacity 0.2s ease;
    }
    .gallery-cta:hover:enabled {
        transform: translateY(-2px) scale(1.01);
        box-shadow: 0 14px 22px rgba(34, 197, 94, 0.3);
    }
    .gallery-cta:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
    }
    .gallery-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }
    .gallery-card {
        background: rgba(13, 13, 15, 0.75);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 18px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: left;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
    }
    .gallery-card:hover {
        border-color: rgba(154, 230, 0, 0.4);
        box-shadow: 0 0 24px rgba(154, 230, 0, 0.18);
        transform: translateY(-2px);
    }
    .gallery-card-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: "Press Start 2P", monospace;
        font-size: 7px;
        color: #9ae600;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .gallery-status {
        border-radius: 999px;
        padding: 2px 8px;
    }
    .gallery-status--live {
        background: rgba(154, 230, 0, 0.12);
        border: 1px solid rgba(154, 230, 0, 0.3);
        color: #9ae600;
    }
    .gallery-status--concept {
        background: rgba(150, 150, 150, 0.1);
        border: 1px dashed rgba(150, 150, 150, 0.3);
        color: #888;
    }
    .gallery-card--concept {
        opacity: 0.6;
        border-style: dashed;
    }
    .gallery-card--concept:hover {
        opacity: 0.8;
    }
    .gallery-circuit {
        color: #555;
    }
    .gallery-title {
        font-family: "Press Start 2P", monospace;
        font-size: 11px;
        color: #e2e8f0;
        letter-spacing: 1px;
    }
    .gallery-summary {
        font-size: 9px;
        color: #777;
        line-height: 1.7;
    }
    .gallery-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .gallery-tag {
        font-size: 7px;
        text-transform: uppercase;
        color: #9ae600;
        border: 1px solid rgba(154, 230, 0, 0.2);
        border-radius: 999px;
        padding: 2px 6px;
    }
    .gallery-tag--status {
        color: #cbd5f5;
        border-color: rgba(203, 213, 245, 0.35);
        background: rgba(51, 65, 85, 0.35);
    }
    .gallery-foot {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: auto;
    }
    .gallery-proof {
        font-size: 8px;
        color: #4ade80;
    }
    .gallery-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }
    .gallery-open {
        border: none;
        background: rgba(154, 230, 0, 0.12);
        color: #9ae600;
        font-size: 8px;
        padding: 4px 8px;
        border-radius: 999px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        cursor: pointer;
        transition:
            background 0.2s ease,
            color 0.2s ease;
    }
    .gallery-open:hover {
        background: rgba(154, 230, 0, 0.25);
        color: #e2e8f0;
    }
    .gallery-link {
        font-size: 8px;
        color: #4ade80;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        text-decoration: none;
    }
    .gallery-link:hover {
        text-decoration: underline;
    }
    .gallery-modal-link {
        font-size: 9px;
        color: #4ade80;
        text-decoration: none;
        word-break: break-all;
    }
    .gallery-modal-link:hover {
        text-decoration: underline;
    }

    /* ── Gallery Modal ── */
    .gallery-overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
    }
    .gallery-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(2, 6, 23, 0.8);
        backdrop-filter: blur(6px);
        border: none;
    }
    .gallery-modal {
        position: relative;
        z-index: 1;
        max-width: 520px;
        width: 100%;
        background: rgba(13, 13, 15, 0.95);
        border: 1px solid rgba(154, 230, 0, 0.25);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: #e2e8f0;
    }
    .gallery-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
    }
    .gallery-modal-label {
        font-size: 7px;
        text-transform: uppercase;
        color: #555;
        letter-spacing: 2px;
        font-family: "Press Start 2P", monospace;
    }
    .gallery-modal-title {
        font-family: "Press Start 2P", monospace;
        font-size: 14px;
        color: #9ae600;
        letter-spacing: 2px;
    }
    .gallery-close {
        background: rgba(154, 230, 0, 0.1);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        width: 32px;
        height: 32px;
        color: #9ae600;
        cursor: pointer;
        font-size: 12px;
    }
    .gallery-modal-summary {
        font-size: 10px;
        color: #777;
        line-height: 1.7;
    }
    .gallery-modal-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
    .gallery-modal-card {
        background: rgba(6, 8, 12, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.1);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .gallery-modal-requirement {
        grid-column: span 2;
        border-color: rgba(148, 163, 184, 0.2);
    }
    .gallery-modal-cta {
        font-size: 8px;
        text-transform: uppercase;
        color: #9ae600;
        letter-spacing: 1px;
        text-decoration: none;
        margin-top: 4px;
    }
    .gallery-modal-cta:hover {
        text-decoration: underline;
    }
    .gallery-modal-eyebrow {
        font-size: 7px;
        text-transform: uppercase;
        color: #555;
        letter-spacing: 2px;
        font-family: "Press Start 2P", monospace;
    }
    .gallery-modal-value {
        font-size: 9px;
        color: #e2e8f0;
        line-height: 1.6;
    }
    .gallery-modal-lists {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        font-size: 9px;
        color: #777;
    }
    .gallery-modal-lists h4 {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #9ae600;
        margin-bottom: 6px;
    }
    .gallery-modal-lists ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .gallery-modal-note {
        font-size: 9px;
        color: #4ade80;
        line-height: 1.6;
    }

    @media (max-width: 520px) {
        .gallery-grid {
            grid-template-columns: 1fr;
        }
        .gallery-header {
            flex-direction: column;
            align-items: flex-start;
        }
        .gallery-modal-grid,
        .gallery-modal-lists {
            grid-template-columns: 1fr;
        }
    }

    /* ── Proof Panel (unearned featured) ── */
    .proof-panel {
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        backdrop-filter: blur(12px);
    }
    .tier-display {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .tier-icon {
        font-size: 2.5rem;
    }
    .tier-name {
        font-family: "Press Start 2P", monospace;
        font-size: 16px;
        letter-spacing: 2px;
    }
    .balance-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .balance-val {
        font-family: "Press Start 2P", monospace;
        font-size: 20px;
        color: #e2e8f0;
    }
    .balance-label {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #9ae600;
        letter-spacing: 2px;
    }
    .proof-desc {
        font-size: 10px;
        color: #666;
        text-align: center;
        line-height: 1.8;
        max-width: 300px;
    }
    .proof-nudge {
        text-align: center;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 9px;
        color: #cbd5f5;
        line-height: 1.6;
    }
    .proof-nudge-link {
        display: inline-block;
        margin-top: 6px;
        color: #9ae600;
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
        text-decoration: none;
    }
    .proof-nudge-link:hover {
        text-decoration: underline;
    }
    .proof-tools {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        text-align: center;
    }
    .proof-tools-text {
        font-size: 9px;
        color: #666;
        max-width: 320px;
        line-height: 1.6;
    }
    .proof-tools-meta {
        font-size: 8px;
        color: rgba(226, 232, 240, 0.6);
        font-family: "Press Start 2P", monospace;
    }
    .proof-tools-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
    }
    .proof-tools-btn {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #9ae600;
        background: rgba(13, 13, 15, 0.6);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        letter-spacing: 1px;
        transition: all 0.2s ease;
    }
    .proof-tools-btn:hover:not(:disabled) {
        color: #c6ff3b;
        border-color: rgba(198, 255, 59, 0.8);
        box-shadow: 0 0 18px rgba(154, 230, 0, 0.2);
    }
    .proof-tools-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .proof-tools-verify {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        text-align: center;
        padding: 8px 12px;
        border-radius: 8px;
        letter-spacing: 0.5px;
    }
    .proof-tools-verify--pass {
        color: #4ade80;
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.3);
    }
    .proof-onchain-success {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding: 12px;
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.3);
        border-radius: 12px;
        width: 100%;
    }
    .proof-success-title {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #4ade80;
        margin: 0;
    }
    .proof-tx-link {
        font-size: 9px;
        color: #4ade80;
        text-decoration: underline;
        opacity: 0.8;
    }
    .proof-tx-link:hover {
        opacity: 1;
    }
    .proof-tools-verify--fail {
        color: #fb923c;
        background: rgba(251, 146, 60, 0.1);
        border: 1px solid rgba(251, 146, 60, 0.3);
    }
    .proof-error {
        font-size: 9px;
        color: #ef4444;
        font-family: "Press Start 2P", monospace;
    }
    .proof-celebration {
        position: relative;
        margin: 16px 0 20px;
        border-radius: 18px;
        background: radial-gradient(
                circle at top,
                rgba(34, 197, 94, 0.28),
                transparent 60%
            ),
            linear-gradient(
                135deg,
                rgba(15, 118, 110, 0.55),
                rgba(13, 148, 136, 0.15)
            );
        border: 1px solid rgba(20, 184, 166, 0.4);
        padding: 16px;
        overflow: hidden;
        box-shadow: 0 24px 48px rgba(15, 118, 110, 0.25);
    }
    .proof-celebration-card {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: #ecfeff;
        text-align: left;
    }
    .proof-celebration-eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.2em;
        font-size: 7px;
        font-weight: 600;
        color: rgba(167, 243, 208, 0.9);
    }
    .proof-celebration-title {
        font-size: 14px;
        font-weight: 700;
        margin: 0;
    }
    .proof-celebration-body {
        margin: 0;
        font-size: 9px;
        color: rgba(240, 253, 250, 0.85);
        line-height: 1.6;
    }
    .proof-confetti {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }
    .confetti {
        position: absolute;
        top: 8%;
        left: 50%;
        width: 10px;
        height: 18px;
        border-radius: 4px;
        background: hsl(calc(var(--i) * 16deg), 90%, 60%);
        animation: confetti-fall 2.2s ease-out forwards;
        transform: translate3d(0, 0, 0) rotate(0deg);
        opacity: 0;
    }
    .confetti:nth-child(odd) {
        width: 8px;
        height: 14px;
    }
    .confetti {
        animation-delay: calc(var(--i) * 0.04s);
        left: calc(10% + (var(--i) * 3.2%));
    }
    @keyframes confetti-fall {
        0% {
            opacity: 0;
            transform: translate3d(0, -40px, 0) rotate(0deg);
        }
        10% {
            opacity: 1;
        }
        100% {
            opacity: 0;
            transform: translate3d(calc((var(--i) - 12) * 6px), 220px, 0)
                rotate(360deg);
        }
    }
    .generate-btn {
        font-family: "Press Start 2P", monospace;
        font-size: 10px;
        color: #020617;
        background: linear-gradient(135deg, #9ae600, #4ade80);
        border: none;
        border-radius: 10px;
        padding: 14px 28px;
        cursor: pointer;
        letter-spacing: 1px;
        transition: all 0.3s ease;
        box-shadow: 0 0 20px rgba(154, 230, 0, 0.2);
    }
    .generate-btn:hover:not(:disabled) {
        box-shadow: 0 0 40px rgba(154, 230, 0, 0.4);
        transform: translateY(-2px);
    }
    .generate-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* ── Proving State ── */
    .proving-card {
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 48px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        backdrop-filter: blur(12px);
    }
    .proving-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid rgba(154, 230, 0, 0.15);
        border-top-color: #9ae600;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }
    .proving-text {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #9ae600;
        text-align: center;
        line-height: 2;
    }
    .proving-sub {
        font-size: 8px;
        color: #555;
        text-align: center;
    }

    /* ── Responsive ── */
    @media (max-width: 480px) {
        .title-farm {
            font-size: 24px;
        }
        .balance-val {
            font-size: 16px;
        }
        .farm-content {
            padding: 80px 16px 100px;
        }
    }

    .proof-onchain-success {
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.3);
        border-radius: 12px;
        padding: 12px;
        text-align: center;
        width: 100%;
        max-width: 300px;
    }
    .proof-success-title {
        font-family: "Press Start 2P", monospace;
        font-size: 10px;
        color: #4ade80;
        margin: 0 0 6px;
    }
    .proof-tx-link {
        font-size: 9px;
        color: #9ae600;
        text-decoration: none;
    }
    .proof-tx-link:hover {
        text-decoration: underline;
    }

    /* ── Footer ── */
    .farm-footer {
        margin-top: 60px;
        padding: 24px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        text-align: center;
    }
    .footer-tech {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        color: #9ae600;
        margin: 0 0 8px;
    }
    .footer-links {
        font-size: 12px;
        color: #888;
        margin: 0;
    }
    .footer-links a {
        color: #aaa;
        text-decoration: none;
        transition: color 0.2s;
    }
    .footer-links a:hover {
        color: #9ae600;
    }
    .footer-divider {
        margin: 0 8px;
        opacity: 0.4;
    }
</style>
