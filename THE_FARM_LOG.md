# THE FARM LOG

This log tracks the active agent and current status of "THE FARM" delivery.
Updates should be made by editing this file directly.

## Current Status
[UTC:2026-02-18T07:10:00Z] Active Agent: claude-code → HandoffTo: next
Status: Testnet routing wired for all 5 dungeon contract interactions. Contracts not yet deployed.
Message: See "Hackathon Testnet Handoff" section below for full details.

## Hackathon Testnet Handoff

### What was done

All 5 mainnet contract interactions in the ZK Dungeon game now accept an optional
`DungeonNetworkConfig` that switches RPC URL, network passphrase, contract IDs, and
signing flow (Freighter/SWK instead of passkey-kit) when hackathon mode is active.

**Files changed** (commit `a479f14`):

| File | What changed |
|------|-------------|
| `src/lib/dungeon/networkConfig.ts` | **NEW** — `DungeonNetworkConfig` type, `mainnetConfig()`, `testnetConfig()` builders |
| `src/config/farmAttestation.ts` | Added `TESTNET_RPC_URL`, `TESTNET_NETWORK_PASSPHRASE`, `FARM_ATTESTATIONS_CONTRACT_ID_TESTNET` |
| `src/config/risc0Groth16Verifier.ts` | Added `RISC0_GROTH16_VERIFIER_CONTRACT_ID_TESTNET` |
| `src/components/labs/the-farm/zkTypes.ts` | Added `TIER_VERIFIER_CONTRACT_ID_TESTNET` |
| `src/components/labs/the-farm/zkProof.ts` | `submitProofToContract()` routes via `net` param |
| `src/lib/dungeon/publishDungeonStampMainnet.ts` | Entry/withdrawal stamps route via `net` param |
| `src/lib/dungeon/publishNoirUltraHonkVerifyMainnet.ts` | Noir UltraHonk verify routes via `net` param |
| `src/lib/dungeon/publishRisc0Groth16VerifyMainnet.ts` | RISC0 Groth16 verify routes via `net` param |
| `src/lib/dungeon/readFarmAttestationTier.ts` | Attestation reads route via `net` param |
| `src/components/labs/the-farm/dungeon/ZkDungeonGame.svelte` | Passes `getHackathonNet()` through all 5 call sites |
| `src/components/labs/the-farm/dungeon/dungeonTestnetWallet.ts` | Exports `buildAndSimulateSwk`/`signAndSubmitSwk` |

### How the routing works

```
ZkDungeonGame.svelte
  └─ getHackathonNet()  →  returns DungeonNetworkConfig | undefined
       ├─ hackathon mode OFF  →  undefined  →  legacy mainnet passkey path
       └─ hackathon mode ON   →  testnetConfig()  →  SWK (Freighter) signing
```

Each contract call function (`publishDungeonStampMainnet`, `publishNoirUltraHonkVerifyMainnet`,
`publishRisc0Groth16VerifyMainnet`, `submitProofToContract`, `readFarmAttestationTier`) checks
for the optional `net?: DungeonNetworkConfig` param:
- If present: uses `net.rpcUrl`, `net.networkPassphrase`, `net.*ContractId`, `net.signAndSubmit`
- If absent: falls back to mainnet env vars + passkey-kit signing (unchanged behavior)

### What still needs to happen

**1. Deploy contracts to Stellar Testnet**

Three contracts need to be deployed. The deployment scripts exist but target mainnet.
You will need `stellar` CLI and a funded testnet account.

```bash
# Install Stellar CLI if not present
# See: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

# Fund a testnet account
stellar keys generate testnet-deployer --network testnet

# For each contract, the general flow is:
# 1. Build:   cd contracts/<name> && stellar contract build
# 2. Optimize: stellar contract optimize --wasm target/.../<name>.wasm
# 3. Install:  stellar contract install --wasm <optimized.wasm> --network testnet
# 4. Deploy:   stellar contract deploy --wasm-hash <hash> --network testnet
# 5. Init:     stellar contract invoke --id <contract-id> --network testnet -- initialize ...
```

