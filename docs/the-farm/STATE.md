# The Farm — ZK Dungeon: Current State

*Last updated: 2026-02-10*

## Current PR: PR4 (Real ZK Proofs)

### Done
- [x] PR0: Docs written (INVENTORY, ROADMAP, JUDGE_FLOW, STATE)
- [x] PR1: Game route at /labs/the-farm/play with ZkDungeonGame.svelte
- [x] PR2: AAA Chapter 3 portal redesign (dungeon-room, zkdungeon)
- [x] PR3: dungeonService.ts with hub contract calls (start_game, end_game)
- [x] PR4: dungeonProofWorker.ts — real Groth16 proof generation per door attempt
- [x] PR4: Uses existing tier_proof circuit (Poseidon commitment, BN254)
- [x] PR4: Local proof verification via snarkjs groth16.verify
- [x] PR4: Run log shows ZK verified badge, proving time, proof type
- [x] PR4: Wrong choices still generate valid proofs (is_correct computed off-circuit)

### Next: Push + continue to PR5-7
- Push all commits to remote
- PR5: Dedicated Circom floor circuit (if compiler available)
- PR6: RISC Zero boss floor
- PR7: On-chain evidence dashboard

## Overall Progress

| PR | Status | Description |
|----|--------|-------------|
| PR0 | DONE | Tech inventory + plan docs |
| PR1 | DONE | Game route + shell |
| PR2 | DONE | AAA portal redesign |
| PR3 | DONE | Game loop MVP + hub contract calls |
| PR4 | DONE | Real Groth16 ZK proofs (snarkjs + Poseidon) |
| PR5 | NEXT | Circom floor (dedicated circuit) |
| PR6 | NOT STARTED | RISC Zero boss |
| PR7 | NOT STARTED | Evidence dashboard |

## Known Issues
- Hub contract calls may fail if passkey wallet not funded on testnet.
- Circom compiler not available in this env; using pre-compiled tier_proof circuit.
- On-chain proof submission (verify_and_attest) requires funded testnet account.
- Co-op gates auto-clear in solo mode (correct behavior for solo play).

## Blocking Questions
- None currently.
