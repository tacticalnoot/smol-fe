# Tier Verifier Deployer Key

**DO NOT DELETE** — This key is used to deploy and upgrade the tier-verifier contract.

## Key Details

| Field | Value |
|-------|-------|
| **Key Name** | `tier-verifier-deployer` |
| **Public Address** | `GBRMQ3TG3CUQHLYTGES6MN2VOK4UNFHNDSPLL4MF2WFZTPXOPWKDB5TF` |
| **Created** | 2026-02-07 |
| **Purpose** | Deploy & upgrade tier-verifier ZK contract on mainnet |

## How to Use

```bash
# Deploy
stellar contract deploy --wasm target\wasm32v1-none\release\tier_verifier.wasm --source tier-verifier-deployer --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"

# Upgrade (after deploying new WASM)
stellar contract invoke --id <CONTRACT_ID> --source tier-verifier-deployer --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015" -- upgrade --new_wasm_hash <NEW_HASH>
```

## Key Location

The key is stored in Stellar CLI's keychain:
- Windows: `%USERPROFILE%\.config\soroban\identity\tier-verifier-deployer.toml`

To backup:
```bash
stellar keys show tier-verifier-deployer
```
