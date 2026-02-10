# The Farm — ZK Dungeon: Current State

*Last updated: 2026-02-10*

## Current PR: PR3 (Game Loop MVP)

### Done
- [x] PR0: Docs written (INVENTORY, ROADMAP, JUDGE_FLOW, STATE)
- [x] PR1: Game route at /labs/the-farm/play with ZkDungeonGame.svelte
- [x] PR2: AAA Chapter 3 portal redesign (dungeon-room, zkdungeon)
- [x] PR3: dungeonService.ts with hub contract calls (start_game, end_game)
- [x] PR3: Door attempt flow using service, real tx hash propagation in UI
- [x] PR3: HUD hub status indicator, victory screen hub tx links

### Next: PR4 — Real Noir ZK
- Noir door_proof circuit
- WebWorker for browser-side proving
- On-chain proof verification per door attempt
- Wire real proof + tx into run log

## Overall Progress

| PR | Status | Description |
|----|--------|-------------|
| PR0 | DONE | Tech inventory + plan docs |
| PR1 | DONE | Game route + shell |
| PR2 | DONE | AAA portal redesign |
| PR3 | DONE | Game loop MVP + hub contract calls |
| PR4 | NEXT | Real Noir ZK |
| PR5 | NOT STARTED | Circom floor |
| PR6 | NOT STARTED | RISC Zero boss |
| PR7 | NOT STARTED | Evidence dashboard |

## Known Issues
- Hub contract calls (start_game/end_game) may fail if passkey wallet not funded on testnet.
- Door attempt on-chain tx not yet implemented (comes with PR4 ZK proofs).
- Co-op gates auto-clear in solo mode (correct behavior for solo play).
- Network: game uses testnet RPC directly; main site uses mainnet.

## Blocking Questions
- None currently.
