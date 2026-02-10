# The Farm — ZK Dungeon: PR-by-PR Roadmap

*Last updated: 2026-02-10*

## PR0: Tech Inventory + Plan (this PR)
- **What**: Documentation only. INVENTORY.md, ROADMAP.md, JUDGE_FLOW.md, STATE.md.
- **Risk**: None. Docs only.

## PR1: "Play Here Now" — Game Route + Shell
- **What**: Create `/labs/the-farm/play` route with ZkDungeonGame.svelte. Game shell with lobby screen, wallet connect (passkey default), and placeholder floor UI. Wire dungeon-room portal CTA to this route.
- **Outcome**: User clicks "Play Now" → sees game lobby inside smol-fe. No external tabs.
- **Risk**: Low. New route + new components. Does not touch TheFarmCore.

## PR2: AAA Game Studio Redesign
- **What**: Redesign `/labs/the-farm/zkdungeon` and `/labs/the-farm/dungeon-room` as premium Chapter 3 landing pages. Hero section, key art canvas, "PLAY NOW" CTA, secondary links (How It Works, On-Chain Log).
- **Outcome**: Portal pages look like a real game studio flagship launch.
- **Risk**: Low. Replaces existing portal pages with better versions.

## PR3: Game Loop MVP
- **What**: 10-floor dungeon with 4-door choices per floor. Lobby create/join with lobby codes. Co-op gates at floors 1 & 5. Every attempt submits a real Stellar testnet transaction. Live "Run Log" panel with tx hash links. Sound cues and door animations.
- **Outcome**: Two players can play the full game loop with real on-chain transactions.
- **ZK Status**: Transactions are real. Proof generation labeled "wiring in next PR" if ZK not ready.
- **Risk**: Medium. Requires testnet contract deployment and lobby state management.

## PR4: Real Noir ZK End-to-End
- **What**: Noir `door_proof` circuit compiled and integrated. WebWorker for browser-side proving. Every door attempt includes a real Noir proof verified on-chain. Wrong choices verify with `is_correct=0`.
- **Outcome**: Real ZK proofs on every floor. Proof type shown in run log.
- **Risk**: High. Noir toolchain integration, verifier contract deployment, proof worker.

## PR5: Circom Floor
- **What**: One floor (e.g., floor 3 or 7) uses a Circom Groth16 proof instead of Noir. Reuses existing snarkjs infrastructure. Dedicated verifier or adapted tier-verifier.
- **Outcome**: "Circom Gate" labeled in UI. Proof type visible in run log.
- **Risk**: Medium. Circuit design + verifier adaptation.

## PR6: RISC Zero Boss Floor
- **What**: Floor 10 boss uses RISC Zero zkVM proof. Minimal guest program. Dedicated verifier contract.
- **Outcome**: "RISC Zero Boss Gate" labeled in UI.
- **Risk**: High. RISC Zero toolchain setup + verifier contract.

## PR7: On-Chain Evidence Dashboard
- **What**: `/labs/the-farm/run/:lobbyId` page showing full run timeline. Events, tx links, start_game/end_game hub calls, proof types per floor.
- **Outcome**: Judge can see the entire run's on-chain evidence at a glance.
- **Risk**: Low. Read-only page pulling events from Stellar.

## Dependency Graph

```
PR0 (docs) ──→ PR1 (play route) ──→ PR3 (game loop) ──→ PR4 (Noir ZK)
                    │                                        │
                    └──→ PR2 (portal redesign)               ├──→ PR5 (Circom)
                                                             └──→ PR6 (RISC Zero)
                                                                      │
                                                                      └──→ PR7 (dashboard)
```
