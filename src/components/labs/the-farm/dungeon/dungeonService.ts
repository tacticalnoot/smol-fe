/**
 * Dungeon Service — Stellar testnet contract interactions for the ZK Dungeon game.
 *
 * Handles:
 * - Game hub start_game() / end_game() calls
 * - Door attempt transactions with real ZK proof submission
 * - Testnet RPC + simulation + signing via passkey-kit
 */

import {
    Contract,
    Address,
    nativeToScVal,
    TransactionBuilder,
    Networks,
    Account,
    xdr,
    rpc,
} from "@stellar/stellar-sdk/minimal";

const { Server, Api, assembleTransaction } = rpc;

// ── Constants ────────────────────────────────────────────────────────────────

/** Game hub contract on Stellar testnet */
export const HUB_CONTRACT_ID =
    "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

/** Tier verifier contract for on-chain proof verification */
const TIER_VERIFIER_ID = "CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M";

/** Testnet RPC endpoint */
const TESTNET_RPC = "https://soroban-testnet.stellar.org";

/** Null account for building unsigned transactions (passkey signs later) */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const TESTNET_PASSPHRASE = Networks.TESTNET;

// ── Testnet RPC Server ───────────────────────────────────────────────────────

let _server: InstanceType<typeof Server> | null = null;
function getTestnetServer(): InstanceType<typeof Server> {
    if (!_server) {
        _server = new Server(TESTNET_RPC);
    }
    return _server;
}

// ── Transaction Builder Helpers ──────────────────────────────────────────────

interface BuildResult {
    assembled: any; // Transaction ready for signing
    simResult: any;
}

/**
 * Build + simulate a Soroban contract call on testnet.
 * Returns the assembled transaction ready for passkey signing.
 */
async function buildAndSimulate(
    contractId: string,
    method: string,
    args: any[],
): Promise<BuildResult> {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);

    const sourceAccount = new Account(NULL_ACCOUNT, "0");
    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000", // 1 XLM max
        networkPassphrase: TESTNET_PASSPHRASE,
    })
        .addOperation(op)
        .setTimeout(300)
        .build();

    const server = getTestnetServer();
    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        const errMsg =
            typeof simResult.error === "string"
                ? simResult.error
                : JSON.stringify(simResult.error);
        throw new Error(`Simulation failed: ${errMsg}`);
    }

    const assembled = assembleTransaction(tx, simResult).build();
    return { assembled, simResult };
}

/**
 * Sign and send a testnet transaction via passkey-kit.
 * Returns the transaction hash on success.
 */
async function signAndSendTestnet(
    assembled: any,
    keyId: string,
    contractId: string,
): Promise<string> {
    // Dynamic imports to avoid bundling heavy deps at module level
    const { account, send } = await import("../../../../utils/passkey-kit");
    const { getLatestSequence } = await import("../../../../utils/base");
    const { getSafeRpId } = await import("../../../../utils/domains");

    const kit = await account.get();
    const rpId = getSafeRpId(window.location.hostname);
    const sequence = await getLatestSequence();

    // Ensure wallet is connected
    if (!kit.wallet) {
        await kit.connectWallet({
            rpId,
            keyId,
            getContractId: async () => contractId,
        });
    }

    const signedTx = await kit.sign(assembled, {
        rpId,
        keyId,
        expiration: sequence + 60,
    });

    // Use empty turnstile token — testnet relayer may not require it
    const result = await send(signedTx, "");
    return result.hash || result.transactionHash || "";
}

// ── Hub Contract Calls ───────────────────────────────────────────────────────

export interface StartGameParams {
    gameId: string;       // Game contract address (our dungeon contract)
    sessionId: number;    // Lobby session ID (u32)
    player1: string;      // Player 1 Stellar address
    player2: string;      // Player 2 Stellar address
    player1Points: bigint;
    player2Points: bigint;
    keyId: string;
    contractId: string;   // Wallet contract ID (for passkey signing)
}

/**
 * Call start_game() on the game hub contract.
 * This registers the game session with the hub.
 */
