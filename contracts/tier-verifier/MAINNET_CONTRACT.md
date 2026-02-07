# Tier Verifier Contract — MAINNET DEPLOYED ✅

**DO NOT DELETE** — This contract handles all ZK tier verification for Proof of Farm.

## Contract Details

| Field | Value |
|-------|-------|
| **Contract ID** | `CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO` |
| **Network** | Stellar Mainnet |
| **Deployed** | 2026-02-07 |
| **Admin** | `GBRMQ3TG3CUQHLYTGES6MN2VOK4UNFHNDSPLL4MF2WFZTPXOPWKDB5TF` |
| **TX Hash** | `706af126c4d33e16c0cbfc1a6e4b47b8a2c2c68695243460df1cccfce800d05e` |

## Links

- [Stellar Expert Contract](https://stellar.expert/explorer/public/contract/CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO)
- [Stellar Lab](https://lab.stellar.org/r/mainnet/contract/CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO)

## Contract Functions

```rust
// Initialize with admin (call once after deploy)
initialize(admin: Address)

// Store tier attestation
attest_tier(farmer: Address, tier: u32, commitment: BytesN<32>, proof_hash: BytesN<32>)

// Lookup attestation
get_attestation(farmer: Address) -> Option<TierAttestation>

// Upgrade contract (admin only)
upgrade(new_wasm_hash: BytesN<32>)
```

## Upgrade Instructions

1. Build new WASM: `stellar contract build`
2. Install new WASM: `stellar contract install --wasm <new.wasm> --source tier-verifier-deployer --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"`
3. Call upgrade: 
```bash
stellar contract invoke \
  --id CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO \
  --source tier-verifier-deployer \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- upgrade --new_wasm_hash <NEW_HASH>
```
