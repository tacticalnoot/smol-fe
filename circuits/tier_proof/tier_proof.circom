pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * TierProof — Prove you qualify for a KALE farming tier without revealing your balance.
 * 
 * Statement: "I know a balance `b` and salt `s` such that:
 *   1. b >= TIER_THRESHOLDS[tier_id]
 *   2. commitment == Poseidon(address_hash, b, s)"
 * 
 * Public inputs:  tier_id, commitment_expected
 * Private inputs: address_hash, balance, salt
 * 
 * Tier Thresholds (in stroops, 7 decimals):
 *   0 = Sprout    (0)
 *   1 = Grower    (100 * 10^7 = 1_000_000_000)
 *   2 = Harvester (1000 * 10^7 = 10_000_000_000)
 *   3 = Whale     (10000 * 10^7 = 100_000_000_000)
 */
template TierProof() {
    // === Public Inputs ===
    signal input tier_id;              // 0-3
    signal input commitment_expected;  // Poseidon hash
    
    // === Private Inputs ===
    signal input address_hash;  // Hash of user's Stellar address
    signal input balance;       // KALE balance in stroops (private!)
    signal input salt;          // Random salt for commitment

    // === Tier Threshold Lookup ===
    // We need to select the right threshold based on tier_id
    // Using a linear combination approach for selection
    signal threshold;
    
    // Thresholds: [0, 1_000_000_000, 10_000_000_000, 100_000_000_000]
    var THRESHOLDS[4] = [0, 1000000000, 10000000000, 100000000000];
    
    // Compute threshold = sum(THRESHOLDS[i] * (tier_id == i))
    signal tier_is_0, tier_is_1, tier_is_2, tier_is_3;
    component eq0 = IsEqual();
    component eq1 = IsEqual();
    component eq2 = IsEqual();
    component eq3 = IsEqual();
    
    eq0.in[0] <== tier_id;
    eq0.in[1] <== 0;
    tier_is_0 <== eq0.out;
    
    eq1.in[0] <== tier_id;
    eq1.in[1] <== 1;
    tier_is_1 <== eq1.out;
    
    eq2.in[0] <== tier_id;
    eq2.in[1] <== 2;
    tier_is_2 <== eq2.out;
    
    eq3.in[0] <== tier_id;
    eq3.in[1] <== 3;
    tier_is_3 <== eq3.out;
    
    // Exactly one tier must match
    tier_is_0 + tier_is_1 + tier_is_2 + tier_is_3 === 1;
    
    threshold <== tier_is_0 * THRESHOLDS[0] 
                + tier_is_1 * THRESHOLDS[1] 
                + tier_is_2 * THRESHOLDS[2] 
                + tier_is_3 * THRESHOLDS[3];

    // === Constraint 1: balance >= threshold ===
    component gte = GreaterEqThan(64);  // 64 bits for balance precision
    gte.in[0] <== balance;
    gte.in[1] <== threshold;
    gte.out === 1;  // Must be true

    // === Constraint 2: commitment matches ===
    component hasher = Poseidon(3);
    hasher.inputs[0] <== address_hash;
    hasher.inputs[1] <== balance;
    hasher.inputs[2] <== salt;
    
    commitment_expected === hasher.out;
}

component main { public [tier_id, commitment_expected] } = TierProof();
