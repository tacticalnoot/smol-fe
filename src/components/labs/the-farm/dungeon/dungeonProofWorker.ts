/**
 * Dungeon Proof Worker — Real ZK proof generation for door attempts.
 *
 * Uses the existing tier_proof Circom circuit (Groth16/BN254) to generate
 * real, verifiable proofs for each door choice. The proof system:
 *
 * 1. Encodes door choice data into circuit-compatible inputs
 * 2. Generates a Poseidon commitment binding (balance, salt)
 * 3. Runs snarkjs Groth16 fullProve in the browser
 * 4. Returns proof + public signals + is_correct
 *
 * Architecture: This runs on the main thread with dynamic imports.
 * A true WebWorker version will follow when wasm-in-worker bundling is resolved.
 *
 * IMPORTANT: Wrong choices still generate valid proofs. The `is_correct` flag
 * is computed off-circuit but the commitment and proof are cryptographically real.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DoorProofInput {
    playerAddress: string;
    floor: number;
    doorChoice: number;
    attemptNonce: number;
    lobbyId: string;
}

export interface DoorProofResult {
    proof: any;             // Groth16 proof object (pi_a, pi_b, pi_c)
    publicSignals: string[];
    commitment: string;     // Poseidon commitment hex
    isCorrect: boolean;
    correctDoor: number;
    proofType: string;      // "Groth16" | "Circom" | "RISC Zero"
    provingTimeMs: number;
}

// ── Circuit Paths ────────────────────────────────────────────────────────────

const CIRCUIT_WASM = "/zk/tier_proof.wasm";
const PROVING_KEY = "/zk/tier_proof.zkey";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Hash a string to a field element (first 31 bytes of SHA-256) */
async function hashToField(input: string): Promise<bigint> {
    const data = new TextEncoder().encode(input);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hashBuf);
    let hash = 0n;
    for (let i = 0; i < 31; i++) {
        hash = (hash << 8n) | BigInt(bytes[i]);
    }
    return hash;
}

/** Generate a cryptographically secure random salt (fits in BN254 Fr) */
function generateSalt(): bigint {
    const bytes = crypto.getRandomValues(new Uint8Array(31));
    let salt = 0n;
    for (const b of bytes) {
        salt = (salt << 8n) | BigInt(b);
    }
    return salt;
}

/**
 * Compute the correct door for a given floor + nonce (demo-only).
 *
 * This is deterministic game logic and is NOT proven by the ZK circuit.
 * The circuit simply produces a proof bound to the attempt parameters.
 */
function computeCorrectDoor(floor: number, nonce: number): number {
    const seed = floor * 1000 + nonce;
    return (seed * 7 + 3) % 4;
}

/**
 * Encode door choice data into the balance field.
 * The tier_proof circuit accepts a balance input and checks balance >= threshold.
 * Using threshold=0, any non-negative balance passes.
 * We encode: floor * 1_000_000 + door * 10_000 + nonce
 * This makes each proof unique to the specific attempt.
 */
function encodeDoorData(floor: number, door: number, nonce: number): bigint {
    return BigInt(floor) * 1_000_000n + BigInt(door) * 10_000n + BigInt(nonce);
}

/** Map floor to proof type label — matches game lore */
function proofTypeForFloor(floor: number): string {
    return "Groth16 (Circom)";
}

// ── Proof Generation ─────────────────────────────────────────────────────────

/**
 * Generate a real Groth16 proof for a door attempt.
 *
 * The proof proves:
 * - The prover knows a salt `s` and encoded balance `b`
 * - commitment = Poseidon(b, s)
 * - b >= threshold (we set threshold=0 so it's always true)
 *
 * The `is_correct` flag is computed separately by comparing the
 * chosen door against the deterministic correct door.
 */
export async function generateDoorProof(
    input: DoorProofInput,
): Promise<DoorProofResult> {
    const startTime = performance.now();
    const proofType = proofTypeForFloor(input.floor);

    console.log("[DoorProof] Generating proof:", {
        floor: input.floor,
        door: input.doorChoice,
        nonce: input.attemptNonce,
        proofType,
    });

    // 1. Derive inputs
    const salt = generateSalt();
    const encodedBalance = encodeDoorData(
        input.floor,
        input.doorChoice,
        input.attemptNonce,
    );

    // 2. Compute Poseidon commitment
    // @ts-ignore - circomlibjs lacks TS declarations
    const { buildPoseidon } = await import("circomlibjs");
    const poseidon = await buildPoseidon();
    const commitmentField = poseidon.F.toString(
        poseidon([encodedBalance, salt]),
    );
    const commitment = BigInt(commitmentField);

    // 3. Prepare circuit inputs
    // Using threshold=0 so any non-negative encodedBalance passes.
    const circuitInputs = {
        balance: encodedBalance.toString(),
        salt: salt.toString(),
        threshold: "0",
        commitment: commitment.toString(),
    };

    // 4. Generate Groth16 proof via snarkjs
    // @ts-ignore - snarkjs types
    const snarkjs = await import("snarkjs");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInputs,
        CIRCUIT_WASM,
        PROVING_KEY,
    );

    // 5. Determine correctness
    const correctDoor = computeCorrectDoor(input.floor, input.attemptNonce);
    const isCorrect = input.doorChoice === correctDoor;

    const provingTimeMs = Math.round(performance.now() - startTime);

    console.log("[DoorProof] Proof generated:", {
        isCorrect,
        correctDoor,
        provingTimeMs,
        commitment: commitment.toString().slice(0, 20) + "...",
    });

    return {
        proof,
        publicSignals,
        commitment: commitment.toString(),
        isCorrect,
        correctDoor,
        proofType,
        provingTimeMs,
    };
}

/**
 * Verify a door proof locally (for debugging / UI feedback).
 * ZK Dungeon currently performs local verification only.
 */
export async function verifyDoorProofLocally(
    proof: any,
    publicSignals: string[],
): Promise<boolean> {
    const vkeyRes = await fetch("/zk/verification_key.json");
    const vkey = await vkeyRes.json();

    // @ts-ignore
    const snarkjs = await import("snarkjs");
    return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
