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
        TIER_VERIFIER_CONTRACT_ID,
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
    let gameAttesting = $state<string | null>(null);
    let gamePayloadCopied = $state<string | null>(null);
    let gameAttestNotes = $state<Record<string, string>>({});
    let gameVerifierPayloads = $state<Record<string, string>>({});
    let gameIntegrity = $state<Record<string, GameIntegrityState>>({});
    let gameWallet = $state<string | null>(null);
    let verifying = $state(false);
    let verifyResult = $state<boolean | null>(null);
    let proofData = $state<ProofResult | null>(null);
    let txHash = $state<string | null>(null);

    let onChainVerified = $state<boolean | null>(null);
    const SUPER_VERIFIER_ENTRYPOINT = "verify_and_attest";
    const SUPER_VERIFIER_CONTRACT_ID = TIER_VERIFIER_CONTRACT_ID;

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
        requirements: number[];
        color: string;
        kind: "tic" | "dodge" | "pattern";
        zkSpec: GameZkSpec;
    };

    type GameZkSpec = {
        proofLabel: string;
        poseidonInputs: string[];
        publicSignals: string[];
        hostFunctions: string[];
        verifierEntrypoint: string;
        superVerifierPaths: SuperVerifierPath[];
    };

    type SuperVerifierPath = {
        method: "verify_and_attest" | "check_attestation" | "update_vkey" | "set_admin";
        label: string;
        mode: "live" | "ops";
    };

    type GameVerifierPayload = {
        schema: "farm.game.attestation.v1";
        protocol: "stellar-protocol-25";
        network: "stellar-mainnet";
        contractId: string;
        verifierEntrypoint: string;
        gameId: string;
        wallet: string;
        level: number;
        score: number;
        actionHash: string;
        commitment: string;
        salt: string;
        createdAt: number;
        poseidonInputs: string[];
        publicSignals: string[];
        superVerifierPaths: SuperVerifierPath[];
    };

    type GameIntegrityState = {
        state: "checking" | "pass" | "fail";
        message: string;
        checkedAt: number;
    };

    type TicTacState = {
        board: ("X" | "O" | null)[];
        turn: "player" | "ai";
        finished: boolean;
        winner: "player" | "ai" | "draw" | null;
        message: string;
        moveLog: string[];
    };

    type DodgeState = {
        lane: number;
        hazards: number[];
        step: number;
        status: "ready" | "running" | "crashed" | "cleared";
        lastHazard: number | null;
        moveLog: string[];
    };

    type PatternState = {
        pattern: string[];
        input: string[];
        stage: "idle" | "showing" | "listening" | "success" | "fail";
        showPreview: boolean;
        moveLog: string[];
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
            summary:
                "Commit to a winning line without exposing the full board transcript.",
            goal: "Complete 3 smart moves to unlock the win commitment.",
            circuit: "GridMate v0.1",
            requirements: [3, 5, 7],
            color: "#38bdf8",
            kind: "tic",
            zkSpec: {
                proofLabel: "Private win-path commitment",
                poseidonInputs: [
                    "wallet_hash",
                    "game_id_hash",
                    "level",
                    "score",
                    "action_hash",
                    "salt",
                ],
                publicSignals: [
                    "commitment",
                    "action_hash",
                    "level_threshold",
                ],
                hostFunctions: [
                    "bn254_add",
                    "bn254_mul",
                    "bn254_pairing_check",
                ],
                verifierEntrypoint: SUPER_VERIFIER_ENTRYPOINT,
                superVerifierPaths: [
                    {
                        method: "verify_and_attest",
                        label: "Tier-aware proof verify",
                        mode: "live",
                    },
                    {
                        method: "check_attestation",
                        label: "Attestation status check",
                        mode: "live",
                    },
                ],
            },
        },
        {
            id: "asteroid-dodge",
            title: "Asteroid Dodge",
            summary:
                "Commit to a full hazard-dodge run while keeping the lane path private.",
            goal: "Survive the dodge sequence to mint a run commitment.",
            circuit: "DodgeSeal v0.2",
            requirements: [5, 7, 9],
            color: "#f472b6",
            kind: "dodge",
            zkSpec: {
                proofLabel: "Private dodge-sequence commitment",
                poseidonInputs: [
                    "wallet_hash",
                    "game_id_hash",
                    "level",
                    "score",
                    "action_hash",
                    "salt",
                ],
                publicSignals: [
                    "commitment",
                    "hazard_sequence_hash",
                    "clear_flag",
                ],
                hostFunctions: [
                    "bn254_add",
                    "bn254_mul",
                    "bn254_pairing_check",
                ],
                verifierEntrypoint: SUPER_VERIFIER_ENTRYPOINT,
                superVerifierPaths: [
                    {
                        method: "verify_and_attest",
                        label: "Run commitment verify",
                        mode: "live",
                    },
                    {
                        method: "update_vkey",
                        label: "Circuit key rotation rail",
                        mode: "ops",
                    },
                ],
            },
        },
        {
            id: "pattern-runner",
            title: "Pattern Runner",
            summary:
                "Commit to a matched rhythm streak without revealing full sequence details.",
            goal: "Hit the rhythm targets to unlock the streak commitment.",
            circuit: "RhythmLock v0.1",
            requirements: [4, 6, 8],
            color: "#c084fc",
            kind: "pattern",
            zkSpec: {
                proofLabel: "Private rhythm-sequence commitment",
                poseidonInputs: [
                    "wallet_hash",
                    "game_id_hash",
                    "level",
                    "score",
                    "action_hash",
                    "salt",
                ],
                publicSignals: [
                    "commitment",
                    "pattern_hash",
                    "sequence_valid",
                ],
                hostFunctions: [
                    "bn254_add",
                    "bn254_mul",
                    "bn254_pairing_check",
                ],
                verifierEntrypoint: SUPER_VERIFIER_ENTRYPOINT,
                superVerifierPaths: [
                    {
                        method: "verify_and_attest",
                        label: "Pattern commitment verify",
                        mode: "live",
                    },
                    {
                        method: "set_admin",
                        label: "Governance guard rail",
                        mode: "ops",
                    },
                ],
            },
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

    let ticState = $state<TicTacState>(createTicTacState());
    let dodgeState = $state<DodgeState>(
        createDodgeState(baseZkGames[1]?.requirements[0] ?? 5),
    );
    let patternState = $state<PatternState>(
        createPatternState(baseZkGames[2]?.requirements[0] ?? 4),
    );
    let patternPreviewTimer: number | null = null;

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
    let hasSuperVerifierContract = $derived(
        SUPER_VERIFIER_CONTRACT_ID.length > 0,
    );
    let sealedGameCount = $derived(zkGames.filter((game) => !!game.proof).length);
    let locallyVerifiedGameCount = $derived(
        Object.values(gameIntegrity).filter((item) => item.state === "pass")
            .length,
    );
    let superVerifierLabel = $derived(
        `${SUPER_VERIFIER_CONTRACT_ID.slice(0, 8)}...${SUPER_VERIFIER_CONTRACT_ID.slice(-6)}`,
    );
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
            resetPatternTimer();
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
                publicSignals?: unknown;
            };

            const parseUnsignedSignal = (value: unknown, label: string): bigint => {
                if (typeof value !== "string" || !/^\d+$/.test(value)) {
                    throw new Error(`${label} is malformed. Regenerate proof before submission.`);
                }
                return BigInt(value);
            };

            if (
                !Number.isInteger(proofData.tier) ||
                proofData.tier < 0 ||
                proofData.tier > 3
            ) {
                throw new Error("Proof tier is out of range. Regenerate proof before submission.");
            }

            const publicSignals = Array.isArray(proofData.publicSignals)
                ? proofData.publicSignals
                : null;
            if (!publicSignals || publicSignals.length < 2) {
                throw new Error("Proof public signals are missing. Regenerate proof before submission.");
            }

            const tierSignal = parseUnsignedSignal(publicSignals[0], "Tier public signal");
            const commitmentSignal = parseUnsignedSignal(
                publicSignals[1],
                "Commitment public signal",
            );
            const storedCommitment = parseUnsignedSignal(
                proofData.commitment,
                "Stored commitment",
            );

            if (tierSignal !== BigInt(proofData.tier)) {
                throw new Error("Proof tier/public-signal mismatch. Regenerate proof before submission.");
            }
            if (commitmentSignal !== storedCommitment) {
                throw new Error("Proof commitment/public-signal mismatch. Regenerate proof before submission.");
            }

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

            const commitmentBytes = toBytes32(commitmentSignal);

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
            const message = e?.message || "Verification failed";
            if (message.includes("rejected both G2 encodings")) {
                error =
                    "Super Verifier is live but the on-chain verification key encoding looks stale. Admin should run update_vkey with CAP-0074 G2 encoding.";
            } else if (
                message.includes("Proof payload is malformed") ||
                message.includes("Proof payload contains non-numeric coordinates")
            ) {
                error =
                    "Proof payload is malformed. Regenerate proof; if this repeats, refresh and rebuild proof artifacts.";
            } else if (message.includes("Contract #1 (InvalidProof)")) {
                error =
                    "Super Verifier rejected this proof as InvalidProof. Regenerate a fresh proof; if it still fails, the on-chain verification key does not match the current /zk proving artifacts.";
            } else {
                error = message;
            }
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

    function getGameSession(gameId: string): ZkGameSession | undefined {
        return zkGames.find((g) => g.id === gameId);
    }

    function clearGameVerifierArtifacts(gameId: string) {
        gameAttestNotes = Object.fromEntries(
            Object.entries(gameAttestNotes).filter(([id]) => id !== gameId),
        );
        gameVerifierPayloads = Object.fromEntries(
            Object.entries(gameVerifierPayloads).filter(([id]) => id !== gameId),
        );
        gameIntegrity = Object.fromEntries(
            Object.entries(gameIntegrity).filter(([id]) => id !== gameId),
        );
        if (gamePayloadCopied === gameId) {
            gamePayloadCopied = null;
        }
    }

    async function sha256Hex(input: string): Promise<string> {
        const encoded = new TextEncoder().encode(input);
        const digest = await crypto.subtle.digest("SHA-256", encoded);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    async function hashStringToField(input: string): Promise<bigint> {
        const digestHex = await sha256Hex(input);
        return BigInt(`0x${digestHex.slice(0, 60)}`);
    }

    async function verifyGameProofLocally(game: ZkGameSession) {
        if (!game.proof) return;
        if (!zkLogic) {
            gameError = "ZK logic not loaded yet.";
            return;
        }

        gameIntegrity = {
            ...gameIntegrity,
            [game.id]: {
                state: "checking",
                message: "Recomputing action hash and Poseidon commitment...",
                checkedAt: Date.now(),
            },
        };

        try {
            const proof = game.proof;
            const actionHashHex = await sha256Hex(JSON.stringify(proof.actions));
            const actionHashField = BigInt(`0x${actionHashHex.slice(0, 60)}`);
            const walletHash =
                proof.wallet.startsWith("G") && proof.wallet.length === 56
                    ? await zkLogic.hashAddress(proof.wallet)
                    : await hashStringToField(proof.wallet);
            const gameIdHash = await hashStringToField(proof.id);
            const commitment = await zkLogic.poseidonHash([
                walletHash,
                gameIdHash,
                BigInt(proof.level),
                BigInt(proof.score),
                actionHashField,
                BigInt(proof.salt),
            ]);

            const actionHashMatches = actionHashHex === proof.actionHash;
            const commitmentMatches = commitment.toString() === proof.commitment;
            const pass = actionHashMatches && commitmentMatches;

            gameIntegrity = {
                ...gameIntegrity,
                [game.id]: {
                    state: pass ? "pass" : "fail",
                    message: pass
                        ? "Local verification passed: action transcript and Poseidon commitment are consistent."
                        : "Local verification failed: commitment mismatch detected.",
                    checkedAt: Date.now(),
                },
            };
        } catch (e: any) {
            gameIntegrity = {
                ...gameIntegrity,
                [game.id]: {
                    state: "fail",
                    message:
                        e?.message ||
                        "Local verification failed due to computation error.",
                    checkedAt: Date.now(),
                },
            };
        }
    }

    function buildGameVerifierPayload(
        game: ZkGameSession,
    ): GameVerifierPayload | null {
        if (!game.proof) return null;
        return {
            schema: "farm.game.attestation.v1",
            protocol: "stellar-protocol-25",
            network: "stellar-mainnet",
            contractId: SUPER_VERIFIER_CONTRACT_ID,
            verifierEntrypoint: game.zkSpec.verifierEntrypoint,
            gameId: game.proof.id,
            wallet: game.proof.wallet,
            level: game.proof.level,
            score: game.proof.score,
            actionHash: game.proof.actionHash,
            commitment: game.proof.commitment,
            salt: game.proof.salt,
            createdAt: game.proof.createdAt,
            poseidonInputs: game.zkSpec.poseidonInputs,
            publicSignals: game.zkSpec.publicSignals,
            superVerifierPaths: game.zkSpec.superVerifierPaths,
        };
    }

    function rememberVerifierPayload(gameId: string, payload: GameVerifierPayload) {
        gameVerifierPayloads = {
            ...gameVerifierPayloads,
            [gameId]: JSON.stringify(payload, null, 2),
        };
    }

    async function copyVerifierPayload(game: ZkGameSession) {
        const payload = buildGameVerifierPayload(game);
        if (!payload) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            rememberVerifierPayload(game.id, payload);
            gamePayloadCopied = game.id;
            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    "Verifier payload copied. Ready for verify_and_attest.",
            };
            setTimeout(() => {
                if (gamePayloadCopied === game.id) {
                    gamePayloadCopied = null;
                }
            }, 2000);
        } catch (e: any) {
            gameError = e.message || "Unable to copy verifier payload";
        }
    }

    function createTicTacState(): TicTacState {
        return {
            board: Array(9).fill(null),
            turn: "player",
            finished: false,
            winner: null,
            message: "Grab center or a corner to start strong.",
            moveLog: [],
        };
    }

    function createDodgeState(
        steps: number,
        status: "ready" | "running" = "ready",
    ): DodgeState {
        return {
            lane: 1,
            hazards: Array.from({ length: steps }, () =>
                Math.floor(Math.random() * 3),
            ),
            step: 0,
            status,
            lastHazard: null,
            moveLog: [],
        };
    }

    function createPatternState(length: number): PatternState {
        const colors = ["gold", "jade", "violet", "cobalt"];
        const pattern = Array.from({ length }, () =>
            colors[Math.floor(Math.random() * colors.length)],
        );
        return {
            pattern,
            input: [],
            stage: "idle",
            showPreview: false,
            moveLog: [],
        };
    }

    function resetPatternTimer() {
        if (patternPreviewTimer !== null) {
            clearTimeout(patternPreviewTimer);
            patternPreviewTimer = null;
        }
    }

    function primeArcadeState(game: ZkGameSession) {
        if (game.kind === "tic") {
            ticState = createTicTacState();
        } else if (game.kind === "dodge") {
            dodgeState = createDodgeState(getRequirement(game));
        } else {
            resetPatternTimer();
            patternState = createPatternState(getRequirement(game));
        }
    }

    function startGameRun(game: ZkGameSession) {
        if (game.kind === "tic") {
            ticState = createTicTacState();
        } else if (game.kind === "dodge") {
            dodgeState = createDodgeState(getRequirement(game), "running");
        } else {
            startPatternRun(game);
            return;
        }

        updateGame(game.id, {
            status: "playing",
            progress: 0,
            actionLog: [],
        });
    }

    function completeRun(
        game: ZkGameSession,
        actionLog: string[],
        scoreDelta: number,
    ) {
        const requirement = getRequirement(game);
        updateGame(game.id, {
            actionLog,
            progress: requirement,
            score: game.score + scoreDelta,
            status: "complete",
        });
    }

    function resetGame(game: ZkGameSession) {
        primeArcadeState(game);
        clearGameVerifierArtifacts(game.id);
        updateGame(game.id, {
            progress: 0,
            level: game.level,
            score: 0,
            actionLog: [],
            status: "idle",
        });
    }

    function chooseAiMove(
        board: ("X" | "O" | null)[],
    ): number | null {
        const open = board
            .map((cell, idx) => (cell === null ? idx : -1))
            .filter((idx) => idx >= 0);
        if (!open.length) return null;
        return open[Math.floor(Math.random() * open.length)];
    }

    function checkTicWinner(
        board: ("X" | "O" | null)[],
    ): "X" | "O" | "draw" | null {
        const lines = [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
            [0, 4, 8],
            [2, 4, 6],
        ];
        for (const [a, b, c] of lines) {
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return board[a];
            }
        }
        return board.every(Boolean) ? "draw" : null;
    }

    function handleTicMove(game: ZkGameSession, index: number) {
        if (game.kind !== "tic") return;
        if (ticState.finished || ticState.board[index]) return;

        const board = [...ticState.board];
        const moveLog = [...ticState.moveLog];

        board[index] = "X";
        moveLog.push(`X-${index}`);

        let winner = checkTicWinner(board);

        if (!winner) {
            const aiIndex = chooseAiMove(board);
            if (aiIndex !== null) {
                board[aiIndex] = "O";
                moveLog.push(`O-${aiIndex}`);
            }
            winner = checkTicWinner(board);
        }

        const finished = winner !== null;
        const mappedWinner =
            winner === "X" ? "player" : winner === "O" ? "ai" : winner === "draw" ? "draw" : null;

        ticState = {
            board,
            turn: "player",
            finished,
            winner: mappedWinner,
            message: finished
                ? mappedWinner === "player"
                    ? "Line sealed. Commitment ready."
                    : mappedWinner === "ai"
                      ? "AI blocked the line. Reset and retry."
                      : "Draw game. Reset to play again."
                : "Your move — look for a fork.",
            moveLog,
        };

        if (winner === "X") {
            completeRun(game, moveLog, 24);
        } else if (winner) {
            updateGame(game.id, {
                status: "idle",
                progress: 0,
                actionLog: [],
            });
        } else if (game.status === "idle") {
            updateGame(game.id, { status: "playing" });
        }
    }

    function shiftDodgeLane(delta: number) {
        if (dodgeState.status === "crashed" || dodgeState.status === "cleared")
            return;
        const nextLane = Math.min(2, Math.max(0, dodgeState.lane + delta));
        dodgeState = { ...dodgeState, lane: nextLane };
    }

    function advanceDodgeStep(game: ZkGameSession) {
        if (game.kind !== "dodge") return;
        if (dodgeState.status !== "running") return;

        const hazard = dodgeState.hazards[dodgeState.step];
        const lane = dodgeState.lane;
        const safe = lane !== hazard;
        const moveLog = [
            ...dodgeState.moveLog,
            `step-${dodgeState.step + 1}:lane-${lane}:hazard-${hazard}`,
        ];
        const nextStep = dodgeState.step + 1;
        const cleared = safe && nextStep >= dodgeState.hazards.length;

        dodgeState = {
            ...dodgeState,
            step: nextStep,
            lastHazard: hazard,
            moveLog,
            status: cleared ? "cleared" : safe ? "running" : "crashed",
        };

        if (!safe) {
            updateGame(game.id, {
                status: "idle",
                progress: 0,
                actionLog: [],
            });
            return;
        }

        const requirement = getRequirement(game);
        if (cleared) {
            completeRun(game, moveLog, 18);
        } else {
            updateGame(game.id, {
                status: "playing",
                progress: Math.min(nextStep, requirement),
            });
        }
    }

    function startPatternRun(game: ZkGameSession) {
        if (game.kind !== "pattern") return;
        resetPatternTimer();
        const length = getRequirement(game);
        patternState = {
            ...createPatternState(length),
            stage: "showing",
            showPreview: true,
        };
        updateGame(game.id, {
            status: "playing",
            progress: 0,
            actionLog: [],
        });
        const duration = 1000 + length * 140;
        if (typeof window !== "undefined") {
            patternPreviewTimer = window.setTimeout(() => {
                patternState = {
                    ...patternState,
                    showPreview: false,
                    stage: "listening",
                };
            }, duration);
        } else {
            patternState = {
                ...patternState,
                showPreview: false,
                stage: "listening",
            };
        }
    }

    function handlePatternTap(game: ZkGameSession, color: string) {
        if (game.kind !== "pattern") return;
        if (patternState.stage !== "listening") return;

        const nextInput = [...patternState.input, color];
        const expected = patternState.pattern[nextInput.length - 1];
        const isMatch = expected === color;

        if (!isMatch) {
            patternState = {
                ...patternState,
                input: nextInput,
                stage: "fail",
            };
            updateGame(game.id, {
                status: "idle",
                progress: 0,
                actionLog: [],
            });
            return;
        }

        const requirement = getRequirement(game);
        if (nextInput.length === patternState.pattern.length) {
            const actionLog = patternState.pattern.map(
                (tone, idx) => `beat-${idx + 1}-${tone}`,
            );
            patternState = {
                ...patternState,
                input: nextInput,
                stage: "success",
            };
            completeRun(game, actionLog, 22);
        } else {
            patternState = { ...patternState, input: nextInput };
            updateGame(game.id, {
                status: "playing",
                progress: Math.min(nextInput.length, requirement),
            });
        }
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
            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    "Commitment sealed. Payload is ready for verify_and_attest.",
            };
            const refreshed = getGameSession(game.id);
            if (refreshed) {
                primeArcadeState(refreshed);
                await verifyGameProofLocally(refreshed);
            }
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

    async function prepareGameAttestation(game: ZkGameSession) {
        if (!game.proof) return;
        gameError = null;
        gameAttesting = game.id;

        try {
            const payload = buildGameVerifierPayload(game);
            if (!payload) {
                throw new Error("Seal a game commitment before preparing attestation.");
            }

            rememberVerifierPayload(game.id, payload);

            if (!userState.contractId || !isAuth) {
                gameAttestNotes = {
                    ...gameAttestNotes,
                    [game.id]:
                        "Super Verifier payload prepared. Connect wallet to submit transaction.",
                };
                return;
            }

            const kit = await getPasskeyKit();
            if (!kit) {
                throw new Error("Wallet kit unavailable.");
            }

            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    "Super Verifier invoke payload prepared for verify_and_attest submission.",
            };
        } catch (e: any) {
            gameError = e.message || "Unable to prepare game attestation";
        } finally {
            gameAttesting = null;
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
            <p class="farm-subtitle">
                Kale Valley Proof Garden on Stellar
            </p>
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
                <p class="landing-line">Harvest your KALE proof tier</p>
                <p class="landing-line dim">without revealing your balance.</p>
                <p class="landing-connect">
                    Connect your wallet to enter the valley
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
                Beat real mini-games to forge Poseidon commitments, then route
                invoke payloads through the live Super Verifier contract.
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
                    <div class="game-zk-rail">
                        <p class="game-zk-title">{game.zkSpec.proofLabel}</p>
                        <div class="game-zk-tags">
                            <span class="game-zk-tag"
                                >Live: Poseidon commitment</span
                            >
                            <span class="game-zk-tag"
                                >Live: SHA-256 transcript hash</span
                            >
                        </div>
                        <div class="game-super-paths">
                            {#each game.zkSpec.superVerifierPaths as path}
                                <span
                                    class={`game-super-path ${
                                        path.mode === "live"
                                            ? "game-super-path--live"
                                            : "game-super-path--ops"
                                    }`}
                                >
                                    {path.method} · {path.label}
                                </span>
                            {/each}
                        </div>
                        <p class="game-zk-meta">
                            Planned Protocol 25 host ops: {game.zkSpec.hostFunctions.join(
                                " · ",
                            )}
                        </p>
                        <p class="game-zk-meta">
                            Public signals: {game.zkSpec.publicSignals.join(
                                " · ",
                            )}
                        </p>
                        <p class="game-zk-meta">
                            Verifier entrypoint: {game.zkSpec.verifierEntrypoint}
                        </p>
                    </div>
                    {#if game.kind === "tic"}
                        <div class="game-surface">
                            <div class="tic-grid">
                                {#each Array(9) as _, idx}
                                    <button
                                        class={`tic-cell ${ticState.board[idx] === "X"
                                            ? "tic-player"
                                            : ""} ${ticState.board[idx] === "O"
                                            ? "tic-ai"
                                            : ""}`}
                                        type="button"
                                        onclick={() => handleTicMove(game, idx)}
                                        disabled={game.status === "complete"}
                                    >
                                        {ticState.board[idx] ?? ""}
                                    </button>
                                {/each}
                            </div>
                            <p class="game-tip">{ticState.message}</p>
                            <div class="game-chip">
                                {ticState.finished
                                    ? ticState.winner === "player"
                                        ? "Victory — ready to seal"
                                        : "AI blocked you — reset to retry"
                                    : "Play a full round to unlock a proof-ready run."}
                            </div>
                        </div>
                    {:else if game.kind === "dodge"}
                        <div class="game-surface">
                            <div class="dodge-lanes">
                                {#each [0, 1, 2] as lane}
                                    <div
                                        class={`dodge-lane ${dodgeState.lane === lane
                                            ? "dodge-lane--ship"
                                            : ""} ${dodgeState.lastHazard === lane
                                            ? "dodge-lane--hazard"
                                            : ""}`}
                                    >
                                        <span class="lane-label">
                                            {["Left", "Center", "Right"][lane]}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                            <div class="dodge-hud">
                                <span>
                                    Step {Math.min(
                                        dodgeState.step + 1,
                                        dodgeState.hazards.length,
                                    )}/{dodgeState.hazards.length}
                                </span>
                                <span>
                                    {dodgeState.status === "crashed"
                                        ? "Crashed — reset to try again"
                                        : dodgeState.status === "cleared"
                                            ? "Sequence cleared — seal it"
                                            : "Pick a lane, then advance"}
                                </span>
                            </div>
                            <div class="dodge-controls">
                                <button
                                    class="game-action-btn ghost"
                                    type="button"
                                    onclick={() => shiftDodgeLane(-1)}
                                    disabled={dodgeState.status !== "running"}
                                >
                                    ◀ Lane
                                </button>
                                <button
                                    class="game-action-btn ghost"
                                    type="button"
                                    onclick={() => shiftDodgeLane(1)}
                                    disabled={dodgeState.status !== "running"}
                                >
                                    Lane ▶
                                </button>
                                <button
                                    class="game-action-btn"
                                    type="button"
                                    onclick={() => advanceDodgeStep(game)}
                                    disabled={game.status !== "playing" ||
                                        dodgeState.status !== "running"}
                                >
                                    Advance
                                </button>
                            </div>
                        </div>
                    {:else}
                        <div class="game-surface">
                            <div class="pattern-preview">
                                {#each patternState.pattern as tone, idx}
                                    <span
                                        class={`pattern-dot ${
                                            patternState.showPreview ||
                                            idx < patternState.input.length
                                                ? `tone-${tone} pattern-dot--on`
                                                : ""
                                        } ${patternState.stage === "fail" &&
                                            patternState.input[idx] &&
                                            patternState.input[idx] !== tone
                                            ? "pattern-dot--miss"
                                            : ""}`}
                                    >
                                        {patternState.showPreview ||
                                        idx < patternState.input.length
                                            ? tone.slice(0, 1).toUpperCase()
                                            : "•"}
                                    </span>
                                {/each}
                            </div>
                            <div class="pattern-pads">
                                {#each ["gold", "jade", "violet", "cobalt"] as tone}
                                    <button
                                        class={`pattern-pad tone-${tone} ${patternState.stage === "showing" &&
                                            patternState.pattern[
                                                patternState.input.length
                                            ] === tone
                                            ? "pattern-pad--pulse"
                                            : ""}`}
                                        type="button"
                                        onclick={() => handlePatternTap(game, tone)}
                                        disabled={game.status !== "playing" ||
                                            patternState.stage === "showing"}
                                    >
                                        {tone}
                                    </button>
                                {/each}
                            </div>
                            <p class="game-tip">
                                {patternState.stage === "showing"
                                    ? "Memorize the flash, then tap it back."
                                    : patternState.stage === "success"
                                        ? "Pattern locked — seal the commitment."
                                        : patternState.stage === "fail"
                                            ? "Wrong beat. Reset and replay."
                                            : "Repeat the hidden pattern to clear the run."}
                            </p>
                        </div>
                    {/if}
                    <div class="game-progress">
                        <div class="game-progress-top">
                            <span>Progress</span>
                            <span
                                >{game.progress}/{getRequirement(game)} steps</span
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
                            <span>
                                Status:
                                {game.status === "complete"
                                    ? "ready to seal"
                                    : game.status}
                            </span>
                        </div>
                    </div>
                    <div class="game-actions">
                        <button
                            class="game-action-btn"
                            type="button"
                            onclick={() => startGameRun(game)}
                            disabled={game.status === "playing"}
                        >
                            {game.status === "playing" ? "Run active" : "Start run"}
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
                            <div>
                                <p class="game-proof-label">Poseidon inputs</p>
                                <p class="game-proof-value">
                                    {game.zkSpec.poseidonInputs.join(" · ")}
                                </p>
                            </div>
                            <div class="game-proof-actions">
                                <button
                                    class="game-copy-btn"
                                    type="button"
                                    onclick={() => copyGameProof(game)}
                                >
                                    {gameCopied === game.id
                                        ? "Copied proof packet"
                                        : "Copy proof packet"}
                                </button>
                                <button
                                    class="game-copy-btn ghost"
                                    type="button"
                                    onclick={() => verifyGameProofLocally(game)}
                                    disabled={gameIntegrity[game.id]?.state ===
                                        "checking"}
                                >
                                    {gameIntegrity[game.id]?.state === "checking"
                                        ? "Checking..."
                                        : "Run local verify"}
                                </button>
                                <button
                                    class="game-copy-btn ghost"
                                    type="button"
                                    onclick={() => copyVerifierPayload(game)}
                                >
                                    {gamePayloadCopied === game.id
                                        ? "Copied verifier payload"
                                        : "Copy verifier payload"}
                                </button>
                                <button
                                    class="game-copy-btn primary"
                                    type="button"
                                    onclick={() => prepareGameAttestation(game)}
                                    disabled={gameAttesting === game.id}
                                >
                                    {gameAttesting === game.id
                                        ? "Preparing..."
                                        : "Build invoke payload"}
                                </button>
                            </div>
                            {#if gameAttestNotes[game.id]}
                                <p class="game-proof-note">
                                    {gameAttestNotes[game.id]}
                                </p>
                            {/if}
                            {#if gameIntegrity[game.id]}
                                <p
                                    class={`game-proof-note ${gameIntegrity[
                                        game.id
                                    ]?.state === "pass"
                                        ? "game-proof-note--pass"
                                        : gameIntegrity[game.id]?.state ===
                                            "fail"
                                          ? "game-proof-note--fail"
                                          : ""}`}
                                >
                                    {gameIntegrity[game.id]?.message}
                                </p>
                            {/if}
                            {#if gameVerifierPayloads[game.id]}
                                <details class="game-verifier-payload">
                                    <summary>Verifier payload preview</summary>
                                    <pre>{gameVerifierPayloads[game.id]}</pre>
                                </details>
                            {/if}
                        </div>
                    {/if}
                </article>
            {/each}
        </div>
    </section>

    <section class="verifier-section">
        <div class="verifier-card">
            <div class="verifier-head">
                <h2 class="section-label">Verifier Dock</h2>
                <span
                    class={`verifier-status ${hasSuperVerifierContract
                        ? "verifier-status--ready"
                        : "verifier-status--pending"}`}
                >
                    {hasSuperVerifierContract
                        ? "Super Verifier live"
                        : "Verifier pending"}
                </span>
            </div>
            <p class="verifier-copy">
                Live today: deterministic transcript hashing + Poseidon
                commitment generation + local recompute verification.
                <code>verify_and_attest</code> and
                <code>check_attestation</code> are the live rails; governance
                rails (<code>update_vkey</code>, <code>set_admin</code>) are
                surfaced as ops paths for circuit lifecycle control.
            </p>
            <div class="verifier-grid">
                <div class="verifier-item">
                    <p class="verifier-label">Sealed Game Commitments</p>
                    <p class="verifier-value">{sealedGameCount}</p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">Local Verifications Passed</p>
                    <p class="verifier-value">{locallyVerifiedGameCount}</p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">Entrypoint</p>
                    <p class="verifier-value">{SUPER_VERIFIER_ENTRYPOINT}</p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">Super Verifier Contract</p>
                    <p class="verifier-value">{superVerifierLabel}</p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">Commitment Stack</p>
                    <p class="verifier-value">Poseidon Fr over 6 inputs</p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">BN254 Host Ops</p>
                    <p class="verifier-value">
                        Planned: bn254_add · bn254_mul · bn254_pairing_check
                    </p>
                </div>
                <div class="verifier-item">
                    <p class="verifier-label">Super Verifier Methods</p>
                    <p class="verifier-value">
                        verify_and_attest · check_attestation · update_vkey ·
                        set_admin
                    </p>
                </div>
            </div>
            <p class="verifier-env">
                Tier proofs and arcade payloads now both target this same
                contract. Different methods are surfaced per game for live
                verification, attestation checks, and governance operations.
            </p>
        </div>
    </section>

    <!-- Footer -->
    <footer class="farm-footer">
        <p class="footer-tech">
            Built on Stellar Protocol 25 · Groth16 · BN254 · Poseidon
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
    .game-zk-rail {
        border-radius: 12px;
        border: 1px solid rgba(94, 234, 212, 0.25);
        background: rgba(8, 47, 73, 0.25);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .game-zk-title {
        margin: 0;
        font-size: 11px;
        color: #ccfbf1;
    }
    .game-zk-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .game-super-paths {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .game-super-path {
        font-size: 9px;
        border-radius: 999px;
        padding: 3px 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #334155;
        background: rgba(248, 250, 252, 0.72);
    }
    .game-super-path--live {
        border-color: rgba(22, 163, 74, 0.45);
        color: #166534;
        background: rgba(187, 247, 208, 0.8);
    }
    .game-super-path--ops {
        border-color: rgba(202, 138, 4, 0.45);
        color: #854d0e;
        background: rgba(254, 240, 138, 0.78);
    }
    .game-zk-tag {
        font-size: 9px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(20, 184, 166, 0.2);
        border: 1px solid rgba(45, 212, 191, 0.3);
        color: #5eead4;
        word-break: break-word;
    }
    .game-zk-tag--soft {
        background: rgba(15, 23, 42, 0.7);
        border-color: rgba(148, 163, 184, 0.35);
        color: #cbd5e1;
    }
    .game-zk-meta {
        margin: 0;
        font-size: 10px;
        color: #94a3b8;
    }
    .game-surface {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 14px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .game-tip {
        font-size: 11px;
        color: #a5b4fc;
        margin: 0;
    }
    .game-chip {
        align-self: flex-start;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(94, 234, 212, 0.3);
        background: rgba(94, 234, 212, 0.12);
        color: #befae4;
        font-size: 10px;
        letter-spacing: 0.2px;
    }
    .tic-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
    }
    .tic-cell {
        aspect-ratio: 1;
        border-radius: 12px;
        border: 1px dashed rgba(148, 163, 184, 0.5);
        background: rgba(15, 23, 42, 0.7);
        color: #e2e8f0;
        font-size: 22px;
        font-weight: 700;
        display: grid;
        place-items: center;
        cursor: pointer;
        transition:
            transform 0.12s ease,
            border-color 0.12s ease,
            background 0.12s ease;
    }
    .tic-cell:hover {
        transform: translateY(-1px);
        border-color: rgba(154, 230, 0, 0.6);
    }
    .tic-player {
        color: #9ae600;
        border-color: rgba(154, 230, 0, 0.7);
        background: rgba(154, 230, 0, 0.08);
    }
    .tic-ai {
        color: #60a5fa;
        border-color: rgba(96, 165, 250, 0.6);
        background: rgba(37, 99, 235, 0.12);
    }
    .dodge-lanes {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
    }
    .dodge-lane {
        position: relative;
        height: 70px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.8);
        border: 1px dashed rgba(148, 163, 184, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #94a3b8;
        overflow: hidden;
    }
    .dodge-lane--ship {
        border-color: rgba(94, 234, 212, 0.7);
        box-shadow: 0 0 18px rgba(94, 234, 212, 0.3) inset;
        color: #e2e8f0;
    }
    .dodge-lane--hazard::after {
        content: "✦";
        position: absolute;
        font-size: 22px;
        color: #f87171;
        opacity: 0.9;
    }
    .lane-label {
        font-size: 11px;
        letter-spacing: 0.2px;
    }
    .dodge-hud {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
    }
    .dodge-controls {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .pattern-preview {
        display: flex;
        gap: 6px;
        justify-content: center;
    }
    .pattern-dot {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.7);
        color: #475569;
        display: grid;
        place-items: center;
        font-size: 12px;
        font-weight: 700;
    }
    .pattern-dot--on {
        border-color: rgba(154, 230, 0, 0.55);
        color: #9ae600;
        box-shadow: 0 0 14px rgba(154, 230, 0, 0.35);
    }
    .pattern-dot--miss {
        border-color: rgba(248, 113, 113, 0.8);
        color: #f87171;
        box-shadow: 0 0 12px rgba(248, 113, 113, 0.4);
    }
    .pattern-pads {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }
    .pattern-pad {
        padding: 10px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.8);
        color: #e2e8f0;
        font-size: 12px;
        cursor: pointer;
        transition:
            transform 0.12s ease,
            box-shadow 0.12s ease,
            border-color 0.12s ease;
    }
    .pattern-pad:hover {
        transform: translateY(-1px);
        border-color: rgba(154, 230, 0, 0.4);
    }
    .pattern-pad--pulse {
        box-shadow: 0 0 18px rgba(154, 230, 0, 0.3);
        border-color: rgba(154, 230, 0, 0.6);
    }
    .tone-gold {
        background: linear-gradient(135deg, #fbbf24, #f59e0b);
    }
    .tone-jade {
        background: linear-gradient(135deg, #22c55e, #10b981);
    }
    .tone-violet {
        background: linear-gradient(135deg, #a855f7, #7c3aed);
    }
    .tone-cobalt {
        background: linear-gradient(135deg, #38bdf8, #0ea5e9);
    }
    .tone-gold,
    .tone-jade,
    .tone-violet,
    .tone-cobalt {
        color: #0b1220;
        border: none;
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
    .game-proof-actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
    }
    .game-copy-btn.ghost {
        border-color: rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.85);
        color: #cbd5e1;
    }
    .game-copy-btn.primary {
        border-color: rgba(154, 230, 0, 0.45);
        background: linear-gradient(135deg, #bef264, #4ade80);
        color: #0a0f1a;
        font-weight: 600;
    }
    .game-copy-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .game-proof-note {
        margin: 0;
        font-size: 10px;
        color: #bbf7d0;
    }
    .game-proof-note--pass {
        color: #bbf7d0;
    }
    .game-proof-note--fail {
        color: #fecaca;
    }
    .game-verifier-payload {
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.85);
        padding: 10px;
    }
    .game-verifier-payload summary {
        cursor: pointer;
        font-size: 10px;
        color: #93c5fd;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .game-verifier-payload pre {
        margin: 8px 0 0;
        max-height: 180px;
        overflow: auto;
        font-size: 10px;
        line-height: 1.35;
        color: #cbd5e1;
    }

    .verifier-section {
        margin-top: 10px;
    }
    .verifier-card {
        background: rgba(9, 15, 28, 0.88);
        border: 1px solid rgba(154, 230, 0, 0.2);
        border-radius: 18px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .verifier-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .verifier-status {
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .verifier-status--ready {
        color: #bef264;
        border: 1px solid rgba(190, 242, 100, 0.4);
        background: rgba(163, 230, 53, 0.15);
    }
    .verifier-status--pending {
        color: #facc15;
        border: 1px solid rgba(250, 204, 21, 0.38);
        background: rgba(161, 98, 7, 0.2);
    }
    .verifier-copy {
        margin: 0;
        font-size: 11px;
        line-height: 1.6;
        color: #cbd5e1;
    }
    .verifier-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }
    .verifier-item {
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px;
        background: rgba(2, 6, 23, 0.7);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .verifier-label {
        margin: 0;
        font-size: 9px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .verifier-value {
        margin: 0;
        font-size: 11px;
        color: #e2e8f0;
        word-break: break-word;
    }
    .verifier-env {
        margin: 0;
        font-size: 10px;
        color: #a7f3d0;
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
        .verifier-grid {
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

    /* ── Midnight Pixel Harvest Theme ── */
    .farm-root {
        --pixel-sky-950: #02030b;
        --pixel-sky-900: #070b1c;
        --pixel-sky-850: #0b1430;
        --pixel-ink-100: #f2f7ff;
        --pixel-ink-300: #b7c4df;
        --pixel-ink-500: #7d8bab;
        --pixel-neon-mint: #8ff76b;
        --pixel-neon-amber: #ffd86b;
        --pixel-neon-cyan: #6be4ff;
        --pixel-panel-top: rgba(24, 31, 50, 0.9);
        --pixel-panel-bottom: rgba(10, 13, 24, 0.9);
        --pixel-border: rgba(143, 247, 107, 0.38);
        --pixel-border-soft: rgba(119, 137, 170, 0.42);
        --pixel-font-heading: "Press Start 2P", monospace;
        --pixel-font-body:
            "Space Mono",
            "IBM Plex Mono",
            "JetBrains Mono",
            monospace;
        color: var(--pixel-ink-100);
        font-family: var(--pixel-font-body);
        background:
            radial-gradient(
                circle at 13% 11%,
                rgba(254, 233, 152, 0.2) 0,
                rgba(254, 233, 152, 0) 30%
            ),
            radial-gradient(
                circle at 86% 15%,
                rgba(128, 224, 255, 0.16) 0,
                rgba(128, 224, 255, 0) 32%
            ),
            linear-gradient(
                180deg,
                var(--pixel-sky-950) 0%,
                var(--pixel-sky-900) 38%,
                var(--pixel-sky-850) 68%,
                #05101f 100%
            );
        animation: night-drift 24s ease-in-out infinite;
    }
    @keyframes night-drift {
        0%,
        100% {
            background-position: 0% 0%;
        }
        50% {
            background-position: 100% 24%;
        }
    }
    .farm-root::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        opacity: 0.78;
        background:
            radial-gradient(
                circle at 72% 13%,
                rgba(255, 248, 191, 0.92) 0 5px,
                rgba(255, 248, 191, 0) 8px
            ),
            radial-gradient(
                circle at 14% 22%,
                rgba(255, 255, 255, 0.5) 0 1px,
                transparent 2px
            ),
            radial-gradient(
                circle at 31% 36%,
                rgba(107, 228, 255, 0.42) 0 1px,
                transparent 2px
            ),
            radial-gradient(
                circle at 47% 18%,
                rgba(255, 255, 255, 0.45) 0 1px,
                transparent 2px
            ),
            radial-gradient(
                circle at 63% 42%,
                rgba(255, 255, 255, 0.32) 0 1px,
                transparent 2px
            ),
            radial-gradient(
                circle at 88% 29%,
                rgba(107, 228, 255, 0.45) 0 1px,
                transparent 2px
            );
        background-size:
            auto,
            320px 320px,
            320px 320px,
            300px 300px,
            360px 360px,
            320px 320px;
        animation: starlight 9s steps(6) infinite;
    }
    @keyframes starlight {
        0%,
        100% {
            opacity: 0.66;
        }
        40% {
            opacity: 0.8;
        }
        70% {
            opacity: 0.56;
        }
    }
    .farm-root::after {
        content: "";
        position: fixed;
        inset: auto 0 0 0;
        height: 36vh;
        pointer-events: none;
        z-index: 0;
        background:
            linear-gradient(
                180deg,
                rgba(9, 18, 32, 0) 0%,
                rgba(12, 31, 22, 0.2) 22%,
                rgba(5, 16, 12, 0.86) 100%
            ),
            repeating-linear-gradient(
                90deg,
                rgba(83, 142, 67, 0.16) 0 18px,
                rgba(61, 109, 52, 0.18) 18px 36px
            ),
            linear-gradient(
                180deg,
                rgba(107, 181, 79, 0.1) 0%,
                rgba(56, 102, 45, 0.54) 44%,
                rgba(28, 58, 25, 0.96) 100%
            );
        box-shadow:
            0 -20px 0 rgba(18, 33, 59, 0.42),
            0 -30px 0 rgba(6, 11, 22, 0.7);
    }
    .particles .particle {
        width: 2px;
        height: 2px;
        border-radius: 0;
        background: rgba(143, 247, 107, 0.32);
        box-shadow: 0 0 6px rgba(143, 247, 107, 0.5);
    }
    .farm-content {
        max-width: 1120px;
        padding: 80px 24px 120px;
        gap: 24px;
    }
    .farm-header,
    .proof-card,
    .game-card,
    .verifier-card,
    .gallery-card,
    .concept-card {
        background:
            linear-gradient(
                180deg,
                var(--pixel-panel-top) 0%,
                var(--pixel-panel-bottom) 100%
            ),
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.02) 0 2px,
                rgba(255, 255, 255, 0) 2px 4px
            );
        border: 2px solid var(--pixel-border-soft);
        border-radius: 6px;
        box-shadow:
            inset 0 0 0 2px rgba(5, 8, 16, 0.75),
            0 18px 30px rgba(0, 0, 0, 0.46);
        backdrop-filter: blur(8px);
    }
    .farm-header {
        border-color: var(--pixel-border);
        padding: 22px 20px;
    }
    .title-the,
    .farm-subtitle,
    .farm-tag,
    .section-label,
    .concepts-label,
    .game-wallet,
    .footer-tech,
    .verifier-status,
    .game-level,
    .gallery-subtitle {
        font-family: var(--pixel-font-heading);
    }
    .title-the {
        color: #7f92bd;
        letter-spacing: 3px;
    }
    .title-farm {
        color: #b6ff7a;
        text-shadow:
            0 0 0 #b6ff7a,
            0 0 14px rgba(143, 247, 107, 0.34);
        filter: none;
    }
    .farm-subtitle {
        color: #9db2db;
        font-size: 9px;
        letter-spacing: 2px;
    }
    .farm-tag {
        color: #d8ffe0;
        background: rgba(43, 115, 70, 0.45);
        border: 2px solid rgba(143, 247, 107, 0.48);
        border-radius: 4px;
        padding: 5px 10px;
        text-transform: uppercase;
    }
    .proof-card,
    .verifier-card {
        border-radius: 8px;
    }
    .proof-done-label {
        color: #9bffb7;
    }
    .proof-nudge {
        color: var(--pixel-ink-300);
    }
    .proof-error,
    .game-error {
        color: #ffd8d8;
        background: rgba(99, 31, 31, 0.62);
        border: 2px solid rgba(248, 113, 113, 0.55);
        border-radius: 4px;
        padding: 8px 10px;
    }
    .proof-btn,
    .proof-generate,
    .game-action-btn,
    .game-copy-btn,
    .gallery-cta,
    .gallery-open,
    .gallery-close {
        font-family: var(--pixel-font-heading);
        border: 2px solid #5b6b93;
        border-radius: 4px;
        background: linear-gradient(180deg, #27395f 0%, #172442 100%);
        color: var(--pixel-ink-100);
        box-shadow:
            inset 0 -3px 0 rgba(7, 12, 24, 0.9),
            0 6px 0 rgba(5, 8, 16, 0.72);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }
    .proof-btn:hover,
    .proof-generate:hover,
    .game-action-btn:hover,
    .game-copy-btn:hover,
    .gallery-cta:hover:enabled,
    .gallery-open:hover,
    .gallery-close:hover {
        transform: translateY(-2px);
        border-color: #95a9da;
    }
    .proof-btn.primary,
    .proof-generate,
    .game-action-btn.primary,
    .game-copy-btn.primary,
    .gallery-cta {
        background: linear-gradient(180deg, #c9ff76 0%, #82dd50 100%);
        color: #132217;
        border-color: #74bf4c;
        box-shadow:
            inset 0 -3px 0 rgba(43, 78, 28, 0.76),
            0 6px 0 rgba(4, 9, 18, 0.68),
            0 0 16px rgba(143, 247, 107, 0.34);
    }
    .game-action-btn.ghost,
    .game-copy-btn.ghost {
        background: linear-gradient(180deg, #1d2a49 0%, #141e35 100%);
        color: #d6dff1;
        border-color: #536283;
    }
    .game-section {
        margin-top: 10px;
    }
    .game-header {
        background: rgba(14, 22, 40, 0.86);
        border: 2px solid rgba(109, 126, 165, 0.5);
        border-radius: 6px;
        padding: 14px 16px;
    }
    .section-label {
        color: #c7ff8f;
    }
    .game-subtitle {
        color: #b8c7e3;
        font-size: 12px;
    }
    .game-wallet {
        color: #82ffd6;
        font-size: 8px;
    }
    .game-grid {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 16px;
    }
    .game-card {
        border-radius: 6px;
        border-color: color-mix(
            in srgb,
            var(--accent, var(--pixel-neon-cyan)) 40%,
            #64749b
        );
    }
    .game-card::before {
        background: radial-gradient(
            circle at top,
            color-mix(
                in srgb,
                var(--accent, var(--pixel-neon-cyan)) 22%,
                transparent
            ),
            transparent 70%
        );
    }
    .game-title {
        color: #ecf3ff;
        font-family: var(--pixel-font-heading);
        font-size: 12px;
        letter-spacing: 0.02em;
    }
    .game-summary,
    .game-goal,
    .game-progress-top,
    .game-progress-meta,
    .game-zk-meta,
    .game-tip {
        color: #adbcda;
        font-family: var(--pixel-font-body);
    }
    .game-level {
        background: rgba(24, 40, 72, 0.74);
        border: 2px solid rgba(109, 185, 255, 0.5);
        border-radius: 4px;
        color: #8fd9ff;
        padding: 6px 8px;
    }
    .game-zk-rail {
        background: rgba(8, 22, 40, 0.78);
        border: 2px solid rgba(72, 130, 168, 0.44);
        border-radius: 6px;
    }
    .game-zk-title {
        color: #9cf7ff;
        font-family: var(--pixel-font-heading);
        font-size: 8px;
    }
    .game-super-path {
        color: #d7e3fa;
        background: rgba(16, 24, 46, 0.86);
        border: 1px solid rgba(128, 142, 180, 0.45);
    }
    .game-super-path--live {
        border-color: rgba(115, 255, 158, 0.7);
        color: #9fffbf;
        background: rgba(20, 76, 45, 0.52);
    }
    .game-super-path--ops {
        border-color: rgba(255, 216, 107, 0.66);
        color: #ffe6a2;
        background: rgba(96, 69, 17, 0.55);
    }
    .game-zk-tag {
        background: rgba(16, 62, 70, 0.55);
        border: 1px solid rgba(80, 200, 210, 0.55);
        color: #9de8ef;
    }
    .game-zk-tag--soft {
        background: rgba(20, 26, 44, 0.8);
        border-color: rgba(137, 150, 179, 0.4);
        color: #ccd5ea;
    }
    .game-surface {
        background: rgba(10, 17, 33, 0.82);
        border: 2px solid rgba(93, 109, 143, 0.42);
        border-radius: 6px;
    }
    .tic-cell,
    .dodge-lane,
    .pattern-dot,
    .pattern-pad {
        border-radius: 3px;
        border: 2px solid rgba(110, 126, 163, 0.45);
        background: rgba(13, 23, 44, 0.9);
        box-shadow: inset 0 -3px 0 rgba(6, 10, 21, 0.85);
    }
    .tic-cell {
        font-family: var(--pixel-font-heading);
        font-size: 18px;
    }
    .dodge-lane {
        background:
            repeating-linear-gradient(
                180deg,
                rgba(36, 47, 75, 0.7) 0 9px,
                rgba(21, 30, 52, 0.7) 9px 18px
            ),
            rgba(11, 17, 33, 0.84);
    }
    .pattern-dot {
        font-family: var(--pixel-font-heading);
        font-size: 8px;
    }
    .pattern-pad {
        font-family: var(--pixel-font-heading);
        font-size: 8px;
    }
    .tone-gold {
        background: linear-gradient(180deg, #ffe07d 0%, #de9d2f 100%);
        color: #3f2600;
    }
    .tone-jade {
        background: linear-gradient(180deg, #89ffaa 0%, #2fbb66 100%);
        color: #092a14;
    }
    .tone-violet {
        background: linear-gradient(180deg, #d7adff 0%, #8655d9 100%);
        color: #220941;
    }
    .tone-cobalt {
        background: linear-gradient(180deg, #9fd7ff 0%, #3d90da 100%);
        color: #051f38;
    }
    .game-progress-bar {
        border-radius: 3px;
        height: 8px;
        background:
            repeating-linear-gradient(
                90deg,
                rgba(99, 112, 146, 0.34) 0 8px,
                rgba(72, 86, 114, 0.34) 8px 16px
            ),
            rgba(33, 45, 68, 0.78);
        border: 1px solid rgba(119, 134, 174, 0.36);
    }
    .game-progress-fill {
        border-radius: 2px;
        background:
            repeating-linear-gradient(
                90deg,
                rgba(214, 255, 123, 0.95) 0 10px,
                rgba(140, 224, 91, 0.95) 10px 20px
            ),
            linear-gradient(90deg, #bbff77, #60ce6f);
    }
    .game-proof {
        background: rgba(9, 16, 30, 0.84);
        border: 2px solid rgba(104, 122, 160, 0.4);
        border-radius: 6px;
    }
    .game-proof-label {
        color: #95a7ce;
    }
    .game-proof-value {
        color: #dfe8ff;
    }
    .game-proof-note {
        font-size: 10px;
    }
    .game-verifier-payload {
        background: rgba(9, 14, 27, 0.9);
        border: 2px solid rgba(87, 105, 140, 0.46);
        border-radius: 6px;
    }
    .game-verifier-payload summary {
        color: #8fd9ff;
    }
    .game-verifier-payload pre {
        color: #d4def3;
    }
    .verifier-card {
        border-color: rgba(143, 247, 107, 0.38);
    }
    .verifier-label {
        color: #94aad6;
    }
    .verifier-item {
        background: rgba(8, 16, 31, 0.85);
        border: 2px solid rgba(96, 113, 146, 0.38);
        border-radius: 6px;
    }
    .verifier-value {
        color: #e4ecff;
    }
    .verifier-copy,
    .verifier-env {
        color: #b7c7e4;
    }
    .verifier-copy code {
        color: #d8f4ff;
        background: rgba(37, 69, 102, 0.58);
        border: 1px solid rgba(107, 178, 221, 0.5);
        border-radius: 3px;
        padding: 1px 4px;
    }
    .gallery-card {
        border-color: rgba(98, 112, 146, 0.48);
        border-radius: 6px;
    }
    .gallery-title {
        color: #dce7ff;
        font-family: var(--pixel-font-heading);
        font-size: 10px;
    }
    .gallery-summary {
        color: #9fb0cf;
        font-family: var(--pixel-font-body);
    }
    .farm-footer {
        border-top: 2px solid rgba(96, 113, 145, 0.44);
    }
    .footer-tech {
        color: #b4ff7c;
    }
    .footer-links,
    .footer-links a {
        color: #a7b7d6;
    }
    .footer-links a:hover {
        color: #d8ffe5;
    }
    @media (max-width: 860px) {
        .farm-content {
            padding: 74px 16px 104px;
        }
        .farm-header {
            padding: 18px 14px;
        }
        .game-grid {
            grid-template-columns: 1fr;
        }
        .game-proof-actions {
            grid-template-columns: 1fr;
        }
    }
</style>
