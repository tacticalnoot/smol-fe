/**
 * Discombobulator Commitment Key — ZK Cash Scheme for Stellar
 *
 * ⚠️  PRE-ALPHA / RESEARCH / VIBECODED — READ BEFORE USING ⚠️
 *
 * This module implements a ZK commitment-note scheme for Stellar private
 * payments research. It is inspired by privacy-preserving systems (think
 * ZK cash) and demonstrates the concept on Stellar/Soroban.
 *
 * HOW IT WORKS (the real deal):
 *   1. DEPOSIT: Caller generates a commitment key for a given amount + token.
 *      The key encodes a random secret and nullifier. The commitment
 *      Poseidon(secret, amount, nullifier) is stored with the pool entry.
 *      No recipient address is specified at this stage.
 *
 *   2. WITHDRAWAL: Whoever holds the key can later prove knowledge of
 *      (secret, nullifier) matching the on-chain commitment, then specify
 *      ANY recipient wallet. This module computes a recipient hash for
 *      tooling/debugging, but PR #117 contract verification currently
 *      does not enforce recipient binding on-chain.
 *
 *   3. ZK PROOF: Uses the existing kale_tier Groth16 circuit (BN254 / Poseidon)
 *      to prove: balance >= tier_id AND Poseidon(address_hash, balance, salt)
 *      == commitment_expected — with private inputs staying private.
 *
 * WHAT THIS IS NOT (yet):
 *   - There is no on-chain Soroban contract enforcing withdrawal rights today.
 *     This is a client-side research prototype showing the cryptographic layer
 *     works correctly. On-chain enforcement is the next step.
 *   - Not audited. Not battle-tested. Pre-alpha research.
 *   - Do not use with funds you cannot afford to lose.
 *   - This does NOT provide anonymity-set privacy guarantees.
 *
 * The cryptographic primitives (Poseidon hash, Groth16 proof) are the same
 * ones used in production ZK systems. The ZK math is real. The on-chain
 * settlement layer is the part still being built.
 */

import { sha256Hex, stableStringify } from "./discombobulator-spp";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMITMENT_KEY_VERSION = "dck-v1" as const;
export const WITHDRAWAL_STATEMENT_VERSION = "dck-statement-v1" as const;

const CIRCUIT_WASM_PATH = `/zk/tier_proof.wasm?v=discombo-v1`;
const PROVING_KEY_PATH = `/zk/tier_proof.zkey?v=discombo-v1`;
const VKEY_PATH = `/zk/verification_key.json?v=discombo-v1`;

const DISCLAIMER =
    "PRE-ALPHA RESEARCH PROTOTYPE. Bearer-note risk: anyone with the ticket can withdraw. " +
    "Not audited. No anonymity-set guarantees. Do not use funds you cannot afford to lose.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A commitment key note — the secret that authorizes withdrawal.
 *
 * Treat this like cash: whoever holds it can generate a withdrawal proof.
 * Back it up. Do not share it unless you intend to transfer withdrawal rights.
 */
export interface CommitmentKeyNote {
    version: typeof COMMITMENT_KEY_VERSION;
    /** Hex-encoded bigint — private input mapped to address_hash in circuit */
    secret: string;
    /** Hex-encoded bigint — private input mapped to salt in circuit */
    nullifier: string;
    /** Poseidon(secret_bigint, amountStroops_bigint, nullifier_bigint) as decimal string */
    commitment: string;
    tokenSymbol: string;
    /** Amount in stroops (1 XLM = 10_000_000 stroops), stored as string */
    amountStroops: string;
    /** Pool entry this key was generated for, if any */
    poolEntryId: string | null;
    createdAt: string;
    disclaimer: string;
}

/**
 * The result of generating a withdrawal proof for a commitment key.
 *
 * In a full on-chain system this proof would be submitted to a Soroban
 * contract which verifies it and releases the funds to recipientAddress.
 * Today it is verified client-side only.
 *
 * CONTRACT ALIGNMENT FIELDS (for when the CommitmentPool contract is deployed):
 *   - commitmentBytes32Hex  → pass as `commitment` arg to `deposit()`
 *   - nullifierHashHex      → pass as `nullifier_hash` arg to `withdraw()`
 */
