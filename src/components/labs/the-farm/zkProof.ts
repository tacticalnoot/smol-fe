/**
 * Real ZK Proof Generation — Browser-side Groth16 proof generation using snarkjs.
 *
 * This module provides the REAL proof generation path for Proof of Farm tier verification.
 * It uses snarkjs to generate Groth16 proofs that can be verified on-chain via Protocol 25.
 *
 * ## Architecture
 * 1. Browser loads circuit WASM + proving key
 * 2. User provides private inputs (balance, salt)
 * 3. snarkjs generates witness → proof
 * 4. Proof is submitted to Soroban verifier contract
 *
 * ## Files Required (in /public/zk/)
 * - tier_proof.wasm     — Compiled circuit
 * - tier_proof.zkey     — Proving key
 * - verification_key.json — For local verification debug
 */

// @ts-ignore - snarkjs is loaded from CDN or bundled
import * as snarkjs from "snarkjs";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Poseidon Hash (matches circuit)
// ============================================================================

// TODO: Import actual Poseidon implementation
// For now, this is a placeholder that will be replaced with circomlibjs
async function poseidonHash(inputs: bigint[]): Promise<bigint> {
    // This needs circomlibjs or a compatible Poseidon implementation
    // The hash must match the circuit's Poseidon(3) template
    // @ts-ignore - circomlibjs lacks TypeScript declarations
    const { buildPoseidon } = await import("circomlibjs");
    const poseidon = await buildPoseidon();
    const hash = poseidon.F.toString(poseidon(inputs));
    return BigInt(hash);
}

// ============================================================================
// Proof Generation
// ============================================================================

const CIRCUIT_WASM_PATH = "/zk/tier_proof.wasm";
const PROVING_KEY_PATH = "/zk/tier_proof.zkey";

/**
 * Generate a Groth16 proof for tier verification.
 *
 * @param addressHash - Hash of user's Stellar address (as bigint string)
 * @param balance - KALE balance in stroops (as bigint string)
 * @param salt - Random salt (as bigint string)
 * @param tierId - Claimed tier (0-3)
 * @returns Proof and public signals
 */
export async function generateTierProof(
    addressHash: bigint,
    balance: bigint,
    salt: bigint,
    tierId: number,
): Promise<ProofResult> {
    // 1. Compute the commitment that the circuit will verify
    const commitment = await poseidonHash([addressHash, balance, salt]);

    // 2. Prepare inputs for the circuit
    const inputs: TierProofInputs = {
        tier_id: tierId.toString(),
        commitment_expected: commitment.toString(),
        address_hash: addressHash.toString(),
        balance: balance.toString(),
        salt: salt.toString(),
    };

    // 3. Generate the proof
    console.log("[ZK] Generating Groth16 proof...", { tierId, commitment: commitment.toString() });

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        inputs,
        CIRCUIT_WASM_PATH,
        PROVING_KEY_PATH,
    );

    console.log("[ZK] Proof generated successfully");

    return {
        proof: proof as Groth16Proof,
        publicSignals,
    };
}

/**
 * Verify a proof locally (for debugging).
 * In production, verification happens on-chain.
 */