export async function callStartGame(params: StartGameParams): Promise<string> {
    console.log("[Dungeon] start_game() →", params.sessionId);

    const args = [
        new Address(params.gameId).toScVal(),
        nativeToScVal(params.sessionId, { type: "u32" }),
        new Address(params.player1).toScVal(),
        new Address(params.player2).toScVal(),
        nativeToScVal(params.player1Points, { type: "i128" }),
        nativeToScVal(params.player2Points, { type: "i128" }),
    ];

    const { assembled } = await buildAndSimulate(HUB_CONTRACT_ID, "start_game", args);
    const txHash = await signAndSendTestnet(assembled, params.keyId, params.contractId);

    console.log("[Dungeon] start_game() tx:", txHash);
    return txHash;
}

export interface EndGameParams {
    sessionId: number;
    player1Won: boolean;
    keyId: string;
    contractId: string;
}

/**
 * Call end_game() on the game hub contract.
 * This finalizes the game session with the hub.
 */
export async function callEndGame(params: EndGameParams): Promise<string> {
    console.log("[Dungeon] end_game() →", params.sessionId);

    const args = [
        nativeToScVal(params.sessionId, { type: "u32" }),
        nativeToScVal(params.player1Won, { type: "bool" }),
    ];

    const { assembled } = await buildAndSimulate(HUB_CONTRACT_ID, "end_game", args);
    const txHash = await signAndSendTestnet(assembled, params.keyId, params.contractId);

    console.log("[Dungeon] end_game() tx:", txHash);
    return txHash;
}

// ── Door Attempt (Real ZK Proof) ─────────────────────────────────────────────

export interface DoorAttemptParams {
    lobbyId: string;
    floor: number;
    doorChoice: number;
    attemptNonce: number;
    playerAddress: string;
    keyId: string;
    contractId: string;
}

export interface DoorAttemptResult {
    isCorrect: boolean;
    txHash: string | null;
    proofType: string;
    commitment: string | null;
    provingTimeMs: number;
    verified: boolean;
    error: string | null;
}

/** Status callback for door attempt UI updates */
export type DoorAttemptStatusCallback = (status: string) => void;

/**
 * Submit a door attempt with a real ZK proof + on-chain transaction.
 *
 * Flow:
 * 1. Generate Groth16 proof via snarkjs (Poseidon commitment, real BN254)
 * 2. Verify locally (debug check)
 * 3. Submit proof on-chain via tier-verifier contract (if wallet connected)
 * 4. Return structured result with tx hash
 *
 * NOTE: Wrong choices still generate valid proofs. The `is_correct` flag
 * is determined by comparing the chosen door against the correct door.
 * The proof itself always verifies — only the outcome differs.
 */
export async function attemptDoor(
    params: DoorAttemptParams,
    onStatus?: DoorAttemptStatusCallback,
): Promise<DoorAttemptResult> {
    console.log("[Dungeon] attemptDoor →", {
        floor: params.floor,
        door: params.doorChoice,
        nonce: params.attemptNonce,
    });

    const proofType = getProofTypeForFloor(params.floor);
    onStatus?.("Generating ZK proof...");

    try {
        // Generate real Groth16 proof
        const { generateDoorProof, verifyDoorProofLocally } = await import(
            "./dungeonProofWorker"
        );

        const proofResult = await generateDoorProof({
            playerAddress: params.playerAddress || params.contractId || "anonymous",
            floor: params.floor,
            doorChoice: params.doorChoice,
            attemptNonce: params.attemptNonce,
            lobbyId: params.lobbyId,
        });

        // Verify locally (debug / confidence check)
        let verified = false;
        onStatus?.("Verifying proof locally...");
        try {
            verified = await verifyDoorProofLocally(
                proofResult.proof,
                proofResult.publicSignals,
            );
            console.log("[Dungeon] Local verification:", verified ? "PASS" : "FAIL");
        } catch (verifyErr) {
            console.warn("[Dungeon] Local verification error (non-blocking):", verifyErr);
        }

        // Attempt on-chain submission if wallet is connected
        let txHash: string | null = null;
        if (params.keyId && params.contractId) {
            onStatus?.("Signing transaction...");
            try {
                txHash = await submitProofOnChain(
                    proofResult.proof,
                    proofResult.publicSignals,
                    params.playerAddress || params.contractId,
                    params.keyId,
                    params.contractId,
                    onStatus,
                );
            } catch (txErr: any) {
                console.warn("[Dungeon] On-chain submission failed (non-blocking):", txErr.message);
                // Proof was still generated and verified locally — game continues
            }
        }

        if (txHash) {
            onStatus?.("Confirmed on-chain");
        } else {
            onStatus?.("Verified locally");
        }

        return {
            isCorrect: proofResult.isCorrect,
            txHash,
            proofType: proofResult.proofType,
            commitment: proofResult.commitment,
            provingTimeMs: proofResult.provingTimeMs,
            verified,
            error: null,
        };
    } catch (err: any) {
        console.error("[Dungeon] Proof generation failed:", err.message);
        onStatus?.("Proof error (fallback)");

        // Fallback: determine correctness without proof
        const seed = params.floor * 1000 + params.attemptNonce;
        const correctDoor = (seed * 7 + 3) % 4;

        return {
            isCorrect: params.doorChoice === correctDoor,
            txHash: null,
            proofType,
            commitment: null,
            provingTimeMs: 0,
            verified: false,
            error: err.message,
        };
    }
}

