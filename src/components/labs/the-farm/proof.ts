/**
 * THE FARM — Badge system & ZK proof utilities.
 *
 * Architecture: extensible badge registry so THE FARM grows into a
 * Smart Wallet Dreamboard. Proof of Farm is the first earnable badge;
 * future badges slot into the same system.
 */

// ---------------------------------------------------------------------------
// Badge system
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
    available: boolean; // can it be earned right now?
}

export interface EarnedBadge {
    id: BadgeType;
    earnedAt: number;
    data: Record<string, unknown>;
}

/** All badges that exist (or will exist) on the dreamboard. */
export const BADGE_REGISTRY: BadgeDef[] = [
    {
        id: 'proof-of-farm',
        title: 'Proof of Farm',
        description: 'ZK-attested farming tier on Stellar',
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

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ZK commitment (client-side stand-in for on-chain Poseidon / CAP-0075)
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

export function truncateHash(hash: string): string {
    return `${hash.slice(0, 8)}\u2026${hash.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Local badge persistence (upgrades to on-chain reads once contract deploys)
// ---------------------------------------------------------------------------

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
