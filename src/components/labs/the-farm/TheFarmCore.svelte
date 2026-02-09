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
    import {
        HACKATHON_TOOLCHAIN_TRACKS,
        formatToolchainRunbook,
        type ToolchainTrack,
        type ToolchainTrackId,
    } from "./zkToolchains";

    // ── State ──────────────────────────────────────────────────────────────
    let proving = $state(false);
    let error = $state<string | null>(null);
    let copied = $state(false);
    let earned = $state<Record<string, EarnedBadge>>({});
    let audioOn = $state(false);
    let mounted = $state(false);
    let activeProof = $state<GalleryProof | null>(null);
    let showCelebration = $state(false);
    let celebrationTitle = $state("Protocol spell complete");
    let celebrationBody = $state(
        "Proof flow executed. Super Verifier payload is ready.",
    );
    let gameProofs = $state<Record<string, ZkGameProof>>({});
    let gameError = $state<string | null>(null);
    let gameCopied = $state<string | null>(null);
    let gameForging = $state<string | null>(null);
    let gameAttesting = $state<string | null>(null);
    let gameOneClickCasting = $state<string | null>(null);
    let showArcadeGuide = $state(false);
    let activeToolchainTrack = $state<ToolchainTrackId>("noir-ultrahonk");
    let copiedToolchainTrack = $state<ToolchainTrackId | null>(null);
    let gamePayloadCopied = $state<string | null>(null);
    let gameAttestNotes = $state<Record<string, string>>({});
    let gameVerifierPayloads = $state<Record<string, string>>({});
    let gameIntegrity = $state<Record<string, GameIntegrityState>>({});
    let gameWallet = $state<string | null>(null);
    let verifying = $state(false);
    let oneClickVerifying = $state(false);
    let toolchainVerifying = $state<ToolchainTrackId | null>(null);
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
        onchainMode: "tier-compat-v1";
        contractId: string;
        verifierEntrypoint: string;
        gameId: string;
        wallet: string;
        level: number;
        score: number;
        compatTierHint: number;
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
    let toolchainCopyTimer: number | null = null;

    // 4 focused proofs: 1 live + 3 protocol modules
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
                "Private mint-activity attestation module backed by proof packet + Super Verifier rail.",
            proof: "Merkle activity module (attestation-ready)",
            circuit: "module: melody_mint.v1",
            status: "READY",
            file: "/proofs/smol-melody-mint.json",
            wallet: "Your connected wallet",
            tags: ["nft", "merkle", "privacy"],
            tested: "Verifier module ready",
            inputs: ["mint root", "leaf proofs", "mint count threshold"],
            outputs: ["threshold met flag", "root valid flag"],
            note: "Configured as a private mint attestation module for verifier-payload workflows.",
            requiresKale: false,
            requirementCopy: "Accessible in advanced payload workflows.",
        },
        {
            id: "mixtape-seal",
            title: "Mixtape Seal",
            summary:
                "Private curation attestation module with commitment-chain semantics and exportable verifier payloads.",
            proof: "Commitment-chain curation module",
            circuit: "module: mixtape_seal.v1",
            status: "READY",
            file: "/proofs/smol-mixtape-seal.json",
            wallet: "Your connected wallet",
            tags: ["curation", "commitment", "privacy"],
            tested: "Verifier module ready",
            inputs: ["mixtape hash", "track count", "curator address"],
            outputs: ["curator attestation", "track threshold flag"],
            note: "Configured for private curation attestations using the same contract-side rails.",
            requiresKale: false,
            requirementCopy: "Accessible in advanced payload workflows.",
        },
        {
            id: "first-listen",
            title: "First Listen",
            summary:
                "Private listening-attestation module using nullifier semantics and Super Verifier submission rails.",
            proof: "Nullifier activity module (attestation-ready)",
            circuit: "module: first_listen.v1",
            status: "READY",
            file: "/proofs/smol-first-listen.json",
            wallet: "Your connected wallet",
            tags: ["streaming", "nullifier", "privacy"],
            tested: "Verifier module ready",
            inputs: ["play nullifiers", "threshold", "listener address"],
            outputs: ["listener attestation", "play count valid"],
            note: "Configured for private listen-count attestations without exposing track-level history.",
            requiresKale: false,
            requirementCopy: "Accessible in advanced payload workflows.",
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
    let selectedToolchainTrack = $derived(
        HACKATHON_TOOLCHAIN_TRACKS.find(
            (track) => track.id === activeToolchainTrack,
        ) ?? HACKATHON_TOOLCHAIN_TRACKS[0],
    );
    const confettiPieces = Array.from({ length: 24 }, (_, idx) => idx);
    const GAME_TIER_THRESHOLDS = [
        0n,
        1_000_000_000n,
        10_000_000_000n,
        100_000_000_000n,
    ];
    const GAME_TIER_BY_KIND: Record<ZkGame["kind"], number> = {
        tic: 1,
        dodge: 2,
        pattern: 3,
    };

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
            if (toolchainCopyTimer) {
                clearTimeout(toolchainCopyTimer);
                toolchainCopyTimer = null;
            }
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
            launchCelebration(
                "Proof forged",
                "Tier commitment is generated and ready for on-chain verification.",
            );
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
                launchCelebration(
                    "Super Verifier accepted",
                    "Your KALE tier proof is now attested on Stellar mainnet.",
                );
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

    async function runOneClickProofFlow() {
        if (!isAuth || !userState.contractId) {
            error = "Connect wallet first to run one-click on-chain verification.";
            return;
        }
        if (oneClickVerifying || proving || verifying) return;

        oneClickVerifying = true;
        try {
            if (!earned["proof-of-farm"]?.data?.proof) {
                await generateProof();
            }

            if (!earned["proof-of-farm"]?.data?.proof) {
                throw new Error("Proof could not be generated. Please retry.");
            }

            if (!onChainVerified) {
                await verifyProof();
            } else {
                launchCelebration(
                    "Already verified",
                    "Your wallet already has a live Super Verifier attestation.",
                );
            }
        } catch (e: any) {
            error = e?.message || "One-click on-chain verification failed";
        } finally {
            oneClickVerifying = false;
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

    function launchCelebration(title: string, body: string) {
        celebrationTitle = title;
        celebrationBody = body;
        showCelebration = true;
        playChime();
        setTimeout(() => {
            showCelebration = false;
        }, 2400);
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

    function bigintToBytes32(value: bigint | string): Uint8Array {
        let input = BigInt(value);
        const bytes = new Uint8Array(32);
        for (let i = 31; i >= 0; i--) {
            bytes[i] = Number(input & 0xffn);
            input >>= 8n;
        }
        return bytes;
    }

    async function buildGameTierCompatWitness(game: ZkGameSession): Promise<{
        tierId: number;
        balanceMetric: bigint;
        salt: bigint;
        addressHash: bigint;
    }> {
        if (!game.proof) {
            throw new Error("Seal a game commitment before on-chain submit.");
        }
        if (!zkLogic) {
            throw new Error("ZK logic not loaded yet.");
        }
        if (!userState.contractId) {
            throw new Error("Connect wallet before on-chain submit.");
        }

        const tierId = GAME_TIER_BY_KIND[game.kind] ?? 0;
        const threshold = GAME_TIER_THRESHOLDS[tierId] ?? 0n;
        const actionHashNibble = BigInt(`0x${game.proof.actionHash.slice(0, 14)}`);
        const scoreComponent = BigInt(Math.max(game.proof.score, 0)) * 10_000_000n;
        const levelComponent = BigInt(Math.max(game.proof.level, 0)) * 1_000_000n;
        const nonceComponent = actionHashNibble % 1_000_000n;
        const balanceMetric =
            threshold + scoreComponent + levelComponent + nonceComponent;
        const saltSeed =
            BigInt(game.proof.salt) ^ actionHashNibble ^ BigInt(game.proof.level);
        const salt = saltSeed > 0n ? saltSeed : -saltSeed + 1n;
        const addressHash = await zkLogic.hashAddress(userState.contractId);

        return {
            tierId,
            balanceMetric,
            salt,
            addressHash,
        };
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
            onchainMode: "tier-compat-v1",
            contractId: SUPER_VERIFIER_CONTRACT_ID,
            verifierEntrypoint: game.zkSpec.verifierEntrypoint,
            gameId: game.proof.id,
            wallet: game.proof.wallet,
            level: game.proof.level,
            score: game.proof.score,
            compatTierHint: GAME_TIER_BY_KIND[game.kind] ?? 0,
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
            const existingTx = game.proof?.onchainTxHash;
            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    existingTx
                        ? `Verifier payload copied. This run is already attested on-chain (TX ${existingTx.slice(
                            0,
                            10,
                        )}...).`
                        : "Verifier payload copied. Submit on-chain to execute verify_and_attest for this run.",
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

    function selectToolchainTrack(trackId: ToolchainTrackId) {
        activeToolchainTrack = trackId;
    }

    function pickArcadeOnchainTarget(): ZkGameSession | null {
        if (!zkGames.length) return null;
        return (
            zkGames.find((game) => !game.proof?.onchainTxHash) ??
            zkGames[0] ??
            null
        );
    }

    async function runToolchainOnchainVerify(track: ToolchainTrack) {
        if (toolchainVerifying || gameAttesting || oneClickVerifying) return;
        if (!isAuth || !userState.contractId) {
            const message =
                "Connect wallet first to execute on-chain verification.";
            error = message;
            gameError = message;
            return;
        }

        toolchainVerifying = track.id;
        try {
            if (track.onchainFlow === "kale") {
                await runOneClickProofFlow();
                if (!onChainVerified) {
                    throw new Error(
                        error ||
                            "Kale verifier rail did not complete on-chain.",
                    );
                }
                return;
            }

            const target = pickArcadeOnchainTarget();
            if (!target) {
                throw new Error("No arcade game session is available.");
            }

            await runGameOneClickFlow(target);
            const refreshed = getGameSession(target.id);
            if (!refreshed?.proof?.onchainTxHash) {
                throw new Error(
                    gameError ||
                        "Arcade verifier rail did not complete on-chain.",
                );
            }
        } catch (e: any) {
            gameError = e?.message || "Toolchain on-chain verification failed";
        } finally {
            toolchainVerifying = null;
        }
    }

    async function copyToolchainRunbook(track: ToolchainTrack) {
        try {
            await navigator.clipboard.writeText(formatToolchainRunbook(track));
            copiedToolchainTrack = track.id;
            if (toolchainCopyTimer) {
                clearTimeout(toolchainCopyTimer);
            }
            toolchainCopyTimer = window.setTimeout(() => {
                if (copiedToolchainTrack === track.id) {
                    copiedToolchainTrack = null;
                }
                toolchainCopyTimer = null;
            }, 2000);
        } catch (e: any) {
            gameError = e?.message || "Unable to copy toolchain runbook";
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

    function completeRunWithAutoPlay(game: ZkGameSession) {
        const requirement = getRequirement(game);
        if (game.kind === "tic") {
            const moveLog = ["X-0", "O-3", "X-1", "O-4", "X-2"];
            ticState = {
                board: ["X", "X", "X", "O", "O", null, null, null, null],
                turn: "player",
                finished: true,
                winner: "player",
                message: "Autoplay line executed. Commitment ready.",
                moveLog,
            };
            completeRun(game, moveLog, 24);
            return;
        }

        if (game.kind === "dodge") {
            const hazards = Array.from({ length: requirement }, (_, idx) =>
                (idx + 1) % 3,
            );
            const moveLog = Array.from(
                { length: requirement },
                (_, idx) => `step-${idx + 1}:lane-${idx % 3}:hazard-${hazards[idx]}`,
            );
            dodgeState = {
                lane: 1,
                hazards,
                step: requirement,
                status: "cleared",
                lastHazard: hazards[hazards.length - 1] ?? 0,
                moveLog,
            };
            completeRun(game, moveLog, 18);
            return;
        }

        const tones = ["gold", "jade", "violet", "cobalt"];
        const pattern = Array.from(
            { length: requirement },
            (_, idx) => tones[idx % tones.length],
        );
        const moveLog = pattern.map((tone, idx) => `beat-${idx + 1}-${tone}`);
        patternState = {
            pattern,
            input: [...pattern],
            stage: "success",
            showPreview: false,
            moveLog,
        };
        completeRun(game, moveLog, 22);
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
                    "Commitment sealed. Ready for on-chain submit via Super Verifier.",
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

    async function runGameOneClickFlow(game: ZkGameSession) {
        if (gameOneClickCasting) return;
        gameError = null;
        gameOneClickCasting = game.id;

        try {
            let current = getGameSession(game.id) ?? game;
            if (!current.proof && current.status !== "complete") {
                startGameRun(current);
                current = getGameSession(game.id) ?? current;
                completeRunWithAutoPlay(current);
                current = getGameSession(game.id) ?? current;
            }

            if (!current.proof && current.status === "complete") {
                await forgeGameProof(current);
                current = getGameSession(game.id) ?? current;
            }

            if (!current.proof) {
                throw new Error("One-click flow could not seal this run. Try once more.");
            }

            await submitGameAttestation(current);
            await copyVerifierPayload(current);
            const submitted = getGameSession(current.id)?.proof?.onchainTxHash;

            gameAttestNotes = {
                ...gameAttestNotes,
                [current.id]:
                    submitted
                        ? `One-click flow complete: run sealed and submitted on-chain (${submitted.slice(0, 10)}...).`
                        : "One-click flow complete: run sealed and payload staged.",
            };
            launchCelebration(
                `${current.title} complete`,
                submitted
                    ? "Arcade proof pipeline ran end-to-end and landed on Super Verifier."
                    : "Arcade proof pipeline prepared verifier payloads.",
            );
        } catch (e: any) {
            gameError = e?.message || "One-click flow failed";
        } finally {
            gameOneClickCasting = null;
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

    async function submitGameAttestation(game: ZkGameSession) {
        if (!game.proof) return;
        gameError = null;
        gameAttesting = game.id;

        try {
            if (!zkLogic) {
                throw new Error("ZK logic not loaded yet.");
            }
            if (!zkGamesLogic) {
                throw new Error("Game logic not loaded yet.");
            }
            if (!userState.contractId || !isAuth) {
                throw new Error("Connect wallet before on-chain submit.");
            }

            await verifyGameProofLocally(game);
            const integrity = gameIntegrity[game.id];
            if (integrity?.state === "fail") {
                throw new Error(
                    "Local game proof integrity failed. Reset the run and seal again.",
                );
            }

            const { tierId, balanceMetric, salt, addressHash } =
                await buildGameTierCompatWitness(game);
            const generated = await zkLogic.generateTierProof(
                addressHash,
                balanceMetric,
                salt,
                tierId,
            );

            const isValid = await zkLogic.verifyProofLocally(
                generated.proof,
                generated.publicSignals,
            );
            if (!isValid) {
                throw new Error(
                    "Generated Groth16 proof failed local verification. Retry this run.",
                );
            }

            if (generated.publicSignals.length < 2) {
                throw new Error(
                    "Generated proof is missing public signals. Retry this run.",
                );
            }

            const tierSignal = BigInt(generated.publicSignals[0]);
            const commitmentSignal = BigInt(generated.publicSignals[1]);
            if (tierSignal !== BigInt(tierId)) {
                throw new Error(
                    "Tier/public signal mismatch in generated game proof.",
                );
            }

            const kit = await getPasskeyKit();
            if (!kit) {
                throw new Error("Wallet kit unavailable.");
            }

            const submitResult = await zkLogic.submitProofToContract(
                kit,
                userState.contractId,
                tierId,
                bigintToBytes32(commitmentSignal),
                generated.proof,
            );
            if (!submitResult.success || !submitResult.txHash) {
                throw new Error(
                    submitResult.error ||
                        "Super Verifier submit failed for this game run.",
                );
            }

            const updatedProof: ZkGameProof = {
                ...game.proof,
                onchainTxHash: submitResult.txHash,
                onchainTier: tierId,
                onchainCommitment: commitmentSignal.toString(),
                onchainSubmittedAt: Date.now(),
                onchainMode: "tier-compat-v1",
            };

            updateGame(game.id, { proof: updatedProof });
            if (gameWallet) {
                zkGamesLogic.saveGameProof(gameWallet, updatedProof);
                gameProofs = zkGamesLogic.loadGameProofs(gameWallet);
            }

            const payload = buildGameVerifierPayload(
                getGameSession(game.id) ?? { ...game, proof: updatedProof },
            );
            if (payload) {
                rememberVerifierPayload(game.id, payload);
            }

            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    `On-chain submit complete via Super Verifier (tier-compat-v1). TX ${submitResult.txHash.slice(
                        0,
                        10,
                    )}... ties this game run to a Groth16 attestation.`,
            };

            launchCelebration(
                `${game.title} attested`,
                "Super Verifier accepted this game run and stored a live on-chain attestation.",
            );
        } catch (e: any) {
            gameError = e?.message || "Unable to submit game attestation";
        } finally {
            gameAttesting = null;
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
            const walletConnected = !!(userState.contractId && isAuth);
            gameAttestNotes = {
                ...gameAttestNotes,
                [game.id]:
                    walletConnected
                        ? "Super Verifier payload staged. Use 'Submit on-chain' to execute verify_and_attest for this game."
                        : "Super Verifier payload staged. Connect wallet to submit this game on-chain.",
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

        {#if showCelebration}
            <section class="proof-celebration" aria-live="polite">
                <div class="proof-celebration-card">
                    <p class="proof-celebration-eyebrow">One-click verify</p>
                    <h3 class="proof-celebration-title">{celebrationTitle}</h3>
                    <p class="proof-celebration-body">{celebrationBody}</p>
                </div>
                <div class="proof-confetti" aria-hidden="true">
                    {#each confettiPieces as piece}
                        <span class="confetti" style={`--i:${piece}`}></span>
                    {/each}
                </div>
            </section>
        {/if}

        <div class="chapter-strip">
            <section class="chapter-panel chapter-kale">
                <div class="chapter-head">
                    <p class="chapter-tag">Chapter I</p>
                    <h2 class="chapter-title">Kale Proof Garden</h2>
                    <p class="chapter-copy">
                        Generate and attest your KALE tier proof with a cinematic,
                        protocol-first verification flow.
                    </p>
                </div>
                <div class="kale-cover" role="img" aria-label="Kale proof chapter cover art">
                    <div class="kale-cover-copy">
                        <p class="kale-cover-kicker">Groth16 · BN254 · Poseidon</p>
                        <p class="kale-cover-title">PROOF OF FARM</p>
                        <p class="kale-cover-body">
                            Confidential balance tiering with live Super Verifier attestation.
                        </p>
                    </div>
                    <div class="kale-cover-stamp">MAINNET</div>
                </div>
                <div class="kale-magic">
                    <button
                        class="kale-magic-btn"
                        type="button"
                        onclick={runOneClickProofFlow}
                        disabled={oneClickVerifying || proving || verifying || !isAuth}
                    >
                        {#if oneClickVerifying}
                            Verifying...
                        {:else if onChainVerified}
                            On-Chain Verified ✓
                        {:else}
                            One-Click On-Chain Verify
                        {/if}
                    </button>
                    <p class="kale-magic-copy">
                        One tap generates your proof (if needed), runs local checks, and
                        submits to the Super Verifier contract.
                    </p>
                </div>

                {#if !isAuth}
                    <div class="landing-cta">
                        <p class="landing-line">Harvest your KALE proof tier</p>
                        <p class="landing-line dim">without revealing your balance.</p>
                        <p class="landing-connect">
                            Connect your wallet to enter the valley
                        </p>
                    </div>
                {:else if loading && balance === null}
                    <div class="loading-state">
                        <div class="loading-spinner"></div>
                        <p class="loading-text">Reading your KALE balance...</p>
                    </div>
                {:else}
                    <section class="proof-section">
                        <div class="proof-card">
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
                                <div class="proof-loading">
                                    <div class="loading-spinner"></div>
                                    <p>Generating proof...</p>
                                </div>
                            {:else}
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

                    <section class="concepts-section">
                        <h2 class="concepts-label">Proof Modules</h2>
                        <div class="concepts-strip">
                            {#each galleryProofs.filter((p) => p.status !== "LIVE") as concept}
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
            </section>

            <section class="chapter-panel chapter-games">
                <div class="chapter-head">
                    <p class="chapter-tag">Chapter II</p>
                    <h2 class="chapter-title">Game Proofs Arcade</h2>
                    <p class="chapter-copy">
                        One-click verify flow seals gameplay transcripts into
                        proof-ready commitments, derives Groth16 witnesses, and
                        submits live attestations through Super Verifier.
                    </p>
                    <div class="arcade-guide-row">
                        <button
                            class="arcade-guide-btn"
                            type="button"
                            onclick={() => (showArcadeGuide = !showArcadeGuide)}
                        >
                            {showArcadeGuide
                                ? "Hide quick guide"
                                : "What did we build?"}
                        </button>
                        <p class="arcade-guide-mini">
                            Start with each card's One-Click Verify button. Manual controls
                            stay available for expert tuning and payload inspection.
                        </p>
                    </div>
                </div>
                {#if showArcadeGuide}
                    <div class="arcade-guide-card">
                        <p>
                            1. Every game run generates a deterministic transcript and
                            action hash.
                        </p>
                        <p>
                            2. We seal those values into a Poseidon commitment for proof
                            packets.
                        </p>
                        <p>
                            3. The payload is formatted for the live Super Verifier
                            contract interface, then submitted on-chain through
                            the same verify_and_attest entrypoint.
                        </p>
                    </div>
                {/if}
                <section class="game-section">
        <div class="game-header">
            <h2 class="section-label">ZK Arcade</h2>
            <p class="game-subtitle">
                Beat real mini-games to forge Poseidon commitments, then route
                verify_and_attest calls into the live Super Verifier contract.
            </p>
            <p class="game-subtitle">
                Arcade submit path uses a compatibility Groth16 witness derived
                from each sealed run while dedicated per-game circuits are in
                active development.
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
                        <details class="quiet-details game-zk-details">
                            <summary>Protocol details</summary>
                            <div class="quiet-details-body">
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
                        </details>
                    </div>
                    <div class="game-magic">
                        <button
                            class="game-magic-btn"
                            type="button"
                            onclick={() => runGameOneClickFlow(game)}
                            disabled={!!game.proof?.onchainTxHash ||
                                !isAuth ||
                                (!!gameOneClickCasting &&
                                    gameOneClickCasting !== game.id)}
                        >
                            {#if gameOneClickCasting === game.id}
                                Verifying...
                            {:else if game.proof?.onchainTxHash}
                                On-Chain Verified ✓
                            {:else if game.proof}
                                One-Click: Submit On-Chain
                            {:else}
                                One-Click: Auto Seal + Verify
                            {/if}
                        </button>
                        <p class="game-magic-copy">
                            {#if game.proof?.onchainTxHash}
                                This run is already attested on-chain. Re-run
                                one-click verify after sealing a fresh run.
                            {:else if !isAuth}
                                Connect wallet to run one-click on-chain
                                verification.
                            {:else if game.proof}
                                One click runs local integrity check, generates
                                Groth16 compatibility proof, and submits to
                                Super Verifier.
                            {:else}
                                Auto mode runs a clean demo path, seals
                                commitment, submits on-chain, and copies payload
                                data.
                            {/if}
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
                    <details class="quiet-details game-advanced-panel">
                        <summary>Advanced controls and payloads</summary>
                        <div class="quiet-details-body">
                            <p class="game-manual-label">Manual run controls</p>
                            <div class="game-actions game-actions--manual">
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
                                            onclick={() => submitGameAttestation(game)}
                                            disabled={gameAttesting === game.id ||
                                                !!game.proof.onchainTxHash}
                                        >
                                            {gameAttesting === game.id
                                                ? "Submitting..."
                                                : game.proof.onchainTxHash
                                                    ? "Submitted ✓"
                                                    : "Submit on-chain"}
                                        </button>
                                    </div>
                                    {#if game.proof.onchainTxHash}
                                        <a
                                            href={`https://stellar.expert/explorer/public/tx/${game.proof.onchainTxHash}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            class="proof-tx"
                                        >
                                            TX: {game.proof.onchainTxHash.slice(0, 8)}...{game.proof.onchainTxHash.slice(
                                                -8,
                                            )}
                                        </a>
                                    {/if}
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
                            {:else}
                                <p class="game-proof-note">
                                    Seal a run to unlock payload tools and detailed diagnostics.
                                </p>
                            {/if}
                        </div>
                    </details>
                </article>
            {/each}
        </div>
                </section>
            </section>

            <section class="chapter-panel chapter-dungeon">
                <div class="chapter-head">
                    <p class="chapter-tag">Chapter III</p>
                    <h2 class="chapter-title">ZK Dungeon</h2>
                    <p class="chapter-copy">
                        Next-level raid space for multi-stage zero-knowledge campaigns,
                        with evolving verifier keys and boss-grade attestations.
                    </p>
                </div>
                <div class="dungeon-teaser">
                    <p class="dungeon-overline">Teaser Realm</p>
                    <h3 class="dungeon-title">Protocol 25 Raid Gate</h3>
                    <p class="dungeon-copy">
                        Enter a cyber-ruin where each floor unlocks only after
                        deterministic proof checks. Build streaks, preserve privacy,
                        and clear boss circuits without exposing full strategy logs.
                    </p>
                    <div class="dungeon-tags">
                        <span>Boss Proof Chains</span>
                        <span>Nullifier Runs</span>
                        <span>Adaptive VKey Seasons</span>
                    </div>
                    <div class="dungeon-stats">
                        <div>
                            <p class="dungeon-stat-label">Sealed sessions</p>
                            <p class="dungeon-stat-value">{sealedGameCount}</p>
                        </div>
                        <div>
                            <p class="dungeon-stat-label">Verifier rails</p>
                            <p class="dungeon-stat-value">4 active rails</p>
                        </div>
                        <div>
                            <p class="dungeon-stat-label">Local passes</p>
                            <p class="dungeon-stat-value">{locallyVerifiedGameCount}</p>
                        </div>
                    </div>
                </div>

                <section class="toolchain-section">
                    <div class="toolchain-head">
                        <p class="toolchain-kicker">Hackathon Tracks</p>
                        <h3 class="toolchain-title">
                            Noir + zkVM implementation lanes
                        </h3>
                        <p class="toolchain-copy">
                            Real integration plans only. Each lane is mapped to
                            a concrete Stellar delivery path and a Super Verifier
                            settlement strategy.
                        </p>
                    </div>
                    <div class="toolchain-tabs">
                        {#each HACKATHON_TOOLCHAIN_TRACKS as track}
                            <button
                                type="button"
                                class={`toolchain-tab ${
                                    activeToolchainTrack === track.id
                                        ? "toolchain-tab--active"
                                        : ""
                                }`}
                                onclick={() => selectToolchainTrack(track.id)}
                            >
                                <span>{track.label}</span>
                                <small>{track.engine}</small>
                            </button>
                        {/each}
                    </div>
                    <article class="toolchain-card">
                        <div class="toolchain-top">
                            <p class="toolchain-status">
                                {selectedToolchainTrack.statusLabel}
                            </p>
                            <p class="toolchain-mode">
                                Super Verifier mode:
                                {selectedToolchainTrack.superVerifierMode}
                            </p>
                        </div>
                        <p class="toolchain-summary">
                            {selectedToolchainTrack.summary}
                        </p>
                        <p class="toolchain-path">
                            Stellar path: {selectedToolchainTrack.stellarPath}
                        </p>
                        <div class="toolchain-actions">
                            <button
                                class="arcade-guide-btn"
                                type="button"
                                onclick={() =>
                                    runToolchainOnchainVerify(
                                        selectedToolchainTrack,
                                    )}
                                disabled={toolchainVerifying ===
                                        selectedToolchainTrack.id ||
                                    oneClickVerifying ||
                                    !!gameAttesting ||
                                    !isAuth}
                            >
                                {#if toolchainVerifying === selectedToolchainTrack.id}
                                    Verifying on-chain...
                                {:else}
                                    {selectedToolchainTrack.onchainButton}
                                {/if}
                            </button>
                        </div>
                        <details class="quiet-details toolchain-deep-dive">
                            <summary>
                                Implementation checklist, references, and runbook
                            </summary>
                            <div class="quiet-details-body">
                                <div class="toolchain-grid">
                                    <div class="toolchain-column">
                                        <p class="toolchain-column-title">Learn</p>
                                        <ul>
                                            {#each selectedToolchainTrack.learningSteps as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ul>
                                    </div>
                                    <div class="toolchain-column">
                                        <p class="toolchain-column-title">Implement</p>
                                        <ul>
                                            {#each selectedToolchainTrack.implementationSteps as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ul>
                                    </div>
                                    <div class="toolchain-column">
                                        <p class="toolchain-column-title">Judge signals</p>
                                        <ul>
                                            {#each selectedToolchainTrack.judgeSignals as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ul>
                                    </div>
                                </div>
                                <div class="toolchain-links">
                                    {#each selectedToolchainTrack.references as reference}
                                        <a
                                            href={reference.href}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {reference.label}
                                        </a>
                                    {/each}
                                </div>
                                <div class="toolchain-actions toolchain-actions--secondary">
                                    <button
                                        class="arcade-guide-btn toolchain-copy-btn"
                                        type="button"
                                        onclick={() =>
                                            copyToolchainRunbook(selectedToolchainTrack)}
                                    >
                                        {#if copiedToolchainTrack === selectedToolchainTrack.id}
                                            Runbook copied
                                        {:else}
                                            Copy runbook
                                        {/if}
                                    </button>
                                </div>
                            </div>
                        </details>
                    </article>
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
                For Chapter I Kale proofs, <code>verify_and_attest</code> and
                <code>check_attestation</code> are live rails. Arcade now also
                submits on-chain through <code>verify_and_attest</code> using a
                Groth16 compatibility witness derived from each sealed run.
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
                Tier proofs and arcade submissions now both target this same
                contract. Kale uses native tier proof inputs; arcade uses the
                same Groth16 verifier in compatibility mode with
                game-derived witness metrics while dedicated game circuits are
                being finalized.
            </p>
        </div>
                </section>
            </section>
        </div>

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

    /* ── Chapter Menu Revamp ── */
    .farm-root {
        --panel-border: rgba(183, 199, 228, 0.26);
        --panel-surface: rgba(9, 16, 30, 0.82);
        --panel-shadow: 0 28px 58px rgba(2, 8, 20, 0.52);
    }
    .farm-content {
        max-width: min(1700px, 96vw);
        margin: 0 auto;
        padding: 72px 20px 92px;
    }
    .farm-header {
        margin-bottom: 14px;
    }
    .chapter-strip {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(360px, 1fr);
        gap: 18px;
        align-items: start;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 8px 2px 18px;
        scroll-snap-type: x mandatory;
        scrollbar-width: thin;
        scrollbar-color: rgba(177, 255, 109, 0.55) rgba(7, 14, 26, 0.8);
    }
    .chapter-strip::-webkit-scrollbar {
        height: 10px;
    }
    .chapter-strip::-webkit-scrollbar-track {
        background: rgba(7, 14, 26, 0.8);
        border-radius: 999px;
    }
    .chapter-strip::-webkit-scrollbar-thumb {
        background: linear-gradient(90deg, #72c765, #9fe55c);
        border-radius: 999px;
    }
    .chapter-panel {
        position: relative;
        min-height: clamp(760px, 88vh, 1120px);
        padding: 18px;
        border-radius: 20px;
        border: 1px solid var(--panel-border);
        background: var(--panel-surface);
        box-shadow: var(--panel-shadow);
        display: flex;
        flex-direction: column;
        gap: 14px;
        scroll-snap-align: start;
        overflow: hidden;
    }
    .chapter-panel::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.36;
        background:
            radial-gradient(
                100% 62% at 100% 0%,
                rgba(126, 211, 33, 0.14) 0%,
                rgba(126, 211, 33, 0) 68%
            ),
            repeating-linear-gradient(
                135deg,
                rgba(255, 255, 255, 0.07) 0 2px,
                rgba(255, 255, 255, 0) 2px 12px
            );
        mix-blend-mode: screen;
    }
    .chapter-panel > * {
        position: relative;
        z-index: 1;
    }
    .chapter-kale {
        background:
            radial-gradient(
                130% 76% at 18% 0%,
                rgba(121, 255, 85, 0.17),
                rgba(121, 255, 85, 0)
            ),
            rgba(9, 21, 13, 0.9);
        border-color: rgba(155, 255, 121, 0.34);
    }
    .chapter-games {
        background:
            radial-gradient(
                116% 72% at 50% 0%,
                rgba(92, 201, 255, 0.2),
                rgba(92, 201, 255, 0)
            ),
            rgba(10, 16, 32, 0.92);
        border-color: rgba(117, 217, 255, 0.34);
    }
    .chapter-dungeon {
        background:
            radial-gradient(
                140% 84% at 82% 0%,
                rgba(255, 120, 84, 0.2),
                rgba(255, 120, 84, 0)
            ),
            rgba(21, 12, 19, 0.92);
        border-color: rgba(255, 146, 118, 0.36);
    }
    .chapter-head {
        display: grid;
        gap: 6px;
    }
    .chapter-tag {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: #9ec2ff;
    }
    .chapter-title {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: clamp(16px, 1.8vw, 22px);
        letter-spacing: 1px;
        color: #f4f8ff;
        text-shadow: 0 8px 20px rgba(0, 0, 0, 0.42);
    }
    .chapter-copy {
        margin: 0;
        font-size: 12px;
        line-height: 1.6;
        color: #b7c7e4;
        max-width: 52ch;
    }
    .kale-cover {
        position: relative;
        border-radius: 14px;
        border: 1px solid rgba(158, 255, 129, 0.38);
        background:
            linear-gradient(130deg, rgba(14, 38, 17, 0.95), rgba(18, 40, 31, 0.84)),
            radial-gradient(
                96% 120% at 4% 0%,
                rgba(180, 255, 112, 0.42),
                rgba(180, 255, 112, 0)
            );
        min-height: 230px;
        padding: 18px;
        box-shadow: inset 0 0 0 1px rgba(226, 255, 203, 0.08);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }
    .kale-cover::before {
        content: "";
        position: absolute;
        inset: 0;
        opacity: 0.62;
        background:
            linear-gradient(
                140deg,
                rgba(222, 255, 169, 0.2) 0%,
                rgba(222, 255, 169, 0) 52%
            ),
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cg fill='none' stroke='%23ddffb2' stroke-opacity='0.25' stroke-width='1'%3E%3Cpath d='M0 24h180M0 60h180M0 96h180M0 132h180M0 168h180'/%3E%3Cpath d='M20 0v180M56 0v180M92 0v180M128 0v180M164 0v180'/%3E%3C/g%3E%3C/svg%3E");
        background-size: cover;
        mix-blend-mode: screen;
    }
    .kale-cover::after {
        content: "";
        position: absolute;
        inset: 10px;
        border-radius: 10px;
        border: 1px dashed rgba(203, 255, 157, 0.28);
        pointer-events: none;
    }
    .kale-cover-copy {
        position: relative;
        z-index: 1;
        max-width: 32ch;
    }
    .kale-cover-kicker {
        margin: 0 0 12px;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 1px;
        color: #d7ff9f;
    }
    .kale-cover-title {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: clamp(15px, 1.8vw, 20px);
        line-height: 1.4;
        color: #f2ffe8;
        text-shadow: 0 5px 16px rgba(7, 26, 8, 0.62);
    }
    .kale-cover-body {
        margin: 10px 0 0;
        font-size: 11px;
        line-height: 1.6;
        color: #d8f4be;
        max-width: 30ch;
    }
    .kale-cover-stamp {
        align-self: flex-start;
        position: relative;
        z-index: 1;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #0f3008;
        background: linear-gradient(180deg, #dfff99, #9fdb54);
        border: 1px solid rgba(11, 34, 8, 0.42);
        border-radius: 999px;
        padding: 6px 10px;
        letter-spacing: 1px;
    }
    .chapter-games .game-section,
    .chapter-dungeon .verifier-section {
        margin-top: 0;
    }
    .chapter-games .game-grid {
        grid-template-columns: 1fr;
    }
    .dungeon-teaser {
        border-radius: 14px;
        border: 1px solid rgba(255, 148, 117, 0.42);
        background:
            radial-gradient(
                120% 120% at 100% 0%,
                rgba(255, 138, 110, 0.18),
                rgba(255, 138, 110, 0)
            ),
            linear-gradient(150deg, rgba(35, 17, 22, 0.95), rgba(22, 15, 30, 0.92));
        padding: 16px;
        display: grid;
        gap: 10px;
        box-shadow: inset 0 0 0 1px rgba(255, 174, 151, 0.08);
    }
    .dungeon-overline {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        color: #ffaf92;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .dungeon-title {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 13px;
        color: #ffe2d7;
        letter-spacing: 1px;
    }
    .dungeon-copy {
        margin: 0;
        font-size: 12px;
        line-height: 1.7;
        color: #f5cfc3;
    }
    .dungeon-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .dungeon-tags span {
        font-size: 9px;
        font-family: "Press Start 2P", monospace;
        color: #ffe9de;
        padding: 5px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 177, 154, 0.42);
        background: rgba(71, 23, 27, 0.52);
    }
    .dungeon-stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .dungeon-stat-label {
        margin: 0 0 5px;
        font-size: 9px;
        color: #e3a493;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    .dungeon-stat-value {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 11px;
        color: #ffe4d9;
    }
    .farm-footer {
        margin-top: 18px;
    }

    /* ── 2026 Retro Upgrade ── */
    .farm-root {
        --neo-kale: #b8ff7c;
        --neo-cyan: #78deff;
        --neo-coral: #ff9b7a;
        --neo-ink: #ecf2ff;
        --neo-ink-soft: #b4c4e5;
        --neo-surface: rgba(7, 14, 28, 0.8);
        --neo-stroke: rgba(160, 183, 229, 0.28);
        --neo-shadow: 0 26px 60px rgba(0, 0, 0, 0.52);
        background:
            radial-gradient(
                120% 64% at 8% 0%,
                rgba(118, 255, 138, 0.16),
                rgba(118, 255, 138, 0)
            ),
            radial-gradient(
                110% 58% at 88% 10%,
                rgba(120, 222, 255, 0.18),
                rgba(120, 222, 255, 0)
            ),
            radial-gradient(
                90% 78% at 58% 100%,
                rgba(255, 145, 112, 0.12),
                rgba(255, 145, 112, 0)
            ),
            linear-gradient(180deg, #040816 0%, #081428 46%, #071220 100%);
    }
    .farm-root::before {
        opacity: 0.54;
    }
    .farm-content {
        max-width: min(1760px, 97vw);
        padding: 78px 24px 104px;
        gap: 28px;
    }
    .farm-header {
        border-radius: 16px;
        border-color: rgba(173, 255, 135, 0.42);
        box-shadow:
            0 18px 44px rgba(0, 0, 0, 0.44),
            inset 0 0 0 1px rgba(201, 255, 173, 0.12);
    }
    .chapter-strip {
        gap: 22px;
        grid-auto-columns: minmax(430px, 1fr);
        padding: 12px 4px 24px;
    }
    .chapter-panel {
        min-height: clamp(780px, 89vh, 1160px);
        padding: 22px;
        border-radius: 24px;
        border: 1px solid var(--neo-stroke);
        background: var(--neo-surface);
        box-shadow: var(--neo-shadow);
    }
    .chapter-panel::before {
        opacity: 0.42;
    }
    .chapter-panel::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.16;
        border-radius: 24px;
        background:
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.08) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
            ),
            repeating-linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 4px
            );
        mix-blend-mode: soft-light;
    }
    .chapter-head {
        gap: 8px;
    }
    .chapter-tag {
        color: #9fc9ff;
    }
    .chapter-title {
        font-size: clamp(18px, 1.95vw, 24px);
        line-height: 1.3;
        color: var(--neo-ink);
    }
    .chapter-copy {
        max-width: 58ch;
        font-size: 12px;
        line-height: 1.75;
        color: var(--neo-ink-soft);
    }
    .kale-cover {
        min-height: 264px;
        border-radius: 18px;
        border-color: rgba(183, 255, 138, 0.48);
        background:
            linear-gradient(130deg, rgba(14, 40, 18, 0.96), rgba(16, 46, 38, 0.84)),
            radial-gradient(
                100% 120% at 0% 0%,
                rgba(198, 255, 131, 0.44),
                rgba(198, 255, 131, 0)
            ),
            radial-gradient(
                120% 160% at 100% 100%,
                rgba(110, 245, 255, 0.24),
                rgba(110, 245, 255, 0)
            );
        box-shadow:
            inset 0 0 0 1px rgba(231, 255, 199, 0.12),
            0 20px 40px rgba(3, 16, 9, 0.52);
    }
    .kale-cover::before {
        opacity: 0.48;
    }
    .kale-cover::after {
        border-color: rgba(210, 255, 167, 0.32);
    }
    .kale-cover-kicker {
        color: #ddffaf;
    }
    .kale-cover-title {
        font-size: clamp(16px, 2vw, 24px);
        letter-spacing: 1.2px;
    }
    .kale-cover-stamp {
        box-shadow:
            0 10px 20px rgba(8, 30, 5, 0.38),
            inset 0 0 0 1px rgba(255, 255, 255, 0.2);
    }
    .kale-magic,
    .game-magic {
        display: grid;
        gap: 8px;
        margin-top: 2px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(168, 190, 239, 0.32);
        background:
            linear-gradient(135deg, rgba(8, 17, 34, 0.92), rgba(9, 21, 40, 0.75)),
            radial-gradient(
                90% 120% at 100% 0%,
                rgba(137, 255, 170, 0.14),
                rgba(137, 255, 170, 0)
            );
    }
    .kale-magic-btn,
    .game-magic-btn,
    .arcade-guide-btn {
        font-family: "Press Start 2P", monospace;
        font-size: 9px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgba(185, 212, 255, 0.44);
        background:
            linear-gradient(180deg, rgba(39, 72, 125, 0.92), rgba(24, 46, 87, 0.92)),
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
            );
        color: #eff5ff;
        box-shadow:
            inset 0 -2px 0 rgba(6, 12, 22, 0.8),
            0 8px 20px rgba(0, 0, 0, 0.38);
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .kale-magic-btn,
    .game-magic-btn {
        background:
            linear-gradient(180deg, rgba(52, 132, 92, 0.94), rgba(24, 92, 62, 0.94)),
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
            );
        border-color: rgba(194, 255, 171, 0.5);
        box-shadow:
            inset 0 -2px 0 rgba(6, 22, 9, 0.85),
            0 10px 24px rgba(5, 28, 9, 0.4),
            0 0 24px rgba(141, 255, 137, 0.22);
    }
    .kale-magic-btn:hover:not(:disabled),
    .game-magic-btn:hover:not(:disabled),
    .arcade-guide-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        border-color: rgba(218, 241, 255, 0.72);
        box-shadow:
            inset 0 -2px 0 rgba(6, 13, 24, 0.86),
            0 14px 24px rgba(0, 0, 0, 0.46);
    }
    .kale-magic-btn:focus-visible,
    .game-magic-btn:focus-visible,
    .arcade-guide-btn:focus-visible {
        outline: 2px solid rgba(203, 245, 255, 0.88);
        outline-offset: 2px;
    }
    .kale-magic-btn:disabled,
    .game-magic-btn:disabled,
    .arcade-guide-btn:disabled {
        opacity: 0.56;
        cursor: not-allowed;
        transform: none;
    }
    .kale-magic-copy,
    .game-magic-copy,
    .arcade-guide-mini {
        margin: 0;
        font-size: 11px;
        line-height: 1.6;
        color: #c5d5f0;
    }
    .arcade-guide-row {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
    }
    .arcade-guide-btn {
        padding: 10px 12px;
        background:
            linear-gradient(180deg, rgba(48, 82, 139, 0.92), rgba(23, 52, 100, 0.92)),
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
            );
    }
    .arcade-guide-card {
        margin-top: 4px;
        border-radius: 12px;
        border: 1px solid rgba(134, 201, 255, 0.36);
        background:
            linear-gradient(155deg, rgba(10, 24, 45, 0.88), rgba(9, 14, 34, 0.84)),
            radial-gradient(
                140% 200% at 100% 0%,
                rgba(111, 208, 255, 0.16),
                rgba(111, 208, 255, 0)
            );
        padding: 12px;
        display: grid;
        gap: 8px;
    }
    .arcade-guide-card p {
        margin: 0;
        font-size: 11px;
        line-height: 1.7;
        color: #d2e5ff;
    }
    .chapter-games .game-card {
        border-radius: 14px;
        border-color: rgba(150, 191, 248, 0.42);
        box-shadow:
            inset 0 0 0 1px rgba(206, 228, 255, 0.08),
            0 18px 30px rgba(0, 0, 0, 0.46);
    }
    .game-manual-label {
        margin: 12px 0 8px;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 1.1px;
        text-transform: uppercase;
        color: rgba(171, 188, 221, 0.88);
    }
    .game-actions--manual {
        border-radius: 12px;
        border: 1px dashed rgba(155, 177, 218, 0.36);
        background: rgba(10, 19, 37, 0.7);
        padding: 10px;
        opacity: 0.78;
        transition: opacity 0.2s ease, border-color 0.2s ease;
    }
    .game-card:hover .game-actions--manual {
        opacity: 1;
        border-color: rgba(187, 213, 255, 0.54);
    }
    .proof-celebration {
        border-radius: 20px;
        border-color: rgba(99, 233, 200, 0.46);
        box-shadow:
            inset 0 0 0 1px rgba(179, 255, 236, 0.12),
            0 24px 48px rgba(5, 22, 28, 0.44);
    }
    .proof-celebration-card {
        max-width: 64ch;
    }
    .dungeon-teaser {
        border-radius: 18px;
        border-color: rgba(255, 171, 146, 0.5);
        box-shadow:
            inset 0 0 0 1px rgba(255, 208, 189, 0.1),
            0 18px 34px rgba(0, 0, 0, 0.4);
    }
    .dungeon-title {
        font-size: 14px;
    }
    .toolchain-section {
        margin-top: 2px;
        display: grid;
        gap: 10px;
    }
    .toolchain-head {
        display: grid;
        gap: 5px;
    }
    .toolchain-kicker {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #ffbd95;
    }
    .toolchain-title {
        margin: 0;
        font-family: "Press Start 2P", monospace;
        font-size: 12px;
        line-height: 1.45;
        color: #ffe8dc;
    }
    .toolchain-copy {
        margin: 0;
        font-size: 11px;
        line-height: 1.65;
        color: #f6cec2;
    }
    .toolchain-tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }
    .toolchain-tab {
        border: 1px solid rgba(255, 173, 148, 0.42);
        border-radius: 12px;
        padding: 10px;
        background:
            linear-gradient(150deg, rgba(25, 16, 32, 0.9), rgba(21, 11, 27, 0.92)),
            radial-gradient(
                120% 170% at 100% 0%,
                rgba(255, 142, 118, 0.16),
                rgba(255, 142, 118, 0)
            );
        display: grid;
        gap: 4px;
        text-align: left;
        color: #ffe6dc;
        transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .toolchain-tab span {
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        line-height: 1.4;
        letter-spacing: 0.4px;
    }
    .toolchain-tab small {
        font-size: 10px;
        color: #ffcdb9;
    }
    .toolchain-tab:hover {
        transform: translateY(-1px);
        border-color: rgba(255, 214, 194, 0.68);
    }
    .toolchain-tab--active {
        border-color: rgba(255, 229, 179, 0.8);
        box-shadow:
            inset 0 0 0 1px rgba(255, 236, 211, 0.22),
            0 12px 24px rgba(0, 0, 0, 0.34);
        background:
            linear-gradient(150deg, rgba(54, 29, 24, 0.94), rgba(33, 19, 35, 0.94)),
            radial-gradient(
                120% 170% at 100% 0%,
                rgba(255, 169, 94, 0.24),
                rgba(255, 169, 94, 0)
            );
    }
    .toolchain-card {
        border-radius: 16px;
        border: 1px solid rgba(255, 173, 143, 0.46);
        padding: 14px;
        display: grid;
        gap: 10px;
        background:
            linear-gradient(160deg, rgba(37, 18, 24, 0.95), rgba(19, 14, 31, 0.92)),
            radial-gradient(
                120% 220% at 100% 0%,
                rgba(255, 164, 128, 0.16),
                rgba(255, 164, 128, 0)
            );
        box-shadow:
            inset 0 0 0 1px rgba(255, 221, 203, 0.1),
            0 18px 30px rgba(0, 0, 0, 0.38);
    }
    .toolchain-top {
        display: grid;
        gap: 4px;
    }
    .toolchain-status {
        margin: 0;
        display: inline-flex;
        align-self: flex-start;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #2f180f;
        background: linear-gradient(180deg, #ffd89a, #ffb786);
        border: 1px solid rgba(48, 20, 14, 0.52);
        border-radius: 999px;
        padding: 6px 8px;
    }
    .toolchain-mode,
    .toolchain-summary,
    .toolchain-path {
        margin: 0;
        font-size: 11px;
        line-height: 1.65;
        color: #ffd8c9;
    }
    .toolchain-path {
        color: #ffc8b6;
    }
    .toolchain-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
    }
    .toolchain-column {
        border: 1px solid rgba(255, 173, 143, 0.34);
        border-radius: 10px;
        padding: 10px;
        background: rgba(45, 19, 28, 0.62);
    }
    .toolchain-column-title {
        margin: 0 0 7px;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: #ffe0d1;
    }
    .toolchain-column ul {
        margin: 0;
        padding-left: 14px;
        display: grid;
        gap: 6px;
    }
    .toolchain-column li {
        font-size: 10px;
        line-height: 1.6;
        color: #f8cdbf;
    }
    .toolchain-links {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
    }
    .toolchain-links a {
        font-size: 9px;
        font-family: "Press Start 2P", monospace;
        letter-spacing: 0.3px;
        color: #ffe9df;
        text-decoration: none;
        border: 1px solid rgba(255, 173, 143, 0.42);
        border-radius: 999px;
        padding: 6px 9px;
        background: rgba(67, 29, 27, 0.52);
    }
    .toolchain-links a:hover {
        border-color: rgba(255, 218, 198, 0.72);
        color: #fff8f3;
    }
    .toolchain-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }
    .toolchain-copy-btn {
        background:
            linear-gradient(180deg, rgba(80, 62, 120, 0.9), rgba(53, 35, 92, 0.9)),
            repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
            );
        border-color: rgba(199, 175, 255, 0.52);
    }
    .toolchain-actions--secondary {
        justify-content: flex-start;
    }
    .quiet-details {
        border: 1px solid rgba(156, 179, 232, 0.3);
        border-radius: 12px;
        background:
            linear-gradient(145deg, rgba(10, 20, 40, 0.72), rgba(9, 17, 34, 0.62)),
            radial-gradient(
                130% 180% at 100% 0%,
                rgba(131, 224, 255, 0.12),
                rgba(131, 224, 255, 0)
            );
        padding: 8px 10px;
    }
    .quiet-details + .quiet-details {
        margin-top: 8px;
    }
    .quiet-details summary {
        cursor: pointer;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-family: "Press Start 2P", monospace;
        font-size: 8px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: #c9d9f8;
    }
    .quiet-details summary::-webkit-details-marker {
        display: none;
    }
    .quiet-details summary::after {
        content: "▼";
        font-size: 8px;
        color: #9ed2ff;
        transition: transform 0.2s ease;
    }
    .quiet-details[open] summary::after {
        transform: rotate(180deg);
    }
    .quiet-details-body {
        margin-top: 10px;
        display: grid;
        gap: 10px;
    }
    .game-zk-details {
        margin-top: 8px;
    }
    .game-advanced-panel {
        margin-top: 10px;
    }
    .chapter-copy,
    .game-summary,
    .game-goal,
    .game-magic-copy,
    .kale-magic-copy,
    .arcade-guide-mini,
    .toolchain-copy,
    .toolchain-summary,
    .toolchain-path,
    .dungeon-copy {
        font-size: 13px;
        line-height: 1.75;
    }
    .game-title {
        font-size: 17px;
        line-height: 1.35;
    }
    .game-zk-title,
    .toolchain-title {
        font-size: 12px;
        line-height: 1.55;
    }
    .kale-magic-btn,
    .game-magic-btn,
    .toolchain-actions .arcade-guide-btn {
        position: relative;
        overflow: hidden;
        font-size: clamp(10px, 0.72vw, 12px);
        min-height: 48px;
        letter-spacing: 0.9px;
        animation: cta-breathe 2.8s ease-in-out infinite;
    }
    .kale-magic-btn::after,
    .game-magic-btn::after,
    .toolchain-actions .arcade-guide-btn::after {
        content: "";
        position: absolute;
        top: 0;
        left: -120%;
        width: 75%;
        height: 100%;
        transform: skewX(-20deg);
        background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0),
            rgba(255, 255, 255, 0.22),
            rgba(255, 255, 255, 0)
        );
        animation: cta-sheen 3.8s ease-in-out infinite;
        pointer-events: none;
    }
    .kale-magic-btn:hover:not(:disabled),
    .game-magic-btn:hover:not(:disabled),
    .toolchain-actions .arcade-guide-btn:hover:not(:disabled) {
        transform: translateY(-3px) scale(1.01);
    }
    .game-card {
        gap: 12px;
    }
    @keyframes cta-sheen {
        0% {
            left: -120%;
        }
        55% {
            left: 150%;
        }
        100% {
            left: 150%;
        }
    }
    @keyframes cta-breathe {
        0%,
        100% {
            box-shadow:
                inset 0 -2px 0 rgba(6, 22, 9, 0.85),
                0 10px 24px rgba(5, 28, 9, 0.4),
                0 0 20px rgba(141, 255, 137, 0.18);
        }
        50% {
            box-shadow:
                inset 0 -2px 0 rgba(6, 22, 9, 0.85),
                0 13px 26px rgba(5, 28, 9, 0.45),
                0 0 30px rgba(141, 255, 137, 0.28);
        }
    }
    @media (max-width: 1280px) {
        .chapter-strip {
            grid-auto-columns: minmax(360px, 84vw);
        }
        .toolchain-grid {
            grid-template-columns: 1fr 1fr;
        }
    }
    @media (max-width: 1080px) {
        .farm-content {
            padding: 72px 16px 94px;
        }
        .chapter-strip {
            grid-auto-flow: row;
            grid-template-columns: 1fr;
            overflow: visible;
            padding-bottom: 0;
        }
        .chapter-panel {
            min-width: 0;
            min-height: auto;
            padding: 18px;
        }
        .dungeon-stats {
            grid-template-columns: 1fr;
        }
        .toolchain-tabs {
            grid-template-columns: 1fr;
        }
        .toolchain-grid {
            grid-template-columns: 1fr;
        }
        .toolchain-actions {
            justify-content: stretch;
            gap: 6px;
        }
        .chapter-copy,
        .game-summary,
        .game-goal,
        .game-magic-copy,
        .kale-magic-copy,
        .toolchain-copy,
        .toolchain-summary,
        .toolchain-path {
            font-size: 12px;
        }
    }
    @media (max-width: 760px) {
        .chapter-strip {
            gap: 14px;
        }
        .chapter-panel {
            border-radius: 18px;
            padding: 14px;
        }
        .kale-cover {
            min-height: 220px;
            padding: 14px;
        }
        .kale-magic-btn,
        .game-magic-btn,
        .arcade-guide-btn {
            width: 100%;
            font-size: 8px;
            padding: 11px 10px;
        }
        .arcade-guide-row {
            align-items: stretch;
        }
        .game-actions--manual {
            opacity: 1;
        }
        .toolchain-card {
            padding: 12px;
        }
        .toolchain-column {
            padding: 8px;
        }
        .quiet-details {
            padding: 7px 8px;
        }
        .quiet-details summary {
            font-size: 7px;
        }
    }
</style>
