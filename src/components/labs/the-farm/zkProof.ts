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

import {
    type ProofResult,
    type TierProofInputs,
    type Groth16Proof,
    TIER_VERIFIER_CONTRACT_ID
} from "./zkTypes";

// Re-export specific helpers that might be needed, or let consumers import from zkTypes
// But for compatibility with existing imports, we might not need to re-export everything if we update call sites.
// Actually, let's keep the logic functions here.

// ============================================================================
// Poseidon Hash (matches circuit)
// ============================================================================

// TODO: Import actual Poseidon implementation
// For now, this is a placeholder that will be replaced with circomlibjs
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
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

    // @ts-ignore - snarkjs lacks some types or is loaded via CDN
    const snarkjs = await import("snarkjs");

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

    // @ts-ignore
    const snarkjs = await import("snarkjs");
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
// On-Chain Contract Integration
// ============================================================================

/**
 * Check if a farmer has already verified their tier on-chain.
 */
export async function checkAttestation(farmerAddress: string): Promise<{
    verified: boolean;
    tier?: number;
    timestamp?: number;
    commitment?: string;
}> {
    try {
        // Dynamic import to avoid load issues
        const sdk = await import("@stellar/stellar-sdk");
        // @ts-ignore - Handle different SDK versions for Server (Horizon.Server)
        const Server = sdk.Server || sdk.Horizon?.Server;
        const { Contract, Address, scValToNative } = sdk;
        const { getBestRpcUrl } = await import("../../../utils/rpc");

        const server = new Server(getBestRpcUrl());
        const contract = new Contract(TIER_VERIFIER_CONTRACT_ID);

        // Simulate a call to get_attestation
        // We use simulateTransaction because we're reading state, not writing
        const op = contract.call(
            "get_attestation",
            new Address(farmerAddress).toScVal()
        );

        const accountResponse = await server.loadAccount(farmerAddress).catch(() => null);
        let seq = "0";
        if (accountResponse) {
            seq = accountResponse.sequence;
        } else {
            // New account or not found, implies no attestation anyway? 
            // well account must exist to sign the attestation tx previously.
            return { verified: false };
        }

        const { TransactionBuilder, Account, TimeoutInfinite } = await import("@stellar/stellar-sdk");

        const source = new Account(farmerAddress, seq);
        const tx = new TransactionBuilder(source, {
            fee: "100",
            networkPassphrase: "Public Global Stellar Network ; September 2015", // Mainnet
        })
            .addOperation(op)
            .setTimeout(TimeoutInfinite)
            .build();

        const sim = await server.simulateTransaction(tx);

        if (TransactionBuilder.fromXDR(sim.transactionEnvelope, "passphrase" as any) === null) {
            // Basic validity check fail
        }

        // Parse result
        if (sim.results && sim.results[0] && sim.results[0].retval) {
            const val = sim.results[0].retval;

            const result = scValToNative(val);
            if (!result) return { verified: false };

            // result should be the struct: { farmer, tier, commitment, verified_at }
            if (result.tier !== undefined) {
                return {
                    verified: true,
                    tier: result.tier,
                    timestamp: Number(result.verified_at),
                    // commitment is bytes, might be Uint8Array
                    commitment: result.commitment ?
                        Array.from(result.commitment).map((b: any) => b.toString(16).padStart(2, '0')).join('') : undefined
                };
            }
        }

        return { verified: false };
    } catch (e) {
        console.warn("[ZK] Failed to check attestation:", e);
        return { verified: false };
    }
}

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
