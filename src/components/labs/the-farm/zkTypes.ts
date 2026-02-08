
// ============================================================================
// Shared Types & Constants for ZK Farm System
// Single source of truth for all Farm types, constants, and helpers.
// ============================================================================

export const TIER_VERIFIER_CONTRACT_ID = "CDLA6S76Q362EWX5NF232AFFMHAANI3QPXI4W67YCRMS2FKV6E64AGL6";
export const STELLAR_NETWORK = "stellar-mainnet" as const;

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

export const TIER_THRESHOLDS = {
    SPROUT: 0n,
    GROWER: 100n * 10_000_000n,      // 100 KALE
    HARVESTER: 1_000n * 10_000_000n, // 1,000 KALE
    WHALE: 10_000n * 10_000_000n,    // 10,000 KALE
};

export function getTierIdForBalance(balance: bigint): number {
    if (balance >= TIER_THRESHOLDS.WHALE) return 3;
    if (balance >= TIER_THRESHOLDS.HARVESTER) return 2;
    if (balance >= TIER_THRESHOLDS.GROWER) return 1;
    return 0;
}

export function getTierForBalance(balance: bigint): number {
    return getTierIdForBalance(balance);
}

export function formatKaleBalance(balance: bigint): string {
    return Number(balance / 10_000_000n).toLocaleString();
}

export function truncateHash(hash: string): string {
    return `${hash.slice(0, 8)}\u2026${hash.slice(-4)}`;
}

export interface TierProofInputs {
    tier_id: string;
    commitment_expected: string;
    address_hash: string;
    balance: string;
    salt: string;
}

export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: "groth16";
    curve: "bn254";
}

export interface ProofResult {
    proof: Groth16Proof;
    publicSignals: string[];
}

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

// ---------------------------------------------------------------------------
// Badge definitions (from proof.ts originally)
// ---------------------------------------------------------------------------

export type BadgeType =
    | 'proof-of-farm'
    | 'first-harvest'
    | 'melodist'
    | 'swapper'
    | 'quiz-master';

export interface BadgeDef {
    id: BadgeType;
    title: string;
    description: string;
    icon: string;
    available: boolean;
}

export interface EarnedBadge {
    id: BadgeType;
    earnedAt: number;
    data: Record<string, unknown>;
}

export interface ProofPacket {
    farmer: string;
    tier: number;
    commitment: string;
    salt: string;
}

export const BADGE_REGISTRY: BadgeDef[] = [
    {
        id: 'proof-of-farm',
        title: 'Proof of Farm',
        description: 'Commitment-attested farming tier on Stellar',
        icon: '🌾',
        available: true,
    },
    {
        id: 'first-harvest',
        title: 'First Harvest',
        description: 'Your first KALE balance snapshot',
        icon: '🫛',
        available: false,
    },
    {
        id: 'melodist',
        title: 'Melodist',
        description: 'Listened to 10 songs on smol',
        icon: '🎵',
        available: false,
    },
    {
        id: 'swapper',
        title: 'DEX Pioneer',
        description: 'Completed your first token swap',
        icon: '🔄',
        available: false,
    },
    {
        id: 'quiz-master',
        title: 'Quiz Master',
        description: 'Perfect score on Blind Quiz',
        icon: '🧠',
        available: false,
    },
];

// Helper to build packet
export function buildProofPacket(badge: EarnedBadge, farmerAddress: string): ProofPacket {
    const data = badge.data as {
        tier?: number;
        commitment?: string;
        salt?: string;
    };
    return {
        farmer: farmerAddress,
        tier: data.tier ?? 0,
        commitment: data.commitment ?? "",
        salt: data.salt ?? "",
    };
}

// Storage helpers
const STORAGE_KEY = 'farm:badges';
function storageKey(contractId: string): string {
    return `${STORAGE_KEY}:${contractId}`;
}

export function saveEarnedBadge(contractId: string, badge: EarnedBadge): void {
    const all = loadAllBadges(contractId);
    all[badge.id] = badge;
    localStorage.setItem(storageKey(contractId), JSON.stringify(all));
}

export function loadAllBadges(contractId: string): Record<string, EarnedBadge> {
    try {
        const raw = localStorage.getItem(storageKey(contractId));
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}
