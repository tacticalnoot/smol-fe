# The Farm — ZK Dungeon: Current State

*Last updated: 2026-02-10*

## Current PR: PR0 (Tech Inventory + Plan)

### Done
- [x] Codebase exploration complete
- [x] INVENTORY.md written
- [x] ROADMAP.md written
- [x] JUDGE_FLOW.md written
- [x] STATE.md written (this file)

### Next: PR1 — "Play Here Now"
- Create `/labs/the-farm/play` route
- Build ZkDungeonGame.svelte game shell
- Lobby screen with wallet connect
- Wire portal CTAs to new route
- Placeholder floor UI

## Overall Progress

| PR | Status | Description |
|----|--------|-------------|
| PR0 | IN PROGRESS | Tech inventory + plan docs |
| PR1 | NOT STARTED | Game route + shell |
| PR2 | NOT STARTED | AAA portal redesign |
| PR3 | NOT STARTED | Game loop MVP |
| PR4 | NOT STARTED | Real Noir ZK |
| PR5 | NOT STARTED | Circom floor |
| PR6 | NOT STARTED | RISC Zero boss |
| PR7 | NOT STARTED | Evidence dashboard |

## Known Issues
- Network config is mainnet in wrangler.toml. Game needs testnet config for dungeon transactions.
- No testnet contract deployed for the dungeon game yet.
- No Noir toolchain set up locally yet.
- TheFarmCore.svelte is 10K+ lines — game is separate components, not modifying this.

## Blocking Questions
- None currently. Using testnet defaults and available contract IDs.