export async function verifyProofLocally(
    proof: Groth16Proof,
    publicSignals: string[],
): Promise<boolean> {
    const vkeyResponse = await fetch("/zk/verification_key.json");
    const vkey = await vkeyResponse.json();
    return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a cryptographically secure random salt.
 */
export function generateRandomSalt(): bigint {
    const bytes = crypto.getRandomValues(new Uint8Array(31)); // 248 bits, fits in Fr
    let salt = 0n;
    for (const b of bytes) {
        salt = (salt << 8n) | BigInt(b);
    }
    return salt;
}

/**
 * Hash a Stellar address to a field element for the circuit.
 */
export async function hashAddress(stellarAddress: string): Promise<bigint> {
    const encoder = new TextEncoder();
    const data = encoder.encode(stellarAddress);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    // Take first 31 bytes to fit in BN254 field
    let hash = 0n;
    for (let i = 0; i < 31; i++) {
        hash = (hash << 8n) | BigInt(hashArray[i]);
    }
    return hash;
}

/**
 * Convert a Groth16 proof to bytes for Soroban contract submission.
 */
export function proofToBytes(proof: Groth16Proof): Uint8Array {
    // Serialize proof points for contract
    // Format: [pi_a (2 * 32 bytes), pi_b (2 * 2 * 32 bytes), pi_c (2 * 32 bytes)]
    const buffer = new ArrayBuffer(256);
    const view = new DataView(buffer);

    // This is a simplified serialization - actual format depends on curve
    // In production, use proper BN254 point serialization
    let offset = 0;

    // pi_a (G1 point: x, y)
    for (const coord of proof.pi_a.slice(0, 2)) {
        const bigint = BigInt(coord);
        for (let i = 31; i >= 0; i--) {
            view.setUint8(offset++, Number((bigint >> BigInt(i * 8)) & 0xffn));
        }
    }

    // pi_b (G2 point: x0, x1, y0, y1)
    for (const pair of proof.pi_b.slice(0, 2)) {
        for (const coord of pair) {
            const bigint = BigInt(coord);
            for (let i = 31; i >= 0; i--) {
                view.setUint8(offset++, Number((bigint >> BigInt(i * 8)) & 0xffn));
            }
        }
    }

    // pi_c (G1 point: x, y)
    for (const coord of proof.pi_c.slice(0, 2)) {
        const bigint = BigInt(coord);
        for (let i = 31; i >= 0; i--) {
            view.setUint8(offset++, Number((bigint >> BigInt(i * 8)) & 0xffn));
        }
    }

    return new Uint8Array(buffer);
}

// ============================================================================
// Constants
// ============================================================================

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

// ============================================================================
// On-Chain Contract Integration
// ============================================================================

/** Mainnet contract ID for tier verifier */
export const TIER_VERIFIER_CONTRACT_ID = "CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO";

/**
 * Submit a ZK proof attestation to the mainnet contract.
 * 
 * @param farmerAddress - The farmer's Stellar address
 * @param tierId - The tier being claimed (0-3)
 * @param commitment - The Poseidon commitment (32 bytes)
 * @param proofHash - Hash of the proof for verification
 * @returns Transaction result
 */
export async function submitProofToContract(
    kit: any, // PasskeyKit instance
    farmerAddress: string,
    tierId: number,
    commitment: Uint8Array,
    proofHash: Uint8Array,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        console.log("[ZK] Submitting attestation to mainnet contract...", {
            contract: TIER_VERIFIER_CONTRACT_ID,
            farmer: farmerAddress,
            tier: tierId,
        });

        // Import Stellar SDK
        const { Contract, Address, xdr, nativeToScVal } = await import("@stellar/stellar-sdk");

        // Build the contract call
        const contract = new Contract(TIER_VERIFIER_CONTRACT_ID);

        const tx = contract.call(
            "attest_tier",
            nativeToScVal(Address.fromString(farmerAddress), { type: "address" }),
            nativeToScVal(tierId, { type: "u32" }),
            nativeToScVal(commitment, { type: "bytes" }),
            nativeToScVal(proofHash, { type: "bytes" }),
        );

        // Sign and submit via passkey
        const result = await kit.send(tx);

        console.log("[ZK] Attestation submitted!", result);

        return {
            success: true,
            txHash: result.hash,
        };
    } catch (error: any) {
        console.error("[ZK] Failed to submit attestation:", error);
        return {
            success: false,
            error: error.message || "Unknown error",
        };
    }
}

/**
 * Hash a proof to a 32-byte value for on-chain storage.
 */
export async function hashProof(proof: Groth16Proof): Promise<Uint8Array> {
    const proofBytes = proofToBytes(proof);
    // Create a copy as ArrayBuffer to satisfy crypto.subtle
    const buffer = proofBytes.buffer.slice(
        proofBytes.byteOffset,
        proofBytes.byteOffset + proofBytes.byteLength
    ) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return new Uint8Array(hashBuffer);
}
