# The Farm — ZK Dungeon: Current State

*Last updated: 2026-02-11*

## Done
- [x] PR0: Docs (INVENTORY, ROADMAP, JUDGE_FLOW, STATE)
- [x] PR1: Game route + ZkDungeonGame.svelte shell
- [x] PR2: Portal consolidation — single canonical page at `/labs/the-farm/dungeon-room`
- [x] PR3: Game loop with hub contract calls (start_game, end_game)
- [x] PR4: Real Groth16 proofs via snarkjs + Poseidon commitments
- [x] Cleanup: Removed dev cruft, aligned proof type labels, consolidated routes
- [x] Phase 1: Real multiplayer via BroadcastChannel (lobby inspector, partner sync, both player addresses)
- [x] Phase 2: On-chain door proof txs via tier-verifier, Live Chain Feed HUD, tx hashes + explorer links
- [x] Phase 3: ZK end-to-end (proof → serialize → verify_and_attest → real tx hash)

## Reality Map

| Component | Status | Evidence |
|-----------|--------|----------|
| ZK Proofs (Groth16) | **REAL** | snarkjs.groth16.fullProve() with tier_proof circuit, Poseidon commitments |
| Local Verification | **REAL** | snarkjs.groth16.verify() after each proof |
| On-Chain Verification | **REAL** | verify_and_attest on tier-verifier contract, returns tx hash |
| Hub start_game() | **REAL** | Signed + sent to testnet hub, tx hash in UI |
| Hub end_game() | **REAL** | Signed + sent to testnet hub, tx hash in UI |
| Door Attempt Txs | **REAL** | Each door submits proof to tier-verifier on testnet |
| Multiplayer Lobby | **REAL** | BroadcastChannel sync, both player addresses shown |
| Cross-Device | **PARTIAL** | BroadcastChannel = same browser. Cross-device needs server relay. |
| Passkey Wallet | **REAL** | WebAuthn signing via passkey-kit |
| Explorer Links | **REAL** | stellar.expert testnet links for every tx hash |
| Run Log | **REAL** | Every event logged with proof type, proving time, ZK badge, tx link |
| Live Chain Feed | **REAL** | Shows last tx, hub contract, session, on-chain tx count |

## Next
- Dedicated Circom floor circuit (requires compiler)
- RISC Zero boss floor (floor 10)
- Cross-device multiplayer (SSR API endpoint)
- On-chain evidence dashboard

## Known Issues
- Hub contract calls may fail if passkey wallet not funded on testnet.
- Circom compiler not available in this env; using pre-compiled tier_proof circuit.
- On-chain proof submission requires funded testnet account (friendbot can fund).
- Co-op gates auto-clear in solo mode; timeout after 15s in multiplayer.
- Cross-device multiplayer limited to same browser (BroadcastChannel).
