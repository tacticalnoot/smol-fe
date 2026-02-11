# Inventory — The Farm (smol-fe) — 2026-02-11

- **Contract methods (authoritative source)**: `../Stellar-Game-Studio-1/contracts/the-farm/src/lib.rs` exposes `__constructor`, `create_lobby`, `join_lobby`, `set_commit` (starts hub on ready), `attempt_door(lobby_id, player, floor, attempt_nonce, public_inputs, proof)` with on-chain Groth16 verification, plus `get_lobby`, admin/hub getters-setters, and `upgrade`.

- **Multiplayer model**:
  - React bundle shipped at `public/labs/the-farm/client/` (built from SGS `the-farm-frontend`) polls `get_lobby` in lobby/game routes and derives floor/nonce/status directly from chain before and after attempts.
  - Native Svelte dungeon (`src/components/labs/the-farm/dungeon/ZkDungeonGame.svelte`) tracks lobby code + floors locally; hub `start_game`/`end_game` are invoked but both players default to the same wallet (solo). No on-chain lobby state is read back.

- **Proof verification status**:
  - Svelte dungeon generates real Groth16 proofs via `src/components/labs/the-farm/dungeon/dungeonProofWorker.ts` (uses `tier_proof.wasm/.zkey`, Poseidon commitment) and verifies locally; `attemptDoor` currently returns `txHash: null` (not submitted on-chain) in `.../dungeonService.ts`.
  - React bundle proof path is now real and dual-stack: worker `zkProver.worker.ts` always generates Groth16 for on-chain verification and additionally runs Noir+UltraHonk on noir floors using artifact `src/games/the-farm/zk/noir/noirAttemptProgram.json`; `theFarmApi.ts` submits Groth16 proof bytes to `attempt_door`, and contract verifies on-chain before progression.

- **Wallet signing**:
  - Passkey / SAC signing lives in `src/utils/passkey-kit.ts` (PasskeyKit + SACClient using `getRpcUrl()` and `PUBLIC_NETWORK_PASSPHRASE`); hub calls in `dungeonService.ts` sign via `signAndSendTestnet`.
  - Embedded React client (in `public/labs/the-farm/client`) still uses SGS hooks: `useWallet.ts` (dev secrets via `devWalletService`) and `useWalletStandalone.ts` (Stellar Wallets Kit) to provide `signTransaction`/`signAuthEntry`.

- **Network / RPC selection**:
  - Svelte dungeon hardcodes Soroban testnet (`TESTNET_RPC` + `Networks.TESTNET` in `src/components/labs/the-farm/dungeon/dungeonService.ts`).
  - PasskeyKit/global utilities choose RPC via `src/utils/rpc.ts` (`PUBLIC_RPC_URL` + mainnet fallbacks) and env `PUBLIC_NETWORK_PASSPHRASE`; hub calls override with testnet constants.
  - React bundle carries build-time env from SGS (`VITE_SOROBAN_RPC_URL` etc.) baked into `public/labs/the-farm/client/assets`.
  - Build sync pipeline (`scripts/sync-the-farm-client.mjs`, `package.json` `build:the-farm-client`) compiles SGS frontend and copies `dist` into `public/labs/the-farm/client`.

- **Hub start_game / end_game calls**:
  - Svelte dungeon triggers `callStartGame` when a run begins and `callEndGame` on victory (`ZkDungeonGame.svelte` → `dungeonService.ts`), targeting hub `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`.
  - React client relies on the Soroban contract itself to call hub (`set_commit` → `start_game`, `attempt_door` win path → `end_game`), with no explicit hub invocation in JS.
  - Added in-site play aliases: `src/pages/labs/the-farm/play.astro` and `src/pages/zkdungeon/play.astro` redirect to `/labs/the-farm/client/play`.
