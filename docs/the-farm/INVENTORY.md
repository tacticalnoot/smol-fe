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

### Routes

| Route | File | Status |
|-------|------|--------|
| `/labs/the-farm` | `src/pages/labs/the-farm.astro` | Live. Loads TheFarmCore dashboard. |
| `/labs/the-farm/zkdungeon` | `src/pages/labs/the-farm/zkdungeon.astro` | Live. Iframe wrapper pointing at dungeon-room or env URL. |
| `/labs/the-farm/dungeon-room` | `src/pages/labs/the-farm/dungeon-room.astro` | Live. Canvas portal with "Open dungeon" CTA. Placeholder — no actual game. |
| `/labs/the-farm/play` | — | **DOES NOT EXIST YET.** Target route for the playable ZK Dungeon game. |

### Smart Contracts (Soroban)

| Contract | Path | SDK | Deployed | Contract ID |
|----------|------|-----|----------|-------------|
| tier-verifier | `contracts/tier-verifier/` | soroban-sdk 25.1.0 | Mainnet 2026-02-07 | `CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO` |
| proof-of-farm | `proof-of-farm/` | soroban-sdk 22.0.0 | Not deployed | — |
| batch-transfer | `contracts/batch-transfer/` | soroban-sdk 21.7.1 | Mainnet | `CAZ4E2ZSMWMJDZQWB2OLXHYISBN6VSWUV2GOUM7AQ4ZDM4KBWHGKLDKX` |
| **the-farm game** | — | — | **NOT BUILT YET** | — |

### ZK Circuits

| Circuit | Path | Type | Status |
|---------|------|------|--------|
| tier_proof | `circuits/tier_proof/` | Circom 2.1.0, Groth16 BN254 | Compiled. WASM + zkey in `public/zk/`. Working end-to-end with tier-verifier. |
| **door_proof (Noir)** | — | — | **NOT BUILT YET.** Spec in README-the-farm.md. |
| **door_proof (Circom)** | — | — | **NOT BUILT YET.** |
| **boss_proof (RISC Zero)** | — | — | **NOT BUILT YET.** |

### External References

| Item | Value |
|------|-------|
| Game Hub Contract | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
| ZK Dungeon Contract (ref) | `CA34IFEOQADUHTDIMJGTQ2I7O34QYHL4FFXFOJYTUSPVRMJQCS3UAY6N` |
| Tier Verifier (SuperVerifier) | `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M` (zkTypes) / `CBGLUCGJNVEP3NN6U5KCWSTWKHALXCXOGF5FE6V6C3RIGBQ37O2CTPCO` (mainnet deploy) |
| RPC (mainnet) | `https://rpc.ankr.com/stellar_soroban` |
| Stellar Game Studio | `https://github.com/jamesbachini/Stellar-Game-Studio` |
| Our SGS Fork | `https://github.com/tacticalnoot/Stellar-Game-Studio-1` |

## What Will Be Embedded and Where

The ZK Dungeon game will be built as **native Svelte 5 components** inside smol-fe (not as a separate Vite app). This avoids cross-origin issues, build complexity, and lets us share stores/auth.

| New Component | Location | Purpose |
|---------------|----------|---------|
| ZkDungeonGame.svelte | `src/components/labs/the-farm/dungeon/ZkDungeonGame.svelte` | Main game shell: lobby, floor progression, proof overlays |
| DungeonFloor.svelte | `src/components/labs/the-farm/dungeon/DungeonFloor.svelte` | Single floor UI: 4 doors, choice, animations |
| DungeonLobby.svelte | `src/components/labs/the-farm/dungeon/DungeonLobby.svelte` | Create/join lobby, wallet connect |
| DungeonHUD.svelte | `src/components/labs/the-farm/dungeon/DungeonHUD.svelte` | Floor counter, run log, opponent progress |
| dungeonService.ts | `src/components/labs/the-farm/dungeon/dungeonService.ts` | Contract calls, hub lifecycle, proof submission |
| dungeonProofWorker.ts | `src/components/labs/the-farm/dungeon/dungeonProofWorker.ts` | WebWorker for ZK proof generation |
| play.astro | `src/pages/labs/the-farm/play.astro` | Route: loads ZkDungeonGame client:only |

## ZK Pipeline Plan

### Phase 1: Noir (All 10 Floors) — Priority

Circuit: `door_proof`
- Private inputs: `sigil_secret`, `choice`
- Public inputs: `lobby_id`, `player_salt`, `sigil_commit`, `floor`, `attempt_nonce`
- Public output: `is_correct` (0 or 1)
- Constraint: wrong choice still generates valid proof with `is_correct=0`
- Verifier: Noir UltraHonk verifier contract on Soroban
- Status: **Not started**

### Phase 2: Circom Floor (Floor 3 or 7)

Replace one floor's proof pipeline with a Circom Groth16 circuit.
- Reuse existing snarkjs + BN254 infrastructure from tier_proof
- Verifier: existing tier-verifier contract pattern (adapted)
- Status: **Not started**

### Phase 3: RISC Zero Boss Floor (Floor 10)

Boss encounter uses RISC Zero zkVM proof.
- Guest program: verify hashed path constraint
- Verifier: dedicated RISC Zero verifier contract
- Status: **Not started**

## Environment Keys Needed

| Key | Source | Status |
|-----|--------|--------|
| `PUBLIC_RPC_URL` | wrangler.toml | Have (mainnet). Need testnet RPC for game. |
| `PUBLIC_NETWORK_PASSPHRASE` | wrangler.toml | Have (mainnet). Need testnet passphrase. |
| Game Hub Contract ID | Task spec | Have: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
| ZK Dungeon Game Contract ID | Deploy needed | **TBD — deploy on testnet** |
| Noir Verifier Contract ID | Deploy needed | **TBD — deploy on testnet** |
| Testnet funded accounts | stellar CLI | **TBD — generate via friendbot** |
