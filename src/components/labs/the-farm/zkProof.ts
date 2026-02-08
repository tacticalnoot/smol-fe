/**
 * Real ZK Proof Generation — Browser-side Groth16 proof generation using snarkjs.
 *
 * This module provides the REAL proof generation path for Proof of Farm tier verification.
 * It uses snarkjs to generate Groth16 proofs that can be verified on-chain via Protocol 25
 * BN254 host functions (CAP-0074).
 *
 * ## Architecture
 * 1. Browser loads circuit WASM + proving key from /public/zk/
 * 2. User provides private inputs (balance, salt)
 * 3. snarkjs generates Groth16 witness + proof
 * 4. Proof is serialized to BN254 uncompressed point format
 * 5. Proof is submitted to Soroban tier-verifier contract for on-chain pairing check
 *
 * ## Files Required (in /public/zk/)
 * - tier_proof.wasm     — Compiled circuit (circom 2.1.0)
 * - tier_proof.zkey     — Proving key (Groth16 BN254)
 * - verification_key.json — Verification key (for local verification debug)
 */

import {
    type ProofResult,
    type TierProofInputs,
    type Groth16Proof,
    TIER_VERIFIER_CONTRACT_ID,
} from "./zkTypes";

// ============================================================================
// Poseidon Hash (matches circuit's Poseidon(3) template)
// ============================================================================

export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
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
 * @param addressHash - Hash of user's Stellar address (field element)
 * @param balance - KALE balance in stroops
 * @param salt - Random salt (field element)
 * @param tierId - Claimed tier (0-3)
 * @returns Proof and public signals
 */
