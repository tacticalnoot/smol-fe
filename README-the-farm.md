# The Farm – Stellar ZK Dungeon Execution Plan
*(Codex runbook, last updated 2026-02-10)*  

This follows the Stellar Game Studio quickstart and the “Stellar ZK Dungeon” requirements. Kept concise so we can execute step-by-step without breaking the existing smol-fe app.

## 0) Prereqs (WSL recommended on Windows)
- Bun
- Rust + Cargo
- Stellar CLI (`cargo install --locked stellar-cli --features opt`)
- `rustup target add wasm32v1-none`
- Git

## 1) Clone Game Studio (separate folder)
```bash
git clone https://github.com/jamesbachini/Stellar-Game-Studio.git
cd Stellar-Game-Studio
```

## 2) One-command setup
```bash
bun run setup
```
- Builds Soroban contracts, creates test accounts, deploys, generates bindings.

## 3) Scaffold the game
```bash
bun run create the-farm
# if hyphen disliked by scripts: bun run create the_farm
```
Outputs a new game workspace (contract + frontend).

## 4) ZK design (Noir first)
Circuit `door_proof`:
- Private: `sigil_secret: u128`, `choice: u8`
- Public: `lobby_id`, `player_salt`, `sigil_commit`, `floor: u32`, `attempt_nonce: u32`
- Constraints:
  - `choice < 4`
  - `poseidon(sigil_secret, lobby_id, player_salt) == sigil_commit`
  - `expected = (sigil_secret + floor + attempt_nonce) % 4`
  - `is_correct = (choice == expected)` (public output only; no assert)
- Tests: correct choice -> `is_correct=1`; wrong choice -> `is_correct=0`; bad commit -> proof fails.

## 5) Contracts
### Verifier
- Deploy Noir verifier (Ultrahonk/BN254) callable as `verify(proof_bytes, public_inputs_bytes) -> bool`.

### Game contract `the_farm_game`
- Storage: lobby state, commitments, floors, attempt_nonces, gate floors {1,5}.
- Entry points:
  - `create_lobby()` -> lobby_id (auth caller)
  - `join_lobby(lobby_id)` (auth)
  - `set_commit(lobby_id, sigil_commit)`
    - When both commits + players present and status Waiting → call hub `start_game()` on `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`, set status Active, floors=1, emit events.
  - `attempt_door(lobby_id, floor, attempt_nonce, proof, public_inputs)` (auth)
    - Checks status Active, correct floor, nonce monotonic.
    - Calls verifier, reads `is_correct`.
    - Emit Attempt event.
    - If correct → advance floor; gates on 1 & 5 wait for both players.
    - On floor 10 success → call hub `end_game()`, set Finished, emit GameFinished.
- Events: LobbyCreated, LobbyJoined, CommitSet, GameStarted, Attempt, FloorCleared, GateLocked, GameFinished, HubStartCalled, HubEndCalled.

## 6) Frontend (game studio app)
- Fullscreen Three.js dungeon, 4 rune pedestals.
- Pointer lock on desktop; touch joystick on mobile.
- WebWorker for proving: inputs -> proof + `is_correct`; UI shows “Proving…” and “Confirming…” overlays.
- Lobby UI: create/join, show lobby_id, copy join code, opponent floor beacon.
- Co-op gate UX on floors 1 & 5 (wait state until both cleared).
- HUD: floor, attempts, opponent floor, tx links for latest attempt.

## 7) Commands to use
- Dev server: `bun run dev:game the-farm`
- Build contracts: `bun run build the-farm`
- Deploy contracts: `bun run deploy the-farm`
- Publish production bundle: `bun run publish the-farm --build`

## 8) Acceptance checklist
- Every door attempt sends a real ZK proof on-chain; wrong attempts return `is_correct=0` but still verify.
- Gates hold both players on floors 1 & 5 until both clear.
- start_game/end_game on hub contract are called exactly once per lobby.
- Proofs are non-replayable (nonce bound).
- Proving runs in worker; rendering stays smooth.

## 9) Integration back to smol-fe (later)
- Link from /labs/the-farm to the new game demo URL.
- Optionally surface latest tx hashes / receipts in the gallery modal.

Keep diffs small in smol-fe; bulk development happens in Stellar-Game-Studio fork.  
