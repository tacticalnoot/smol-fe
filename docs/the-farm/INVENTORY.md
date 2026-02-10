# The Farm — ZK Dungeon: Tech Inventory

*Last updated: 2026-02-10*

## What Exists Today

### Frontend (smol-fe — Astro + Svelte 5)

| Asset | Path | Purpose |
|-------|------|---------|
| TheFarmCore.svelte | `src/components/labs/the-farm/TheFarmCore.svelte` | ZK proof dashboard (10K lines). Tier proofs, badge gallery, game proofs, Chapter 3 compliance tracker, verification rails. NOT the dungeon game itself. |
| zkProof.ts | `src/components/labs/the-farm/zkProof.ts` | Browser-side Groth16 proof generation via snarkjs. Poseidon hashing, proof serialization for Soroban BN254. |
| zkGames.ts | `src/components/labs/the-farm/zkGames.ts` | Game proof creation with Poseidon commitments, localStorage persistence. |
| zkTypes.ts | `src/components/labs/the-farm/zkTypes.ts` | Shared types, tier config, badge registry. SSOT for contract IDs. |
| zkToolchains.ts | `src/components/labs/the-farm/zkToolchains.ts` | Noir UltraHonk + RISC Zero track definitions. |
| FarmBadge.svelte | `src/components/labs/the-farm/FarmBadge.svelte` | Holographic badge display component. |
| ZkDungeonGame.svelte | `src/components/labs/the-farm/dungeon/ZkDungeonGame.svelte` | Main game: title screen, lobby, 10-floor dungeon, victory. Full Svelte 5 runes. |
| dungeonService.ts | `src/components/labs/the-farm/dungeon/dungeonService.ts` | Contract calls, hub lifecycle (start_game/end_game), door attempts with ZK proofs. |
| dungeonProofWorker.ts | `src/components/labs/the-farm/dungeon/dungeonProofWorker.ts` | Real Groth16 proof generation using tier_proof circuit. Poseidon commitments, snarkjs. |

### Routes

| Route | File | Status |
|-------|------|--------|
| `/labs/the-farm` | `src/pages/labs/the-farm.astro` | Live. Loads TheFarmCore dashboard. |
| `/labs/the-farm/dungeon-room` | `src/pages/labs/the-farm/dungeon-room.astro` | Live. **Canonical game page.** Loads ZkDungeonGame. |
| `/labs/the-farm/play` | `src/pages/labs/the-farm/play.astro` | Redirects to `/labs/the-farm/dungeon-room`. |
| `/labs/the-farm/zkdungeon` | `src/pages/labs/the-farm/zkdungeon.astro` | Redirects to `/labs/the-farm/dungeon-room`. |
| `/zkdungeon` | `src/pages/zkdungeon.astro` | Redirects to `/labs/the-farm/dungeon-room`. |

### Smart Contracts (Soroban)

| Contract | Path | SDK | Deployed | Contract ID |
|----------|------|-----|----------|-------------|
| tier-verifier | `contracts/tier-verifier/` | soroban-sdk 25.1.0 | Mainnet 2026-02-07 | `CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO` |
| proof-of-farm | `proof-of-farm/` | soroban-sdk 22.0.0 | Not deployed | — |
| batch-transfer | `contracts/batch-transfer/` | soroban-sdk 21.7.1 | Mainnet | `CAZ4E2ZSMWMJDZQWB2OLXHYISBN6VSWUV2GOUM7AQ4ZDM4KBWHGKLDKX` |

### ZK Circuits

| Circuit | Path | Type | Status |
|---------|------|------|--------|
| tier_proof | `circuits/tier_proof/` | Circom 2.1.0, Groth16 BN254 | Compiled. WASM + zkey in `public/zk/`. Used for all dungeon door proofs. |

### External References

| Item | Value |
|------|-------|
| Game Hub Contract | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
| ZK Dungeon Contract (ref) | `CA34IFEOQADUHTDIMJGTQ2I7O34QYHL4FFXFOJYTUSPVRMJQCS3UAY6N` |
| Tier Verifier (SuperVerifier) | `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M` (zkTypes) / `CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO` (mainnet deploy) |
| RPC (mainnet) | `https://rpc.ankr.com/stellar_soroban` |
| Stellar Game Studio | `https://github.com/jamesbachini/Stellar-Game-Studio` |
| Our SGS Fork | `https://github.com/tacticalnoot/Stellar-Game-Studio-1` |

## ZK Pipeline

### Current: Groth16 (All 10 Floors)

Uses the existing `tier_proof` Circom circuit with snarkjs Groth16 proving:
- Encodes door choice data (floor, door, nonce) into circuit's balance input
- Generates Poseidon commitment binding (player, encoded data, salt)
- Runs `snarkjs.groth16.fullProve()` in the browser
- Wrong choices generate valid proofs — `is_correct` is computed off-circuit
- Local verification via `snarkjs.groth16.verify()`

### Future: Dedicated Circuits

- **Circom Floor** (floors 3 & 7): Dedicated Circom circuit for door proofs — requires circom compiler
- **RISC Zero Boss** (floor 10): zkVM proof for the boss encounter

## Environment Keys

| Key | Source | Status |
|-----|--------|--------|
| `PUBLIC_RPC_URL` | wrangler.toml | Have (mainnet). Testnet RPC hardcoded in dungeonService.ts. |
| `PUBLIC_NETWORK_PASSPHRASE` | wrangler.toml | Have (mainnet). Testnet passphrase hardcoded in dungeonService.ts. |
| Game Hub Contract ID | Task spec | Have: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