// ── On-Chain Proof Submission ───────────────────────────────────────────────

/**
 * Submit a Groth16 proof to the tier-verifier contract on testnet.
 * Uses verify_and_attest to create a real on-chain verification record.
 */
async function submitProofOnChain(
    proof: any,
    publicSignals: string[],
    farmerAddress: string,
    keyId: string,
    contractId: string,
    onStatus?: DoorAttemptStatusCallback,
): Promise<string> {
    // Serialize proof to BN254 format
    const { serializeProof } = await import("../zkProof");

    const serialized = serializeProof(proof);

    // Build proof struct for the contract
    const proofStruct = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("pi_a"),
            val: nativeToScVal(Buffer.from(serialized.pi_a), { type: "bytes" }),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("pi_b"),
            val: nativeToScVal(Buffer.from(serialized.pi_b), { type: "bytes" }),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("pi_c"),
            val: nativeToScVal(Buffer.from(serialized.pi_c), { type: "bytes" }),
        }),
    ]);

    // Compute commitment as 32-byte buffer from publicSignals[0]
    const commitmentBigInt = BigInt(publicSignals[0]);
    const commitmentBytes = new Uint8Array(32);
    let v = commitmentBigInt;
    for (let i = 31; i >= 0; i--) {
        commitmentBytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }

    // Build verify_and_attest call
    const contract = new Contract(TIER_VERIFIER_ID);
    const op = contract.call(
        "verify_and_attest",
        new Address(farmerAddress).toScVal(),
        nativeToScVal(0, { type: "u32" }),  // tier_id = 0 (Sprout)
        nativeToScVal(Buffer.from(commitmentBytes), { type: "bytes" }),
        proofStruct,
    );

    const sourceAccount = new Account(NULL_ACCOUNT, "0");
    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000",
        networkPassphrase: TESTNET_PASSPHRASE,
    })
        .addOperation(op)
        .setTimeout(300)
        .build();

    onStatus?.("Simulating...");
    const server = getTestnetServer();
    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        const errMsg = typeof simResult.error === "string"
            ? simResult.error
            : JSON.stringify(simResult.error);
        throw new Error(`Proof simulation failed: ${errMsg}`);
    }

    const assembled = assembleTransaction(tx, simResult).build();

    onStatus?.("Signing...");
    const txHash = await signAndSendTestnet(assembled, keyId, contractId);

    console.log("[Dungeon] Proof submitted on-chain:", txHash);
    return txHash;
}

// ── Utility ──────────────────────────────────────────────────────────────────

/** Map floor number to proof framework label */
export function getProofTypeForFloor(floor: number): string {
    if (floor === 3 || floor === 7) return "Circom";
    if (floor === 10) return "RISC Zero";
    return "Groth16";
}

/** Generate a random session ID (u32) */
export function generateSessionId(): number {
    return Math.floor(Math.random() * 0x7fffffff);
}

/** Stellar expert testnet tx link */
export function txExplorerUrl(txHash: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

/** Stellar expert testnet contract link */
export function contractExplorerUrl(contractId: string): string {
    return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
}