export interface WithdrawalProofArtifact {
    note: CommitmentKeyNote;
    /** Destination wallet — specified at withdrawal time, not at deposit time */
    recipientAddress: string;
    /** sha256(recipientAddress) for client-side traceability; not currently enforced on-chain in PR #117 */
    recipientAddressHash: string;
    /** sha256(token identity string), used for statement-hardening metadata */
    tokenIdHash: string;
    /** Domain separation tag for statement-hardening metadata */
    domainTag: string;
    /** Explicit statement schema version for downstream verifiers */
    statementVersion: typeof WITHDRAWAL_STATEMENT_VERSION;
    /** Ordered public inputs for hardened statement schema planning */
    statementPublicInputs: string[];
    /** Groth16 proof object if circuit was available, null otherwise */
    zkProof: object | null;
    publicSignals: string[] | null;
    locallyVerified: boolean;
    /**
     * "groth16_circuit" — full ZK proof using the kale_tier Groth16 circuit.
     * "poseidon_only"   — Poseidon commitment re-verification without a ZK proof
     *                     (circuit artifacts unavailable in this environment).
     */
    proofMode: "groth16_circuit" | "poseidon_only";
    commitmentValid: boolean;
    /**
     * The Poseidon commitment encoded as 32-byte big-endian hex.
     * This is the exact value to pass as `commitment: BytesN<32>` in the
     * CommitmentPool Soroban contract's `deposit()` function.
     *
     * Encoding: bigint(note.commitment) → 32 bytes big-endian → hex string (64 chars).
     */
    commitmentBytes32Hex: string;
    /**
     * SHA-256 of the nullifier hex string, encoded as 32-byte hex.
     * This is the exact value to pass as `nullifier_hash: BytesN<32>` in the
     * CommitmentPool Soroban contract's `withdraw()` function.
     *
     * Encoding: sha256(note.nullifier) → hex string (64 chars).
     * The contract stores this to prevent double-spending the same note.
     */
    nullifierHashHex: string;
    generatedAt: string;
    durationMs: number;
    disclaimer: string;
}

export interface WithdrawalStatementContext {
    networkPassphrase?: string;
    contractId?: string;
    poolId?: string;
    tokenIdentity?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors discombobulator-zk-eligibility.ts)
// ---------------------------------------------------------------------------

function generateRandomBigInt31Bytes(): bigint {
    const bytes = new Uint8Array(31); // < BN254 field size
    globalThis.crypto.getRandomValues(bytes);
    let result = 0n;
    for (const byte of bytes) {
        result = (result << 8n) | BigInt(byte);
    }
    return result;
}

function bigIntToHex(n: bigint): string {
    return n.toString(16).padStart(62, "0");
}

function hexToBigInt(hex: string): bigint {
    return BigInt("0x" + hex);
}

async function buildPoseidonHasher(): Promise<(inputs: bigint[]) => bigint> {
    // @ts-ignore — circomlibjs lacks full TypeScript declarations
    const { buildPoseidon } = await import("circomlibjs");
    const poseidon = await buildPoseidon();
    return (inputs: bigint[]) => {
        const raw = poseidon(inputs);
        return BigInt(poseidon.F.toString(raw));
    };
}

// ---------------------------------------------------------------------------
// Contract-alignment helpers
// ---------------------------------------------------------------------------

/**
 * Encode a Poseidon commitment (decimal string) as a 32-byte big-endian
 * Uint8Array, matching the `BytesN<32>` type expected by the CommitmentPool
 * Soroban contract's `deposit(commitment)` argument.
 *
 * The Poseidon field element fits in < 32 bytes (BN254 prime < 2^254), so
 * big-endian encoding into 32 bytes is always lossless.
 */
export function commitmentToBytes32(commitmentDecimal: string): Uint8Array {
    const n = BigInt(commitmentDecimal);
    const arr = new Uint8Array(32);
    let tmp = n;
    for (let i = 31; i >= 0; i--) {
        arr[i] = Number(tmp & 0xffn);
        tmp >>= 8n;
    }
    return arr;
}

/**
 * Convert a Uint8Array to a lowercase hex string (no "0x" prefix).
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Compute the nullifier hash for a commitment key note.
 *
 * This is sha256(note.nullifier) — a 64-char hex string representing 32 bytes.
 * Pass this as `nullifier_hash: BytesN<32>` to the CommitmentPool contract's
 * `withdraw()` function. The contract records this hash to prevent the same
 * note from being spent twice (double-spend prevention).
 *
 * The nullifier itself (the secret random value) is NEVER sent on-chain.
 * Only its hash is revealed at withdrawal time.
 */
export async function computeNullifierHash(
    note: CommitmentKeyNote,
): Promise<string> {
    // sha256 of the hex-encoded nullifier string
    return sha256Hex(note.nullifier);
}