Contracts to deploy:
- **farm-attestations** — master attestation registry (most important, gates entry/withdrawal stamps + Noir/RISC0 records)
- **tier-verifier** — Groth16 on-chain verification (Room 1). After deploy, call `initialize` with admin + vkey from `public/zk/verification_key.json`
- **risc0-groth16-verifier** — RISC0 receipt verification (Room 3). Has embedded VK constants.

Reference the existing mainnet deploy scripts in `scripts/` for argument patterns.

**2. Set environment variables**

Once deployed, set these env vars (in `.env`, `wrangler.toml`, or your deploy platform):

```
PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_TESTNET=C...  # from step 1
PUBLIC_TIER_VERIFIER_CONTRACT_ID_TESTNET=C...       # from step 1
PUBLIC_RISC0_GROTH16_VERIFIER_CONTRACT_ID_TESTNET=C...  # from step 1
```

The code checks these at runtime. When set, `isTestnetConfigured()` returns `true` and
the hackathon mode toggle becomes functional.

**3. Register verification keys on testnet**

After deploying:
- **tier-verifier**: call `initialize(admin, alpha_g1, beta_g2, gamma_g2, delta_g2, ic)` with the BN254 VK points from `public/zk/verification_key.json`
- **farm-attestations**: call `initialize(admin)` then optionally `register_groth16_vk(vk_id, ...)` for the RISC0 VK

**4. Test end-to-end**

1. Install Freighter browser extension, switch to testnet
2. Fund test wallet from Stellar friendbot
3. Enable hackathon mode on dungeon title screen
4. Walk through all 5 rooms:
   - Airlock (entry stamp → farm-attestations `attest`)
   - Room 1 (Groth16 tier proof → tier-verifier `verify_and_attest`)
   - Room 2 (Noir UltraHonk → farm-attestations `verify_ultrahonk_and_attest`)
   - Room 3 (RISC0 Groth16 → farm-attestations `verify_groth16_and_attest` or dedicated verifier)
   - Withdrawal stamp

### Architecture notes

- **Signing**: Mainnet uses passkey-kit (WebAuthn smart wallet). Testnet uses SWK (Freighter/xBull) via `dungeonTestnetWallet.ts`.
- **Explorer links**: The game UI switches between `stellar.expert/explorer/public` and `stellar.expert/explorer/testnet` automatically based on `net.network`.
- **Game hub contract**: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` is already deployed on testnet with `start_game()`/`end_game()` methods.
- **Backward compat**: All changes are additive. When `net` is undefined, every function behaves exactly as before (mainnet passkey path). Zero risk to production.

### Key files for the next agent

| Purpose | File |
|---------|------|
| Network config type + builders | `src/lib/dungeon/networkConfig.ts` |
| Testnet wallet (SWK/Freighter) | `src/components/labs/the-farm/dungeon/dungeonTestnetWallet.ts` |
| Game UI (wires hackathon mode) | `src/components/labs/the-farm/dungeon/ZkDungeonGame.svelte` |
| Contract ID env var configs | `src/config/farmAttestation.ts`, `src/config/risc0Groth16Verifier.ts` |
| Tier verifier types + testnet ID | `src/components/labs/the-farm/zkTypes.ts` |
| Deploy script examples (mainnet) | `scripts/deploy-tier-verifier.mjs`, `scripts/deploy-risc0-groth16-verifier.mjs` |
| ZK proof generation + submission | `src/components/labs/the-farm/zkProof.ts` |
| Multi-toolchain roadmap | `src/components/labs/the-farm/HACKATHON_ZK_TOOLCHAINS.md` |

### Build status

Build passes cleanly as of 2026-02-18. Only warnings are chunk size (expected for ZK libs)
and a vite note about `dungeonTestnetWallet.ts` being both statically and dynamically imported
(harmless, just means it won't be split into a separate chunk).

## Log History
- [UTC:2026-02-18T07:10:00Z] **claude-code**: Testnet routing complete for all 5 dungeon contract calls. Merged `testnet-zk-verifiers` into `review-zk-gaming`. Build passes. Contracts need testnet deployment (no Stellar CLI available in this env). Handoff doc written.
- [UTC:2026-02-13T10:05:00Z] **antigravity**: Mission Accomplished. "Trust Upgrade" UX PUSHed and PR filed.
- [UTC:2026-02-12T22:15:00Z] **main**: Initialized THE_FARM_LOG.md. Status check sent to chat.