export async function generateTierProof(
    addressHash: bigint,
    balance: bigint,
    salt: bigint,
    tierId: number,
): Promise<ProofResult> {
    // 1. Compute the Poseidon commitment that the circuit will verify
    const commitment = await poseidonHash([addressHash, balance, salt]);

    // 2. Prepare inputs for the circuit
    const inputs: TierProofInputs = {
        tier_id: tierId.toString(),
        commitment_expected: commitment.toString(),
        address_hash: addressHash.toString(),
        balance: balance.toString(),
        salt: salt.toString(),
    };

    // 3. Generate the proof via snarkjs
    console.log("[ZK] Generating Groth16 proof...", { tierId, commitment: commitment.toString() });

    // @ts-ignore - snarkjs types
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
 * Verify a proof locally using the verification key (for debugging).
 * In production, verification happens on-chain via the tier-verifier contract.
 */
export async function verifyProofLocally(
    proof: Groth16Proof,
    publicSignals: string[],
): Promise<boolean> {
    const vkeyResponse = await fetch("/zk/verification_key.json");
    const vkey = await vkeyResponse.json();

    // @ts-ignore - snarkjs types
    const snarkjs = await import("snarkjs");
    return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a cryptographically secure random salt that fits in BN254 Fr.
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
 * Takes first 31 bytes of SHA-256 to fit in BN254 scalar field.
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

// ============================================================================
// BN254 Point Serialization (Protocol 25 / CAP-0074 format)
// ============================================================================

/**
 * Serialize a bigint to a 32-byte big-endian Uint8Array.
 */
function bigintToBytes32(value: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let v = value;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

/**
 * Serialize a G1 point (x, y) to 64 bytes uncompressed BN254 format.
 * Format: be_encode(X) || be_encode(Y), 32 bytes each.
 * snarkjs pi_a format: [x, y, "1"] — third element is projective z-coord.
 */
export function serializeG1(point: string[]): Uint8Array {
    const x = BigInt(point[0]);
    const y = BigInt(point[1]);
    const result = new Uint8Array(64);
    result.set(bigintToBytes32(x), 0);
    result.set(bigintToBytes32(y), 32);
    return result;
}

/**
 * Serialize a G2 point to 128 bytes uncompressed BN254 format.
 * snarkjs pi_b format: [[x_c1, x_c0], [y_c1, y_c0], ["1","0"]]
 *
 * CAP-0074 G2 encoding: be_encode(X_c1) || be_encode(X_c0) || be_encode(Y_c1) || be_encode(Y_c0)
 */
export function serializeG2(point: string[][]): Uint8Array {
    const x_c1 = BigInt(point[0][0]);
    const x_c0 = BigInt(point[0][1]);
    const y_c1 = BigInt(point[1][0]);
    const y_c0 = BigInt(point[1][1]);
    const result = new Uint8Array(128);
    result.set(bigintToBytes32(x_c1), 0);
    result.set(bigintToBytes32(x_c0), 32);
    result.set(bigintToBytes32(y_c1), 64);
    result.set(bigintToBytes32(y_c0), 96);
    return result;
}

/**
 * Serialize a full Groth16 proof to separate byte arrays for the Soroban contract.
 * Returns { pi_a: 64 bytes, pi_b: 128 bytes, pi_c: 64 bytes }.
 */
export function serializeProof(proof: Groth16Proof): {
    pi_a: Uint8Array;
    pi_b: Uint8Array;
    pi_c: Uint8Array;
} {
    return {
        pi_a: serializeG1(proof.pi_a),
        pi_b: serializeG2(proof.pi_b),
        pi_c: serializeG1(proof.pi_c),
    };
}

/**
 * Legacy: Convert a Groth16 proof to a flat 256-byte buffer.
 * Kept for compatibility with hashProof().
 */
export function proofToBytes(proof: Groth16Proof): Uint8Array {
    const { pi_a, pi_b, pi_c } = serializeProof(proof);
    const result = new Uint8Array(256);
    result.set(pi_a, 0);
    result.set(pi_b, 64);
    result.set(pi_c, 192);
    return result;
}

// ============================================================================
// On-Chain Contract Integration
// ============================================================================

const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/**
 * Check if a farmer has already verified their tier on-chain.
 * Uses Soroban RPC simulateTransaction to read contract state.
 */
export async function checkAttestation(farmerAddress: string): Promise<{
    verified: boolean;
    tier?: number;
    timestamp?: number;
    commitment?: string;
}> {
    try {
        const { rpc, Address, Contract, TransactionBuilder, scValToNative } =
            await import("@stellar/stellar-sdk/minimal");
        const { getBestRpcUrl } = await import("../../../utils/rpc");

        const server = new rpc.Server(getBestRpcUrl());
        const contractObj = new Contract(TIER_VERIFIER_CONTRACT_ID);

        // Build read-only call to get_attestation
        const op = contractObj.call(
            "get_attestation",
            new Address(farmerAddress).toScVal(),
        );

        // We need a source account to build the tx for simulation
        const accountResponse = await server.getAccount(farmerAddress).catch(() => null);
        if (!accountResponse) {
            return { verified: false };
        }

        const tx = new TransactionBuilder(accountResponse, {
            fee: "100",
            networkPassphrase: MAINNET_PASSPHRASE,
        })
            .addOperation(op)
            .setTimeout(30)
            .build();

        const sim = await server.simulateTransaction(tx);

        // Check for successful simulation with result
        if (
            rpc.Api.isSimulationSuccess(sim) &&
            sim.result?.retval
        ) {
            const result = scValToNative(sim.result.retval);
            if (!result) return { verified: false };

            if (result.tier !== undefined) {
                return {
                    verified: true,
                    tier: result.tier,
                    timestamp: Number(result.verified_at),
                    commitment: result.commitment
                        ? Array.from(result.commitment as Uint8Array)
                            .map((b: number) => b.toString(16).padStart(2, "0"))
                            .join("")
                        : undefined,
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
 * Submit a Groth16 ZK proof to the tier-verifier contract for on-chain verification.
 *
 * Calls verify_and_attest which performs the full Groth16 pairing check using
 * Protocol 25 BN254 host functions before storing the attestation.
 *
 * Falls back to legacy attest_tier if the contract hasn't been upgraded yet.
 */
export async function submitProofToContract(
    kit: any, // PasskeyKit instance
    farmerAddress: string,
    tierId: number,
    commitment: Uint8Array,
    proof: Groth16Proof,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        console.log("[ZK] Submitting proof to mainnet contract for on-chain verification...", {
            contract: TIER_VERIFIER_CONTRACT_ID,
            farmer: farmerAddress,
            tier: tierId,
        });

        const { Contract, Address, nativeToScVal, xdr, TransactionBuilder, rpc, Account, Networks } = await import("@stellar/stellar-sdk/minimal");
        const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
        const { send } = await import("../../../utils/passkey-kit");
        const { withRetry } = await import("../../../utils/retry");
        const { getBestRpcUrl } = await import("../../../utils/rpc");
        const { getSafeRpId } = await import("../../../utils/domains");
        const { getLatestSequence } = await import("../../../utils/base");

        const server = new rpc.Server(getBestRpcUrl());
        const contractObj = new Contract(TIER_VERIFIER_CONTRACT_ID);
        const { pi_a, pi_b, pi_c } = serializeProof(proof);

        // Build the Groth16Proof struct for the contract
        const proofStruct = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("pi_a"),
                val: nativeToScVal(Buffer.from(pi_a), { type: "bytes" }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("pi_b"),
                val: nativeToScVal(Buffer.from(pi_b), { type: "bytes" }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("pi_c"),
                val: nativeToScVal(Buffer.from(pi_c), { type: "bytes" }),
            }),
        ]);

        // Call verify_and_attest with the real proof
        const op = contractObj.call(
            "verify_and_attest",
            new Address(farmerAddress).toScVal(),
            nativeToScVal(tierId, { type: "u32" }),
            nativeToScVal(Buffer.from(commitment), { type: "bytes" }),
            proofStruct,
        );

        // Build transaction using NULL_ACCOUNT (smart wallet contract IDs can't use getAccount)
        const sourceAccount = new Account(NULL_ACCOUNT, "0");
        const tx = new TransactionBuilder(sourceAccount, {
            fee: "10000000", // 1 XLM max
            networkPassphrase: Networks.PUBLIC,
        })
            .addOperation(op)
            .setTimeout(300)
            .build();

        // Simulate to get sorobanData
        const sim = await server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(sim)) {
            throw new Error("Simulation failed: " + JSON.stringify(sim));
        }

        // Prepare transaction with simulation data
        const preparedTx = rpc.assembleTransaction(tx, sim).build();

        // Sign with PasskeyKit
        const rpId = getSafeRpId(window.location.hostname);
        const sequence = await getLatestSequence();

        const signedTx = await kit.sign(preparedTx, {
            rpId,
            keyId: kit.wallet?.keyId,
            expiration: sequence + 60,
        });

        // Send via relayer with retry
        const result = await withRetry(
            () => send(signedTx),
            {
                maxRetries: 8, // Increased from 5
                baseDelayMs: 3000, // Increased from 2000
                backoffFactor: 1.5, // Slower backoff
                onRetry: (attempt, _err, delay) => {
                    console.log(`[ZK] Relayer retry ${attempt}/8 in ${delay}ms...`);
                },
            },
            "ZK-ProofSubmit"
        );

        console.log("[ZK] Proof verified and attestation stored on-chain!", result);

        return {
            success: true,
            txHash: result.hash || result.transactionHash,
        };
    } catch (error: any) {
        // If verify_and_attest is not available (pre-upgrade), fall back to legacy
        if (error.message?.includes("verify_and_attest") || error.message?.includes("not found")) {
            console.warn("[ZK] verify_and_attest not available, falling back to legacy attest_tier");
            return submitLegacyAttestation(kit, farmerAddress, tierId, commitment, proof);
        }

        console.error("[ZK] Failed to submit proof:", error);
        return {
            success: false,
            error: error.message || "Unknown error",
        };
    }
}

/**
 * Legacy attestation path — stores proof hash only (no on-chain verification).
 * Used when the contract hasn't been upgraded to Protocol 25 yet.
 */
async function submitLegacyAttestation(
    kit: any,
    farmerAddress: string,
    tierId: number,
    commitment: Uint8Array,
    proof: Groth16Proof,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        const { Contract, Address, nativeToScVal, TransactionBuilder, rpc, Account, Networks } = await import("@stellar/stellar-sdk/minimal");
        const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
        const { send } = await import("../../../utils/passkey-kit");
        const { withRetry } = await import("../../../utils/retry");
        const { getBestRpcUrl } = await import("../../../utils/rpc");
        const { getSafeRpId } = await import("../../../utils/domains");
        const { getLatestSequence } = await import("../../../utils/base");

        const server = new rpc.Server(getBestRpcUrl());
        const contractObj = new Contract(TIER_VERIFIER_CONTRACT_ID);

        // Hash the proof for on-chain storage
        const proofHash = await hashProof(proof);

        const op = contractObj.call(
            "attest_tier",
            new Address(farmerAddress).toScVal(),
            nativeToScVal(tierId, { type: "u32" }),
            nativeToScVal(Buffer.from(commitment), { type: "bytes" }),
            nativeToScVal(Buffer.from(proofHash), { type: "bytes" }),
        );

        // Build transaction using NULL_ACCOUNT (smart wallet contract IDs can't use getAccount)
        const sourceAccount = new Account(NULL_ACCOUNT, "0");
        const tx = new TransactionBuilder(sourceAccount, {
            fee: "10000000", // 1 XLM max
            networkPassphrase: Networks.PUBLIC,
        })
            .addOperation(op)
            .setTimeout(300)
            .build();

        // Simulate to get sorobanData
        const sim = await server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(sim)) {
            throw new Error("Simulation failed: " + JSON.stringify(sim));
        }

        // Prepare transaction with simulation data
        const preparedTx = rpc.assembleTransaction(tx, sim).build();

        // Sign with PasskeyKit
        const rpId = getSafeRpId(window.location.hostname);
        const sequence = await getLatestSequence();

        const signedTx = await kit.sign(preparedTx, {
            rpId,
            keyId: kit.wallet?.keyId,
            expiration: sequence + 60,
        });

        // Send via relayer with retry
        const result = await withRetry(
            () => send(signedTx),
            {
                maxRetries: 8,
                baseDelayMs: 3000,
                backoffFactor: 1.5,
                onRetry: (attempt, _err, delay) => {
                    console.log(`[ZK] Legacy attestation retry ${attempt}/8 in ${delay}ms...`);
                },
            },
            "ZK-LegacyAttest"
        );

        console.log("[ZK] Legacy attestation submitted!", result);

        return {
            success: true,
            txHash: result.hash || result.transactionHash,
        };
    } catch (error: any) {
        console.error("[ZK] Failed to submit legacy attestation:", error);
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
    const buffer = proofBytes.buffer.slice(
        proofBytes.byteOffset,
        proofBytes.byteOffset + proofBytes.byteLength,
    ) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return new Uint8Array(hashBuffer);
}
