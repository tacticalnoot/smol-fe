# The Farm Hackathon Toolchain Plan

Last updated: 2026-02-08
Scope: `src/components/labs/the-farm`

This is the real implementation plan for adding both requested tracks:

- Noir-based proving flow
- zkVM-based flow (RISC Zero)

Both tracks settle into the live Super Verifier contract:

- Contract ID: `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`
- Main entrypoint: `verify_and_attest`

## What is live now in The Farm UI

- One-click on-chain settlement for both tracks via the same Super Verifier rail.
- Artifact intake for real tool output manifests (`farm.toolchain.artifact.v1`).
- Judge-bundle export containing:
  - imported artifacts,
  - linked on-chain settlement tx records,
  - active contract + entrypoint metadata.

### Artifact schema (`farm.toolchain.artifact.v1`)

Noir / UltraHonk:

```json
{
  "schema": "farm.toolchain.artifact.v1",
  "trackId": "noir-ultrahonk",
  "artifactLabel": "tic-tac-tac-v1-mainnet",
  "generatedAt": "2026-02-09T00:00:00.000Z",
  "sourceCommit": "replace-with-git-sha",
  "sourceRepo": "tacticalnoot/smol-fe",
  "acirHash": "hex",
  "vkHash": "hex",
  "proofHash": "hex",
  "publicInputsHash": "hex"
}
```

RISC Zero zkVM:

```json
{
  "schema": "farm.toolchain.artifact.v1",
  "trackId": "risc0-zkvm",
  "artifactLabel": "pattern-runner-v1-mainnet",
  "generatedAt": "2026-02-09T00:00:00.000Z",
  "sourceCommit": "replace-with-git-sha",
  "sourceRepo": "tacticalnoot/smol-fe",
  "imageId": "hex",
  "journalHash": "hex",
  "receiptSealHash": "hex",
  "verifierDigest": "optional-hex"
}
```

## Why this structure

The current Farm page already has a production on-chain path through Super Verifier.
That makes it the canonical attestation rail.
New toolchains should feed it, not bypass it.

## Track A: Noir + UltraHonk on Soroban

### Learn phase

1. Install Noir CLI:
   - `curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash`
   - `noirup`
2. Run first Noir circuit:
   - `nargo new hello_world`
   - `nargo check`
   - `nargo execute`
3. Learn proving backend workflow with Barretenberg (`bb`).
4. Run the public `ultrahonk_soroban_contract` localnet flow end-to-end.

### Build phase for The Farm

1. Add one Noir circuit per game mechanic (tic/dodge/pattern).
2. Pin deterministic input schema from gameplay transcript.
3. Generate and version:
   - verification key (`vk`)
   - proof
   - public inputs
4. Verify in Soroban UltraHonk contract.
5. Emit a deterministic commitment from the verified run and submit through Super Verifier (`verify_and_attest`) as the canonical chain event.

### Judge evidence

- Reproducible command log for artifact generation.
- Tx hash for UltraHonk verification path.
- Tx hash for final Super Verifier attestation for the same run.
- vkey rotation note per release.

## Track B: RISC Zero zkVM bridge

### Learn phase

1. Install tooling:
   - `curl -L https://risczero.com/install | bash`
   - `rzup install`
   - `cargo risczero --version`
2. Scaffold and build:
   - `cargo risczero new farm_zkvm`
   - `cargo risczero build`
3. Learn receipt model:
   - receipt = journal + seal
   - verify against expected image ID
4. Optional: learn Bonsai remote proving and STARK-to-SNARK conversion.

### Build phase for The Farm

1. Move one game scorer into a zkVM guest.
2. Keep journal output compact and deterministic:
   - run hash
   - score class
   - domain separator
3. Verify receipt off-chain before any chain submit.
4. Store image ID manifest for release integrity.
5. Submit receipt-derived commitment through Super Verifier (`verify_and_attest`) for canonical on-chain settlement.

### Judge evidence

- Image ID manifest committed with release.
- Proof that mismatched image IDs fail verification.
- Receipt verification log tied to final on-chain tx hash.

## Protocol 25 alignment checklist

- Use CAP-0074 BN254 encoding consistently (especially G2 limb order).
- Keep vkey/proof artifact versions explicit.
- Always include fallback/error rails for stale on-chain vkeys (`update_vkey` path).
- Keep one-click on-chain UX, but keep advanced payload export for judges.

## Delivery order (recommended)

1. Noir track first (closest to Soroban verifier-native flow).
2. RISC Zero bridge second (receipt verification + commitment settlement).
3. Unified score board and badge logic via Super Verifier tx outcomes.

## Primary references

- Stellar ZK overview: https://developers.stellar.org/docs/build/apps/zk/overview
- CAP-0074 (BN254 host functions): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md
- Noir UltraHonk Soroban verifier: https://github.com/indextree/ultrahonk_soroban_contract
- RISC Zero receipts: https://dev.risczero.com/api/zkvm/receipts
- RISC Zero verifier contracts: https://dev.risczero.com/api/blockchain-integration/contracts/verifier
