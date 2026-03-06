/**
 * Discombobulator ZK Balance Eligibility
 *
 * Generates a client-side Groth16 proof that the user's balance >= the
 * operation amount, without revealing the actual balance. Uses the existing
 * kale_tier circuit artifacts (WASM + zkey) already deployed at /public/zk/.
 *
 * No contract deployment required — proof generation and verification are
 * fully client-side. The proof is attached to the SPP privacy artifact as
 * cryptographic evidence of eligibility at commitment time.
 *
 * Circuit: balance >= threshold, Poseidon(address_hash, balance, salt) == commitment
 * Public inputs: tier_id (threshold), commitment_expected
 * Private inputs: address_hash, balance, salt
 */

import { sha256Hex } from "./discombobulator-spp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZkEligibilityProof {
    available: true;
    proofJson: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
        protocol: string;
        curve: string;
    };
    publicSignals: string[];
    commitment: string;
    threshold: string;
    tokenSymbol: string;
    addressHashHex: string;
    locallyVerified: boolean;
    generatedAt: string;
    durationMs: number;
}

export interface ZkEligibilitySkipped {
    available: false;
    reason: string;
    tokenSymbol: string;
    threshold: string;
    generatedAt: string;
    durationMs: number;
}

export type ZkEligibilityAttachment = ZkEligibilityProof | ZkEligibilitySkipped;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ZK_VERSION = "discombo-v1";
const CIRCUIT_WASM_PATH = `/zk/tier_proof.wasm?v=${ZK_VERSION}`;
const PROVING_KEY_PATH = `/zk/tier_proof.zkey?v=${ZK_VERSION}`;
const VKEY_PATH = `/zk/verification_key.json?v=${ZK_VERSION}`;

function generateRandomSalt(): bigint {
    const bytes = new Uint8Array(31); // < BN254 field size
    globalThis.crypto.getRandomValues(bytes);
    let result = 0n;
    for (const byte of bytes) {
        result = (result << 8n) | BigInt(byte);
    }
    return result;
}

async function hashAddressToBigInt(address: string): Promise<bigint> {
    const hex = await sha256Hex(address);
    // Truncate to 248 bits to stay within BN254 field
    const truncated = hex.slice(0, 62);
    return BigInt("0x" + truncated);
}

async function buildPoseidonHasher(): Promise<(inputs: bigint[]) => bigint> {
    // @ts-ignore - circomlibjs lacks TypeScript declarations
    const { buildPoseidon } = await import("circomlibjs");
    const poseidon = await buildPoseidon();
    return (inputs: bigint[]) => {
        const raw = poseidon(inputs);
        return BigInt(poseidon.F.toString(raw));
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a ZK eligibility proof: proves balance >= thresholdStroops
 * without revealing the actual balance.
 *
 * Returns a ZkEligibilitySkipped if:
 * - balance < threshold (proof would fail the circuit constraint)
 * - snarkjs or circomlibjs unavailable
 * - any other error during proof generation
 */
export async function generateZkEligibilityProof(
    balanceStroops: bigint,
    thresholdStroops: bigint,
    tokenSymbol: string,
    userAddress: string,
): Promise<ZkEligibilityAttachment> {
    const startedAt = Date.now();
    const generatedAt = new Date().toISOString();
    const thresholdStr = thresholdStroops.toString();

    // Fast-fail: if balance < threshold, circuit would reject
    if (balanceStroops < thresholdStroops) {
        return {
            available: false,
            reason: "Insufficient balance for eligibility proof",
            tokenSymbol,
            threshold: thresholdStr,
            generatedAt,
            durationMs: Date.now() - startedAt,
        };
    }

    try {
        // 1. Compute inputs
        const salt = generateRandomSalt();
        const addressHash = await hashAddressToBigInt(userAddress);
        const poseidonHash = await buildPoseidonHasher();
        const commitment = poseidonHash([addressHash, balanceStroops, salt]);

        // 2. Generate Groth16 proof via snarkjs
        // @ts-ignore - snarkjs lacks full TypeScript declarations
        const snarkjs = (typeof window !== "undefined" && (window as any).snarkjs) || await import("snarkjs");

        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            {
                tier_id: thresholdStr,
                commitment_expected: commitment.toString(),
                address_hash: addressHash.toString(),
                balance: balanceStroops.toString(),
                salt: salt.toString(),
            },
            CIRCUIT_WASM_PATH,
            PROVING_KEY_PATH,
        );

        // 3. Optionally verify locally
        let locallyVerified = false;
        try {
            const vkeyResponse = await fetch(VKEY_PATH);
            const vkey = await vkeyResponse.json();
            locallyVerified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        } catch {
            // Non-fatal: verification is a debug aid, not a gate
        }

        const addressHashHex = (await sha256Hex(userAddress)).slice(0, 16);

        return {
            available: true,
            proofJson: proof,
            publicSignals,
            commitment: commitment.toString(),
            threshold: thresholdStr,
            tokenSymbol,
            addressHashHex,
            locallyVerified,
            generatedAt,
            durationMs: Date.now() - startedAt,
        };
    } catch (err) {
        return {
            available: false,
            reason: err instanceof Error ? err.message : String(err),
            tokenSymbol,
            threshold: thresholdStr,
            generatedAt,
            durationMs: Date.now() - startedAt,
        };
    }
}

/**
 * Verify an existing ZK eligibility proof locally.
 * Returns false if verification fails or infrastructure is unavailable.
 */
export async function verifyZkEligibilityProofLocally(
    attachment: ZkEligibilityAttachment,
): Promise<boolean> {
    if (!attachment.available) return false;

    try {
        // @ts-ignore
        const snarkjs = (typeof window !== "undefined" && (window as any).snarkjs) || await import("snarkjs");
        const vkeyResponse = await fetch(VKEY_PATH);
        const vkey = await vkeyResponse.json();
        return await snarkjs.groth16.verify(vkey, attachment.publicSignals, attachment.proofJson);
    } catch {
        return false;
    }
}

/**
 * Create a redacted summary of a ZK eligibility attachment for display.
 */
export function summarizeZkEligibility(attachment: ZkEligibilityAttachment): Record<string, unknown> {
    if (!attachment.available) {
        return {
            zkEligibility: "skipped",
            reason: attachment.reason,
            tokenSymbol: attachment.tokenSymbol,
            threshold: attachment.threshold,
            durationMs: attachment.durationMs,
        };
    }

    return {
        zkEligibility: "proven",
        protocol: "groth16",
        curve: "bn254",
        circuit: "kale_tier (balance >= threshold)",
        tokenSymbol: attachment.tokenSymbol,
        threshold: attachment.threshold,
        commitmentTruncated: attachment.commitment.slice(0, 16) + "...",
        addressHashHex: attachment.addressHashHex,
        locallyVerified: attachment.locallyVerified,
        publicInputCount: attachment.publicSignals.length,
        durationMs: attachment.durationMs,
    };
}
