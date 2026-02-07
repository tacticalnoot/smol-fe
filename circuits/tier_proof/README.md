# Tier Proof Circuit

This is the real ZK circuit for "Proof of Farm" on Stellar.

## What it proves

**Statement**: "I know a balance `b` and salt `s` such that:
1. `b >= TIER_THRESHOLDS[tier_id]`  
2. `commitment == Poseidon(address_hash, b, s)`"

**Private inputs**: `address_hash`, `balance`, `salt`  
**Public inputs**: `tier_id`, `commitment_expected`

## Tier Thresholds

| Tier | Name | Threshold (KALE) | Threshold (stroops) |
|------|------|------------------|---------------------|
| 0 | Sprout | 0 | 0 |
| 1 | Grower | 100 | 1,000,000,000 |
| 2 | Harvester | 1,000 | 10,000,000,000 |
| 3 | Whale | 10,000 | 100,000,000,000 |

## Prerequisites

1. Install circom:
   ```bash
   cargo install circom
   ```

2. Download Powers of Tau (12th ceremony):
   ```bash
   wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau -O pot12_final.ptau
   ```

## Build

```bash
npm install
npm run full-setup
```

## Generate Soroban Verifier

```bash
cargo install soroban-verifier-gen
npm run gen-verifier
```

This will generate a Soroban smart contract in `../contracts/tier-verifier/` that verifies Groth16 proofs using BN254 curve operations (Stellar Protocol 25).