export async function computeTokenIdHash(tokenIdentity: string): Promise<string> {
    return sha256Hex(tokenIdentity.trim().toUpperCase());
}

export async function computeDomainTag(
    context: WithdrawalStatementContext,
): Promise<string> {
    const payload = stableStringify({
        protocolVersion: COMMITMENT_KEY_VERSION,
        statementVersion: WITHDRAWAL_STATEMENT_VERSION,
        networkPassphrase: (context.networkPassphrase ?? "UNKNOWN_NETWORK").trim(),
        contractId: (context.contractId ?? "UNBOUND_CONTRACT").trim(),
        poolId: (context.poolId ?? "UNBOUND_POOL").trim(),
    });
    return sha256Hex(payload);
}

export async function buildWithdrawalStatementPublicInputs(
    note: CommitmentKeyNote,
    recipientAddress: string,
    context: WithdrawalStatementContext = {},
): Promise<string[]> {
    const commitmentBytes32Hex = bytesToHex(commitmentToBytes32(note.commitment));
    const nullifierHashHex = await computeNullifierHash(note);
    const tokenIdHash = await computeTokenIdHash(context.tokenIdentity ?? note.tokenSymbol);
    const recipientAddressHash = await sha256Hex(recipientAddress.trim());
    const domainTag = await computeDomainTag(context);
    const amountHex = BigInt(note.amountStroops).toString(16).padStart(64, "0");
    const statementVersionHash = await sha256Hex(WITHDRAWAL_STATEMENT_VERSION);
    return [
        commitmentBytes32Hex,
        nullifierHashHex,
        amountHex,
        tokenIdHash,
        recipientAddressHash,
        domainTag,
        statementVersionHash,
    ];
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Generate a fresh commitment key for a pool deposit.
 *
 * The returned note is the only thing that authorizes a future withdrawal.
 * Serialize it immediately (see serializeCommitmentKey) and store it safely.
 *
 * @param amountStroops  Deposit amount in stroops (bigint).
 * @param tokenSymbol    Token being deposited: "XLM" | "KALE" | "USDC".
 * @param poolEntryId    Optional pool entry ID to bind this key to.
 */
export async function generateCommitmentKey(
    amountStroops: bigint,
    tokenSymbol: string,
    poolEntryId?: string,
): Promise<CommitmentKeyNote> {
    if (amountStroops <= 0n) {
        throw new Error("Commitment key: amount must be greater than zero.");
    }

    // 1. Random secret and nullifier
    const secretBigInt = generateRandomBigInt31Bytes();
    const nullifierBigInt = generateRandomBigInt31Bytes();

    // 2. Poseidon commitment: the on-chain fingerprint
    const poseidon = await buildPoseidonHasher();
    const commitment = poseidon([secretBigInt, amountStroops, nullifierBigInt]);

    const note: CommitmentKeyNote = {
        version: COMMITMENT_KEY_VERSION,
        secret: bigIntToHex(secretBigInt),
        nullifier: bigIntToHex(nullifierBigInt),
        commitment: commitment.toString(),
        tokenSymbol,
        amountStroops: amountStroops.toString(),
        poolEntryId: poolEntryId ?? null,
        createdAt: new Date().toISOString(),
        disclaimer: DISCLAIMER,
    };

    return note;
}

/**
 * Serialize a commitment key note to a portable string.
 *
 * Format: `dck1:<base64url-json>:<8-char-sha256-checksum>`
 *
 * This string is what the user copies and stores. Losing it means losing
 * the ability to generate a withdrawal proof.
 */
export async function serializeCommitmentKey(
    note: CommitmentKeyNote,
): Promise<string> {
    const json = JSON.stringify(note);
    const b64 = btoa(json);
    const checksum = (await sha256Hex(b64)).slice(0, 8);
    return `dck1:${b64}:${checksum}`;
}

/**
 * Deserialize and validate a commitment key string.
 *
 * Throws a descriptive error if the format is wrong, the checksum fails,
 * or required fields are missing. Safe to call with untrusted input.
 */
export async function deserializeCommitmentKey(
    encoded: string,
): Promise<CommitmentKeyNote> {
    if (!encoded.startsWith("dck1:")) {
        throw new Error(
            'Invalid commitment key: must start with "dck1:". ' +
            'Did you copy the full key?',
        );
    }

    const parts = encoded.split(":");
    // format: dck1 : <b64> : <checksum>  — split gives ["dck1", b64, checksum]
    if (parts.length !== 3) {
        throw new Error(
            `Invalid commitment key: expected 3 colon-separated parts, got ${parts.length}.`,
        );
    }

    const [, b64, checksum] = parts;

    const expectedChecksum = (await sha256Hex(b64)).slice(0, 8);
    if (checksum !== expectedChecksum) {
        throw new Error(
            "Commitment key checksum mismatch — the key may be corrupted or truncated.",
        );
    }

    let raw: unknown;
    try {
        raw = JSON.parse(atob(b64));
    } catch {
        throw new Error("Commitment key could not be decoded — invalid base64 or JSON.");
    }

    if (!raw || typeof raw !== "object") {
        throw new Error("Commitment key decoded to a non-object value.");
    }

    const obj = raw as Record<string, unknown>;

    // Field validation
    const required = [
        "version", "secret", "nullifier", "commitment",
        "tokenSymbol", "amountStroops", "createdAt",
    ] as const;

    for (const field of required) {
        if (typeof obj[field] !== "string" || !(obj[field] as string).length) {
            throw new Error(`Commitment key missing or empty field: "${field}".`);
        }
    }

    if (obj.version !== COMMITMENT_KEY_VERSION) {
        throw new Error(
            `Unknown commitment key version "${obj.version}". ` +
            `This client supports "${COMMITMENT_KEY_VERSION}".`,
        );
    }

    return {
        version: COMMITMENT_KEY_VERSION,
        secret: obj.secret as string,
        nullifier: obj.nullifier as string,
        commitment: obj.commitment as string,
        tokenSymbol: obj.tokenSymbol as string,
        amountStroops: obj.amountStroops as string,
        poolEntryId: typeof obj.poolEntryId === "string" ? obj.poolEntryId : null,
        createdAt: obj.createdAt as string,
        disclaimer: typeof obj.disclaimer === "string" ? obj.disclaimer : DISCLAIMER,
    };
}

/**
 * Verify that a commitment key's Poseidon commitment is internally consistent.
 *
 * Recomputes Poseidon(secret, amountStroops, nullifier) and checks it matches
 * the stored commitment field. Returns { valid: false } if circomlibjs is
 * unavailable (e.g. server-side) rather than throwing.
 */
export async function verifyCommitmentKeyIntegrity(
    note: CommitmentKeyNote,
): Promise<{ valid: boolean; reason?: string }> {
    try {
        const secretBigInt = hexToBigInt(note.secret);
        const nullifierBigInt = hexToBigInt(note.nullifier);
        const amountBigInt = BigInt(note.amountStroops);

        const poseidon = await buildPoseidonHasher();
        const recomputed = poseidon([secretBigInt, amountBigInt, nullifierBigInt]);

        if (recomputed.toString() !== note.commitment) {
            return {
                valid: false,
                reason: "Commitment mismatch: Poseidon(secret, amount, nullifier) does not equal stored commitment.",
            };
        }

        return { valid: true };
    } catch (err) {
        return {
            valid: false,
            reason: err instanceof Error ? err.message : "Poseidon verification failed.",
        };
    }
}

/**
 * Generate a withdrawal proof for a commitment key.
 *
 * The proof demonstrates knowledge of (secret, nullifier) that produced the
 * on-chain commitment. It also computes recipientAddressHash for
 * client-side metadata and future statement-hardening work.
 *
 * Uses the existing kale_tier Groth16 circuit with input mapping:
 *   address_hash        = secret_bigint
 *   balance             = amountStroops_bigint
 *   salt                = nullifier_bigint
 *   tier_id             = amountStroops_bigint  (proves balance == amount)
 *   commitment_expected = commitment
 *
 * Falls back to Poseidon-only verification if the circuit WASM is not
 * available (Node.js environment, circuit files not served).
 *
 * In a full Soroban deployment this proof would be submitted to a verifier
 * contract which would release the escrowed funds to recipientAddress.
 *
 * @param note              The commitment key note.
 * @param recipientAddress  The Stellar address to receive the funds.
 */
export async function generateWithdrawalProof(
    note: CommitmentKeyNote,
    recipientAddress: string,
    context: WithdrawalStatementContext = {},
): Promise<WithdrawalProofArtifact> {
    const startedAt = Date.now();
    const generatedAt = new Date().toISOString();

    if (!recipientAddress || !recipientAddress.trim()) {
        throw new Error(
            "Withdrawal proof requires a recipient address.",
        );
    }

    // 1. Verify internal consistency of the note
    const integrity = await verifyCommitmentKeyIntegrity(note);
    if (!integrity.valid) {
        throw new Error(
            `Commitment key integrity check failed: ${integrity.reason}`,
        );
    }

    // 2. Compute recipient hash for metadata/debugging.
    //    IMPORTANT: PR #117 on-chain verifier inputs do not currently include this field.
    const recipientAddressHash = await sha256Hex(recipientAddress.trim());
    const tokenIdHash = await computeTokenIdHash(
        context.tokenIdentity ?? note.tokenSymbol,
    );
    const domainTag = await computeDomainTag(context);

    // 3a. Precompute contract-facing encodings (protocol alignment)
    //   - commitmentBytes32Hex: what goes into deposit(commitment) on-chain
    //   - nullifierHashHex:     what goes into withdraw(nullifier_hash) on-chain
    const commitmentBytes32Hex = bytesToHex(commitmentToBytes32(note.commitment));
    const nullifierHashHex = await computeNullifierHash(note);
    const statementPublicInputs = await buildWithdrawalStatementPublicInputs(
        note,
        recipientAddress,
        context,
    );

    const secretBigInt = hexToBigInt(note.secret);
    const nullifierBigInt = hexToBigInt(note.nullifier);
    const amountBigInt = BigInt(note.amountStroops);

    // 4. Attempt full Groth16 proof via existing kale_tier circuit
    let zkProof: object | null = null;
    let publicSignals: string[] | null = null;
    let locallyVerified = false;
    let proofMode: "groth16_circuit" | "poseidon_only" = "poseidon_only";

    try {
        // @ts-ignore — snarkjs lacks full TypeScript declarations
        const snarkjs =
            (typeof window !== "undefined" && (window as any).snarkjs) ||
            (await import("snarkjs"));

        const result = await snarkjs.groth16.fullProve(
            {
                // Private inputs (not revealed in proof)
                address_hash: secretBigInt.toString(),
                balance: amountBigInt.toString(),
                salt: nullifierBigInt.toString(),
                // Public inputs (visible in proof — reveal only that amount >= tier)
                tier_id: amountBigInt.toString(),
                commitment_expected: note.commitment,
            },
            CIRCUIT_WASM_PATH,
            PROVING_KEY_PATH,
        );

        zkProof = result.proof;
        publicSignals = result.publicSignals;
        proofMode = "groth16_circuit";

        // 5. Local verification
        try {
            const vkeyRes = await fetch(VKEY_PATH);
            const vkey = await vkeyRes.json();
            locallyVerified = await snarkjs.groth16.verify(
                vkey,
                result.publicSignals,
                result.proof,
            );
        } catch {
            // Non-fatal — verification is a quality check, not a hard gate
        }
    } catch {
        // Circuit not available in this environment — Poseidon-only mode
        proofMode = "poseidon_only";
    }

    return {
        note,
        recipientAddress: recipientAddress.trim(),
        recipientAddressHash,
        tokenIdHash,
        domainTag,
        statementVersion: WITHDRAWAL_STATEMENT_VERSION,
        statementPublicInputs,
        zkProof,
        publicSignals,
        locallyVerified,
        proofMode,
        commitmentValid: integrity.valid,
        commitmentBytes32Hex,
        nullifierHashHex,
        generatedAt,
        durationMs: Date.now() - startedAt,
        disclaimer: DISCLAIMER,
    };
}

/**
 * Summarize a withdrawal proof for display (redacts private fields from note).
 */
export function summarizeWithdrawalProof(
    artifact: WithdrawalProofArtifact,
): Record<string, unknown> {
    return {
        commitmentValid: artifact.commitmentValid,
        proofMode: artifact.proofMode,
        locallyVerified: artifact.locallyVerified,
        recipientAddress: artifact.recipientAddress,
        recipientAddressHash: artifact.recipientAddressHash.slice(0, 16) + "...",
        tokenIdHash: artifact.tokenIdHash,
        domainTag: artifact.domainTag,
        statementVersion: artifact.statementVersion,
        statementPublicInputCount: artifact.statementPublicInputs.length,
        commitment: artifact.note.commitment.slice(0, 20) + "...",
        // Contract-facing fields (pass these to the Soroban CommitmentPool contract)
        commitmentBytes32Hex: artifact.commitmentBytes32Hex,
        nullifierHashHex: artifact.nullifierHashHex,
        tokenSymbol: artifact.note.tokenSymbol,
        amountStroops: artifact.note.amountStroops,
        publicSignalCount: artifact.publicSignals?.length ?? 0,
        generatedAt: artifact.generatedAt,
        durationMs: artifact.durationMs,
        disclaimer: artifact.disclaimer,
    };
}
