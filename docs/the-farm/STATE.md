# The Farm — ZK Dungeon: Current State

*Last updated: 2026-02-10*

## Done
- [x] PR0: Docs (INVENTORY, ROADMAP, JUDGE_FLOW, STATE)
- [x] PR1: Game route + ZkDungeonGame.svelte shell
- [x] PR2: Portal consolidation — single canonical page at `/labs/the-farm/dungeon-room`
- [x] PR3: Game loop with hub contract calls (start_game, end_game)
- [x] PR4: Real Groth16 proofs via snarkjs + Poseidon commitments
- [x] Cleanup: Removed dev cruft, aligned proof type labels, fixed duplicate CSS, consolidated routes

## Next
- PR5: Dedicated Circom floor circuit (requires compiler)
- PR6: RISC Zero boss floor
- PR7: On-chain evidence dashboard

## Overall Progress

| PR | Status | Description |
|----|--------|-------------|
| PR0 | DONE | Tech inventory + plan docs |
| PR1 | DONE | Game route + shell |
| PR2 | DONE | Portal consolidation |
| PR3 | DONE | Game loop + hub contract calls |
| PR4 | DONE | Real Groth16 ZK proofs |
| PR5 | NEXT | Circom floor (dedicated circuit) |
| PR6 | NOT STARTED | RISC Zero boss |
| PR7 | NOT STARTED | Evidence dashboard |

## Known Issues
- Hub contract calls may fail if passkey wallet not funded on testnet.
- Circom compiler not available in this env; using pre-compiled tier_proof circuit.
- On-chain proof submission (verify_and_attest) requires funded testnet account.
- Co-op gates auto-clear in solo mode (correct behavior for solo play).
