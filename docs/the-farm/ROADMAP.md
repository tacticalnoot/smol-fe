# The Farm — ZK Dungeon: PR-by-PR Roadmap

*Last updated: 2026-02-10*

## PR0: Tech Inventory + Plan
- **What**: Documentation. INVENTORY.md, ROADMAP.md, JUDGE_FLOW.md, STATE.md.
- **Status**: Done.

## PR1: Game Route + Shell
- **What**: ZkDungeonGame.svelte with title screen, lobby, floor UI. Game route at `/labs/the-farm/dungeon-room`.
- **Status**: Done.

## PR2: Portal Consolidation
- **What**: Consolidated `/labs/the-farm/dungeon-room` as canonical game page. `/play` and `/zkdungeon` redirect to it.
- **Status**: Done.

## PR3: Game Loop + Hub Contracts
- **What**: 10-floor dungeon with 4 doors per floor. Real `start_game()` / `end_game()` calls on Stellar testnet hub. Lobby codes, co-op gates at floors 1 & 5, run log panel.
- **Status**: Done.

## PR4: Real Groth16 ZK Proofs
- **What**: Every door attempt generates a real Groth16 proof via snarkjs using the tier_proof Circom circuit. Poseidon commitment binding, local verification, ZK badge in run log.
- **Status**: Done.

## PR5: Dedicated Circom Floor Circuit
- **What**: Dedicated Circom circuit for door proofs on floors 3 & 7. Requires circom compiler.
- **Status**: Next.

## PR6: RISC Zero Boss Floor
- **What**: Floor 10 boss uses RISC Zero zkVM proof. Dedicated verifier contract.
- **Status**: Not started.

## PR7: On-Chain Evidence Dashboard
- **What**: Full run timeline page with events, tx links, proof types per floor.
- **Status**: Not started.
