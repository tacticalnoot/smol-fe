import { generateSalt } from "./proof";

export type ZkGameProof = {
    id: string;
    title: string;
    wallet: string;
    level: number;
    score: number;
    actions: unknown;
    actionHash: string;
    commitment: string;
    salt: string;
    createdAt: number;
};

export type GameProofPacket = {
    gameId: string;
    wallet: string;
    level: number;
    score: number;
    actionHash: string;
    commitment: string;
    salt: string;
    createdAt: number;
    network: "stellar-testnet";
};

const STORAGE_KEY = "farm:game-proofs";
const WALLET_KEY = "farm:game-wallet";

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function hashPayload(payload: unknown): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
}

export async function createGameProof(
    gameId: string,
    title: string,
    wallet: string,
    level: number,
    score: number,
    actions: unknown,
): Promise<ZkGameProof> {
    const salt = generateSalt();
    const saltHex = bytesToHex(salt);
    const actionHash = await hashPayload({ gameId, actions });
    const commitment = await hashPayload({
        wallet,
        gameId,
        level,
        score,
        actionHash,
        salt: saltHex,
    });

    return {
        id: gameId,
        title,
        wallet,
        level,
        score,
        actions,
        actionHash,
        commitment,
        salt: saltHex,
        createdAt: Date.now(),
    };
}

export function buildGameProofPacket(proof: ZkGameProof): GameProofPacket {
    return {
        gameId: proof.id,
        wallet: proof.wallet,
        level: proof.level,
        score: proof.score,
        actionHash: proof.actionHash,
        commitment: proof.commitment,
        salt: proof.salt,
        createdAt: proof.createdAt,
        network: "stellar-testnet",
    };
}

function storageKey(wallet: string): string {
    return `${STORAGE_KEY}:${wallet}`;
}

export function loadGameProofs(wallet: string): Record<string, ZkGameProof> {
    try {
        const raw = localStorage.getItem(storageKey(wallet));
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function saveGameProof(wallet: string, proof: ZkGameProof): void {
    const current = loadGameProofs(wallet);
    current[proof.id] = proof;
    localStorage.setItem(storageKey(wallet), JSON.stringify(current));
}

export function getOrCreateGameWalletId(): string {
    const existing = localStorage.getItem(WALLET_KEY);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const suffix = bytesToHex(bytes);
    const walletId = `GUEST-${suffix}`;
    localStorage.setItem(WALLET_KEY, walletId);
    return walletId;
}
