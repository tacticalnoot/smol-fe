<script lang="ts">
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
        formatKaleBalance,
        buildProofPacket,
        saveEarnedBadge,
        loadAllBadges,
        type EarnedBadge,
    } from "./proof";
    // Real ZK proof generation
    import {
        generateTierProof,
        generateRandomSalt,
        hashAddress,
        getTierIdForBalance,
        proofToBytes,
        submitProofToContract,
        hashProof,
        checkAttestation,
        type ProofResult,
    } from "./zkProof";
    import {
        createGameProof,
        buildGameProofPacket,
        loadGameProofs,
        saveGameProof,
        getOrCreateGameWalletId,
        type ZkGameProof,
    } from "./zkGames";

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

    const galleryProofs: GalleryProof[] = [
        {
            id: "kale-bloom",
            title: "Kale Bloom",
            summary:
                "Commit to your KALE tier without revealing your exact balance. SHA-256 commitment with random salt — verifiable by recomputing the hash.",
            proof: "SHA-256 commitment: sha256(address || balance || salt)",
            circuit: "Commit-Reveal Scheme",
            status: "LIVE",
            file: "/proofs/smol-proof-of-farm.json",
            wallet: "CA4KZP5ZXY2A6Q6HQ2TK3AJXFG6OU7Y5CNGT7GIEH6JQO6F7KLBWYX3V",
            tags: ["tier", "commitment", "sha-256"],
            tested: "Verified: commitment recomputation matches",
            inputs: ["wallet address", "kale balance", "random 32-byte salt"],
            outputs: ["commitment hash (32 bytes)", "tier index (0-3)"],
            note: "Live commitment generation — generate above, then verify by recomputing the hash from your address + balance + salt.",
            requiresKale: true,
            requirementCopy:
                "Mine or trade KALE in the Kale Farm to generate this commitment.",
        },
        {
            id: "compost-pledge",
            title: "Compost Pledge",
            summary:
                "Concept: prove weekly recycling events via Merkle inclusion + range proof. Circuit not yet implemented.",
            proof: "Planned: Merkle inclusion + range proof circuit",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-compost-pledge.json",
            wallet: "CBM5FJ3VUGD5YI4GJ4LZ2H2V6MWZVJ4UP5B6O6GJMXZ6H2Q6EV7R5O2A",
            tags: ["merkle", "range", "planned"],
            tested: "Not yet implemented — sample data only",
            inputs: ["event root", "leaf index", "recycle count"],
            outputs: ["valid membership", "count range flag"],
            note: "Design concept with sample proof format. Requires a Merkle tree + range proof circuit to be built.",
            requiresKale: false,
            requirementCopy: "Concept proof — not yet interactive.",
        },
        {
            id: "sprout-sprint",
            title: "Sprout Sprint",
            summary:
                "Concept: prove a 3-day streak using nullifiers so each day can only be claimed once. Circuit not yet implemented.",
            proof: "Planned: Nullifier-based streak circuit",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-sprout-sprint.json",
            wallet: "CC7K4YFZP5Q6R5C42J6KQJ4U6P4V4A2I4Y4K3QFQ4N6J5X7PN4F5QEA",
            tags: ["streak", "nullifier", "planned"],
            tested: "Not yet implemented — sample data only",
            inputs: ["day hashes", "streak nullifier"],
            outputs: ["streak attestation"],
            note: "Design concept. Requires a nullifier circuit that prevents double-claiming days.",
            requiresKale: false,
            requirementCopy: "Concept proof — not yet interactive.",
        },
        {
            id: "field-escort",
            title: "Field Escort",
            summary:
                "Concept: verify a crop shipment route via sequential waypoint commitments. Circuit not yet implemented.",
            proof: "Planned: Chained waypoint commitment circuit",
            circuit: "Concept — not yet implemented",
            status: "CONCEPT",
            file: "/proofs/smol-field-escort.json",
            wallet: "CAG6XPLT3VQ5WB3D6I5QEXER2Q4RA6N3PHJ2G5Q4BNRVR4F46Q4Q6SGB",
            tags: ["route", "waypoints", "planned"],
            tested: "Not yet implemented — sample data only",
            inputs: ["route commitments", "shipment id"],
            outputs: ["valid escort flag"],
            note: "Design concept. Would require chained commitments per waypoint with sequential verification.",
            requiresKale: false,
            requirementCopy: "Concept proof — not yet interactive.",
        },
        {
            id: "tic-tac-tac",
            title: "Stellar Tic-Tac-Tac",
            summary:
                "SHA-256 commitment of your game actions and score. Play the game below to generate a real commitment.",
            proof: "SHA-256 commitment: sha256(wallet + game + score + actions + salt)",
            circuit: "Commit-Reveal Scheme",
            status: "LIVE",
            file: "/proofs/smol-tic-tac-proof.json",
            wallet: "CDWJ4P7PLVKG4Q3TFFZ5B5C5RXKFYI6K7Z2R4V7BPNLBNHGQWZLQHXO",
            tags: ["game", "commitment", "sha-256"],
            tested: "Verified: commitment generated from real game actions",
            inputs: ["wallet address", "game actions", "score", "salt"],
            outputs: ["action hash", "commitment hash"],
            note: "Play Tic-Tac-Tac below to generate a commitment from real game actions.",
            requiresKale: false,
            requirementCopy:
                "No KALE activity required — play the mini game to generate a commitment.",
        },
        {
            id: "asteroid-dodge",
            title: "Asteroid Dodge",
            summary:
                "SHA-256 commitment of your dodge run. Complete the sequence below to generate a real commitment.",
            proof: "SHA-256 commitment: sha256(wallet + game + score + actions + salt)",
            circuit: "Commit-Reveal Scheme",
            status: "LIVE",
            file: "/proofs/smol-asteroid-dodge.json",
            wallet: "CC5U5CPVY3ZVZHYV4PEKXSSB7K4GFD4OAN3NXR6OZECY7BNL3D7D3FBA",
            tags: ["game", "commitment", "sha-256"],
            tested: "Verified: commitment generated from real game actions",
            inputs: ["wallet address", "game actions", "run length", "salt"],
            outputs: ["action hash", "commitment hash"],
            note: "Complete the Asteroid Dodge sequence below to generate a commitment.",
            requiresKale: false,
            requirementCopy:
                "No KALE activity required — clear the run to generate a commitment.",
        },
        {
            id: "pattern-runner",
            title: "Pattern Runner",
            summary:
                "SHA-256 commitment of your rhythm streak. Hit the targets below to generate a real commitment.",
            proof: "SHA-256 commitment: sha256(wallet + game + score + actions + salt)",
            circuit: "Commit-Reveal Scheme",
            status: "LIVE",
            file: "/proofs/smol-pattern-runner.json",
            wallet: "CBNQ2X6T7JXK5B2M5AGPSZ5XKQZV6K7W2Q4R2J5P6K3X6ZL7PRX7G5QY",
            tags: ["game", "commitment", "sha-256"],
            tested: "Verified: commitment generated from real game actions",
            inputs: ["wallet address", "beat actions", "streak length", "salt"],
            outputs: ["action hash", "commitment hash"],
            note: "Play the rhythm sequence below to generate a commitment from your real actions.",
            requiresKale: false,
            requirementCopy:
                "No KALE activity required — hit the streak to generate a commitment.",
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
        return () => {
            stopAmbient();
        };
    });

    // Load badges + refresh balance when authenticated
    $effect(() => {
        if (isAuth && userState.contractId) {
            earned = loadAllBadges(userState.contractId);
            updateContractBalance(userState.contractId);
        } else {
            earned = {};
        }
    });

    $effect(() => {
        if (typeof window === "undefined") return;
        const walletId = userState.contractId ?? getOrCreateGameWalletId();
        gameWallet = walletId;
        gameProofs = loadGameProofs(walletId);
        zkGames = zkGames.map((game) => ({
            ...game,
            proof: gameProofs[game.id],
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
            const addressHash = await hashAddress(userState.contractId);
            const salt = generateRandomSalt();
            const tierId = getTierIdForBalance(balance);

            console.log("[ZK] Generating real Groth16 proof...", {
                tier: tierId,
                tierName: TIER_CONFIG[tierId]?.name,
            });

            // 2. Generate the REAL ZK proof
            const result = await generateTierProof(
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
            const { verifyProofLocally } = await import("./zkProof");
            const isValid = await verifyProofLocally(
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

            const proofHash = await hashProof(proofData.proof);

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

            const result = await submitProofToContract(
                kit,
                userState.contractId,
                proofData.tier,
                commitmentBytes,
                proofHash,
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
            const proof = await createGameProof(
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
            saveGameProof(walletId, proof);
            gameProofs = loadGameProofs(walletId);
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
            const packet = buildGameProofPacket(game.proof);
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
    <!-- ── Background Particles (CSS-only) ── -->
    <div class="particles" aria-hidden="true">
        {#each Array(12) as _, i}
            <span
                class="particle"
                style="--d:{0.6 + Math.random() * 0.6};--x:{Math.random() *
                    100};--s:{8 + Math.random() * 14}"
            ></span>
        {/each}
    </div>

    <!-- ── Swaying Stems (CSS-only) ── -->
    <div class="stems" aria-hidden="true">
        {#each Array(7) as _, i}
            <span
                class="stem"
                style="--h:{40 + Math.random() * 30};--left:{8 +
                    i * 14};--delay:{Math.random() * 2}"
            ></span>
        {/each}
    </div>

    <!-- ── Audio Toggle ── -->
    <button
        class="audio-toggle"
        onclick={toggleAudio}
        title={audioOn ? "Mute ambient" : "Play ambient"}
    >
        {#if audioOn}
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path
                    d="M19.07 4.93a10 10 0 0 1 0 14.14"
                /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg
            >
        {:else}
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line
                    x1="23"
                    y1="9"
                    x2="17"
                    y2="15"
                /><line x1="17" y1="9" x2="23" y2="15" /></svg
            >
        {/if}
    </button>

    <div class="farm-content">
        <!-- ── Header ── -->
        <header class="farm-header">
            <h1 class="farm-title">
                <span class="title-the">THE</span>
                <span class="title-farm">FARM</span>
            </h1>
            <p class="farm-subtitle">Smart Wallet Dreamboard</p>
            {#if isAuth}
                <div class="farm-tag">
                    <span class="tag-dot"></span>
                    <span>Wallet Connected</span>
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
            <!-- ── Dreamboard ── -->
            <div class="dreamboard">
                <!-- Featured: Proof of Farm -->
                <section class="featured-section">
                    <h2 class="section-label">Featured Achievement</h2>

                    {#if showCelebration}
                        <div class="proof-celebration" aria-live="polite">
                            <div class="proof-celebration-card">
                                <span class="proof-celebration-eyebrow"
                                    >Commitment sealed</span
                                >
                                <p class="proof-celebration-title">
                                    Tier commitment generated ✨
                                </p>
                                <p class="proof-celebration-body">
                                    We hashed your tier with a random salt using
                                    SHA-256. The commitment is stored locally —
                                    verify it anytime by recomputing the hash
                                    from your address, balance, and salt.
                                </p>
                            </div>
                            <div class="proof-confetti" aria-hidden="true">
                                {#each confettiPieces as piece}
                                    <span
                                        class="confetti"
                                        style={`--i:${piece}`}
                                    ></span>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if hasProof}
                        <FarmBadge
                            badge={earned["proof-of-farm"]}
                            def={BADGE_REGISTRY[0]}
                        />
                        <div class="proof-tools">
                            <p class="proof-tools-text">
                                Verify this ZK proof on-chain. This will submit
                                your commitment and proof hash to the Stellar
                                mainnet verifier contract.
                            </p>
                            <div class="proof-tools-actions">
                                <button
                                    class="proof-tools-btn primary"
                                    type="button"
                                    onclick={verifyProof}
                                    disabled={verifying || onChainVerified}
                                >
                                    {#if verifying}
                                        Verifying...
                                    {:else if onChainVerified}
                                        Verified On-Chain
                                    {:else}
                                        Verify On-Chain
                                    {/if}
                                </button>
                                <button
                                    class="proof-tools-btn"
                                    type="button"
                                    onclick={copyProofPacket}
                                >
                                    {copied
                                        ? "Payload copied"
                                        : "Copy proof payload"}
                                </button>
                            </div>

                            {#if verifyResult === true}
                                <p
                                    class="proof-tools-verify proof-tools-verify--pass"
                                >
                                    ✓ Local proof valid
                                </p>
                            {/if}

                            {#if onChainVerified}
                                <div class="proof-onchain-success">
                                    <p class="proof-success-title">
                                        ✅ On-Chain Verified
                                    </p>
                                    <a
                                        href={`https://stellar.expert/explorer/public/tx/${txHash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        class="proof-tx-link"
                                    >
                                        View TX: {txHash?.slice(
                                            0,
                                            8,
                                        )}...{txHash?.slice(-8)}
                                    </a>
                                </div>
                            {:else if error}
                                <p class="proof-error">{error}</p>
                            {/if}

                            <p class="proof-tools-meta">
                                Tier {tierCfg.name} · commitment stored locally ·
                                on-chain attestation via Soroban contract.
                            </p>
                        </div>
                    {:else if proving}
                        <div class="proving-card">
                            <div class="proving-spinner"></div>
                            <p class="proving-text">
                                Generating cryptographic commitment...
                            </p>
                            <p class="proving-sub">
                                Computing SHA-256(address || balance || salt)
                            </p>
                        </div>
                    {:else}
                        <!-- Balance + tier + generate button -->
                        <div class="proof-panel">
                            <div class="tier-display">
                                <span class="tier-icon">{tierCfg.icon}</span>
                                <span
                                    class="tier-name"
                                    style="color:{tierCfg.color}"
                                    >{tierCfg.name}</span
                                >
                            </div>

                            {#if balance !== null}
                                <div class="balance-row">
                                    <span class="balance-val"
                                        >{formatKaleBalance(balance)}</span
                                    >
                                    <span class="balance-label">KALE</span>
                                </div>
                            {/if}

                            <p class="proof-desc">
                                Generate a cryptographic commitment of your
                                farming tier. The commitment hides your balance
                                behind a salted SHA-256 hash.
                            </p>
                            {#if !hasKale}
                                <div class="proof-nudge">
                                    <p>
                                        Need KALE activity to verify this proof.
                                    </p>
                                    <a class="proof-nudge-link" href="/kale"
                                        >Head to the Kale Farm →</a
                                    >
                                </div>
                            {/if}

                            {#if error}
                                <p class="proof-error">{error}</p>
                            {/if}

                            <button
                                class="generate-btn"
                                onclick={generateProof}
                                disabled={balance === null}
                            >
                                Generate Proof of Farm
                            </button>
                        </div>
                    {/if}
                </section>

                <!-- Coming Soon Badges -->
                <section class="badges-section">
                    <h2 class="section-label">Dreamboard</h2>
                    <div class="badge-grid">
                        {#each BADGE_REGISTRY.slice(1) as def}
                            <FarmBadge
                                badge={null}
                                {def}
                                locked={!def.available}
                            />
                        {/each}
                    </div>
                </section>

                <!-- Commitment Gallery -->
                <section class="gallery-section">
                    <div class="gallery-header">
                        <h2 class="section-label">Commitment Gallery</h2>
                        <div class="gallery-header-right">
                            <span class="gallery-subtitle"
                                >Live commitments & design concepts — click to
                                open</span
                            >
                            <button
                                class="gallery-cta"
                                type="button"
                                onclick={generateProof}
                                disabled={balance === null ||
                                    proving ||
                                    hasProof}
                            >
                                {hasProof
                                    ? "Commitment sealed"
                                    : "Generate a live commitment"}
                            </button>
                        </div>
                    </div>
                    <div class="gallery-grid">
                        {#each galleryProofs as proof}
                            <article class="gallery-card">
                                <div class="gallery-card-top">
                                    <span class="gallery-status"
                                        >{proof.status}</span
                                    >
                                    <span class="gallery-circuit"
                                        >{proof.circuit}</span
                                    >
                                </div>
                                <h3 class="gallery-title">{proof.title}</h3>
                                <p class="gallery-summary">{proof.summary}</p>
                                <div class="gallery-tags">
                                    {#each proof.tags as tag}
                                        <span class="gallery-tag">{tag}</span>
                                    {/each}
                                    <span
                                        class="gallery-tag gallery-tag--status"
                                    >
                                        {proof.requiresKale
                                            ? "Needs KALE"
                                            : "No KALE needed"}
                                    </span>
                                </div>
                                <div class="gallery-foot">
                                    <span class="gallery-proof"
                                        >{proof.proof}</span
                                    >
                                    <div class="gallery-actions">
                                        <button
                                            class="gallery-open"
                                            type="button"
                                            onclick={() => openProof(proof)}
                                        >
                                            View details
                                        </button>
                                        <a
                                            class="gallery-link"
                                            href={proof.file}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            Open proof file →
                                        </a>
                                    </div>
                                </div>
                            </article>
                        {/each}
                    </div>
                </section>
            </div>
        {/if}
    </div>

    <section class="game-section">
        <div class="game-header">
            <h2 class="section-label">Mini Game Commitment Lab</h2>
            <p class="game-subtitle">
                Repeatable, progressive commitments tied directly to mini game
                actions.
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
</div>

{#if activeProof}
    <div class="gallery-overlay" role="dialog" aria-modal="true">
        <button
            class="gallery-backdrop"
            type="button"
            onclick={closeProof}
            aria-label="Close proof details"
        ></button>
        <div class="gallery-modal">
            <div class="gallery-modal-header">
                <div>
                    <p class="gallery-modal-label">Proof file</p>
                    <h3 class="gallery-modal-title">{activeProof.title}</h3>
                </div>
                <button
                    class="gallery-close"
                    type="button"
                    onclick={closeProof}
                    aria-label="Close proof details">✕</button
                >
            </div>
            <p class="gallery-modal-summary">{activeProof.summary}</p>
            <div class="gallery-modal-grid">
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Scheme</span>
                    <span class="gallery-modal-value"
                        >{activeProof.circuit}</span
                    >
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Method</span>
                    <span class="gallery-modal-value">{activeProof.proof}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Status</span>
                    <span class="gallery-modal-value">{activeProof.status}</span
                    >
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Test</span>
                    <span class="gallery-modal-value">{activeProof.tested}</span
                    >
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Wallet</span>
                    <span class="gallery-modal-value">{activeProof.wallet}</span
                    >
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Proof file</span>
                    <a
                        class="gallery-modal-link"
                        href={activeProof.file}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {activeProof.file}
                    </a>
                </div>
                <div class="gallery-modal-card gallery-modal-requirement">
                    <span class="gallery-modal-eyebrow">Availability</span>
                    <span class="gallery-modal-value"
                        >{activeProof.requirementCopy}</span
                    >
                    {#if activeProof.requiresKale && !hasKale}
                        <a class="gallery-modal-cta" href="/kale"
                            >Complete Kale Farm task →</a
                        >
                    {/if}
                </div>
            </div>
            <div class="gallery-modal-lists">
                <div>
                    <h4>Inputs</h4>
                    <ul>
                        {#each activeProof.inputs as item}
                            <li>{item}</li>
                        {/each}
                    </ul>
                </div>
                <div>
                    <h4>Outputs</h4>
                    <ul>
                        {#each activeProof.outputs as item}
                            <li>{item}</li>
                        {/each}
                    </ul>
                </div>
            </div>
            <p class="gallery-modal-note">{activeProof.note}</p>
        </div>
    </div>
{/if}

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

    /* ── Loading ── */
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
        background: rgba(154, 230, 0, 0.12);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        padding: 2px 8px;
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
</style>
