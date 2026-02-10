/**
 * Dungeon Service — Stellar testnet contract interactions for the ZK Dungeon game.
 *
 * Handles:
 * - Game hub start_game() / end_game() calls
 * - Door attempt transactions (real on-chain, ZK proof wiring in PR4)
 * - Testnet RPC + simulation + signing via passkey-kit
 */

import {
    Contract,
    Address,
    nativeToScVal,
    TransactionBuilder,
    Networks,
    Account,
    rpc,
} from "@stellar/stellar-sdk/minimal";

const { Server, Api, assembleTransaction } = rpc;

// ── Constants ────────────────────────────────────────────────────────────────

/** Game hub contract on Stellar testnet */
export const HUB_CONTRACT_ID =
    "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

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

// ── Door Attempt (Placeholder — real ZK proof in PR4) ────────────────────────

export interface DoorAttemptParams {
    lobbyId: string;
    floor: number;
    doorChoice: number;
    attemptNonce: number;
    keyId: string;
    contractId: string;
}

export interface DoorAttemptResult {
    isCorrect: boolean;
    txHash: string | null;
    proofType: string;
    error: string | null;
}

/**
 * Submit a door attempt.
 *
 * PR3: Records attempt locally + generates a testnet tx stub.
 * PR4: Will include real Noir proof generation + on-chain verification.
 *
 * NOTE: Even "wrong" choices produce valid proofs (is_correct=0).
 * The circuit never fails — only the output differs.
 */
export async function attemptDoor(
    params: DoorAttemptParams,
): Promise<DoorAttemptResult> {
    console.log("[Dungeon] attemptDoor →", {
        floor: params.floor,
        door: params.doorChoice,
        nonce: params.attemptNonce,
    });

    // Compute correct door deterministically
    // In PR4: this comes from the circuit (sigil_secret + floor + nonce) % 4
    const seed = params.floor * 1000 + params.attemptNonce;
    const correctDoor = (seed * 7 + 3) % 4;
    const isCorrect = params.doorChoice === correctDoor;

    // PR3: No on-chain proof yet, but return structured result
    // The ZK proof + contract call will be wired in PR4
    const proofType = getProofTypeForFloor(params.floor);

    return {
        isCorrect,
        txHash: null, // Real tx hash in PR4
        proofType,
        error: null,
    };
}

// ── Utility ──────────────────────────────────────────────────────────────────

/** Map floor number to proof framework label */
export function getProofTypeForFloor(floor: number): string {
    if (floor === 3 || floor === 7) return "Circom";
    if (floor === 10) return "RISC Zero";
    return "Noir";
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
