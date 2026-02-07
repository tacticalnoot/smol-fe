/**
 * Script to generate valid test input for tier_proof circuit.
 * The commitment must be calculated using Poseidon hash.
 */

const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Test values
    const tierId = 1; // Grower tier
    const addressHash = BigInt("12345678901234567890");
    const balance = BigInt("2000000000"); // 200 KALE in stroops (> 100 KALE threshold)
    const salt = BigInt("9876543210");

    // Calculate Poseidon(addressHash, balance, salt)
    const commitment = poseidon([addressHash, balance, salt]);
    const commitmentStr = F.toString(commitment);

    console.log("Generated commitment:", commitmentStr);

    const input = {
        tier_id: tierId.toString(),
        commitment_expected: commitmentStr,
        address_hash: addressHash.toString(),
        balance: balance.toString(),
        salt: salt.toString()
    };

    fs.writeFileSync("input.json", JSON.stringify(input, null, 2));
    console.log("Wrote input.json with valid Poseidon commitment");
}

main().catch(console.error);
