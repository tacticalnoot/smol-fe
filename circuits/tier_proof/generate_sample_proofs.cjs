/**
 * Generate real Groth16 sample proofs for THE FARM page.
 *
 * Uses the existing tier_proof circuit + snarkjs to produce
 * cryptographically valid proofs for each tier, plus one
 * corrupted proof and one boundary edge case.
 *
 * Usage: node generate_sample_proofs.cjs
 * Output: sample_proofs.json (consumed by the bundler script)
 */

const { buildPoseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

const WASM_PATH = path.join(__dirname, "..", "..", "public", "zk", "tier_proof.wasm");
const ZKEY_PATH = path.join(__dirname, "tier_proof_final.zkey");
const VKEY_PATH = path.join(__dirname, "verification_key.json");

// Tier thresholds in stroops (matching the circuit)
const TIER_THRESHOLDS = [0n, 1_000_000_000n, 10_000_000_000n, 100_000_000_000n];

const SAMPLES = [
    {
        id: "demo-sprout-basic",
        label: "Basic Sprout",
        tier: "Sprout",
        tierIndex: 0,
        description: "Happy path, minimal proof — lowest tier with valid Groth16 payload.",
        // 50 KALE (well above 0 threshold)
        balance: 500_000_000n,
        addressHash: 111111111111111111n,
        salt: 999888777666555444n,
        isValid: true,
    },
    {
        id: "demo-grower-active",
        label: "Active Grower",
        tier: "Grower",
        tierIndex: 1,
        description: "Mid-tier proof representing a typical active farmer (100+ KALE).",
        // 500 KALE (above 100 threshold)
        balance: 5_000_000_000n,
        addressHash: 222222222222222222n,
        salt: 888777666555444333n,
        isValid: true,
    },
    {
        id: "demo-harvester-full",
        label: "Full Harvester",
        tier: "Harvester",
        tierIndex: 2,
        description: "High-tier proof with all standard fields populated (1,000+ KALE).",
        // 5,000 KALE (above 1,000 threshold)
        balance: 50_000_000_000n,
        addressHash: 333333333333333333n,
        salt: 777666555444333222n,
        isValid: true,
    },
    {
        id: "demo-whale-max",
        label: "Whale Proof",
        tier: "Whale",
        tierIndex: 3,
        description: "Max-tier proof with all optional fields present (10,000+ KALE).",
        // 50,000 KALE (above 10,000 threshold)
        balance: 500_000_000_000n,
        addressHash: 444444444444444444n,
        salt: 666555444333222111n,
        isValid: true,
    },
    {
        id: "demo-boundary",
        label: "Boundary Proof",
        tier: "Grower",
        tierIndex: 1,
        description: "Balance exactly at the Grower threshold boundary (100 KALE).",
        // Exactly 100 KALE = exactly at threshold
        balance: 1_000_000_000n,
        addressHash: 555555555555555555n,
        salt: 123456789012345678n,
        isValid: true,
        isEdgeCase: true,
    },
];

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

    const results = [];

    for (const sample of SAMPLES) {
        console.log(`Generating proof: ${sample.label} (tier ${sample.tierIndex})...`);

        // Compute Poseidon commitment
        const commitment = poseidon([sample.addressHash, sample.balance, sample.salt]);
        const commitmentStr = F.toString(commitment);

        const circuitInputs = {
            tier_id: sample.tierIndex.toString(),
            commitment_expected: commitmentStr,
            address_hash: sample.addressHash.toString(),
            balance: sample.balance.toString(),
            salt: sample.salt.toString(),
        };

        // Generate real Groth16 proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInputs,
            WASM_PATH,
            ZKEY_PATH,
        );

        // Verify it locally to be sure
        const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        if (!valid) {
            throw new Error(`Generated proof for ${sample.label} failed local verification!`);
        }
        console.log(`  ✓ Verified (public signals: [${publicSignals.join(", ")}])`);

        results.push({
            id: sample.id,
            label: sample.label,
            tier: sample.tier,
            tierIndex: sample.tierIndex,
            description: sample.description,
            proof,
            publicSignals,
            isValid: true,
            isEdgeCase: sample.isEdgeCase || false,
        });
    }

    // Generate the corrupted proof: take the Sprout proof and corrupt pi_a[0]
    console.log("Generating corrupted proof...");
    const sproutProof = JSON.parse(JSON.stringify(results[0].proof));
    // Corrupt by changing a digit in pi_a[0]
    const original = sproutProof.pi_a[0];
    const lastDigit = original[original.length - 1];
    const newDigit = lastDigit === "0" ? "1" : "0";
    sproutProof.pi_a[0] = original.slice(0, -1) + newDigit;

    // Verify it fails
    const corruptedValid = await snarkjs.groth16.verify(
        vkey,
        results[0].publicSignals,
        sproutProof,
    );
    if (corruptedValid) {
        throw new Error("Corrupted proof unexpectedly passed verification!");
    }
    console.log("  ✓ Corrupted proof correctly fails verification");

    results.push({
        id: "demo-corrupted",
        label: "Corrupted Proof",
        tier: "Sprout",
        tierIndex: 0,
        description: "Malformed proof data — one curve point has been altered. Tests error handling UI.",
        proof: sproutProof,
        publicSignals: results[0].publicSignals,
        isValid: false,
        isEdgeCase: false,
    });

    const output = {
        generatedAt: new Date().toISOString(),
        circuit: "tier_proof",
        curve: "bn128",
        protocol: "groth16",
        verificationKey: vkey,
        proofs: results,
    };

    const outPath = path.join(__dirname, "sample_proofs.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${results.length} proofs to ${outPath}`);
}

main().catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
});
