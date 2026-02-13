/**
 * THE FARM — SHA-256 commitment utilities (legacy scheme).
 *
 * All shared types, badge definitions, and tier config now live in zkTypes.ts.
 * This file re-exports from zkTypes for backwards compatibility and provides
 * the SHA-256 commit-reveal helpers used before the Groth16/Poseidon upgrade.
 */

// Re-export everything from zkTypes for backwards compatibility
export {
    type BadgeType,
    type BadgeDef,
    type EarnedBadge,
    type ProofPacket,
    type TierDef,
    BADGE_REGISTRY,
    TIER_CONFIG,
    TIER_VERIFIER_CONTRACT_ID,
    getTierForBalance,
    formatKaleBalance,
    truncateHash,
    buildProofPacket,
    saveEarnedBadge,
    loadAllBadges,
} from "./zkTypes";

// ---------------------------------------------------------------------------
<<<<<<< HEAD
// SHA-256 commitment (legacy scheme, kept for verification of old commitments)
// New proofs use Poseidon hashing via the Groth16 circuit in zkProof.ts
// ---------------------------------------------------------------------------

export async function generateCommitment(
    farmerAddress: string,
    balance: bigint,
    salt: Uint8Array,
): Promise<string> {
    const encoder = new TextEncoder();
    const payload = new Uint8Array([
        ...encoder.encode(farmerAddress),
        ...encoder.encode(balance.toString()),
        ...salt,
    ]);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
}

function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.trim().toLowerCase();
    if (normalized.length % 2 !== 0) {
        throw new Error("Invalid hex length");
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
    }
    return bytes;
}

export async function verifyCommitment(
    farmerAddress: string,
    balance: bigint,
    saltHex: string,
    expectedCommitment: string,
): Promise<boolean> {
    const salt = hexToBytes(saltHex);
    const recomputed = await generateCommitment(farmerAddress, balance, salt);
    return recomputed === expectedCommitment;
=======
// Tier configuration
// ---------------------------------------------------------------------------

export interface TierDef {
    name: string;
    icon: string;
    min: number;
    color: string;
    glow: string;
}

export const TIER_CONFIG: TierDef[] = [
    { name: 'Sprout', icon: '🌱', min: 0, color: '#86efac', glow: 'rgba(134,239,172,0.35)' },
    { name: 'Grower', icon: '🌿', min: 100, color: '#4ade80', glow: 'rgba(74,222,128,0.35)' },
    { name: 'Harvester', icon: '🥬', min: 1000, color: '#22c55e', glow: 'rgba(34,197,94,0.35)' },
    { name: 'Whale', icon: '🐋', min: 10000, color: '#0ea5e9', glow: 'rgba(14,165,233,0.35)' },
];

export function getTierForBalance(balance: bigint): number {
    const kale = Number(balance / 10_000_000n);
    if (kale >= 10_000) return 3;
    if (kale >= 1_000) return 2;
    if (kale >= 100) return 1;
    return 0;
}

export function formatKaleBalance(balance: bigint): string {
    return Number(balance / 10_000_000n).toLocaleString();
}

export function truncateHash(hash: string): string {
    return `${hash.slice(0, 8)}\u2026${hash.slice(-4)}`;
>>>>>>> farm-mainnet-real-triple-zk
}
