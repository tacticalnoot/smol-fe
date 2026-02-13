# THE FARM Evidence Pack

Date: 2026-02-12

## Guardrails

### `bash scripts/the-farm/no-stubs.sh`

```text
PASS: no stubs/no fake language/no forbidden copy
```

### `bash scripts/the-farm/no-leaks.sh`

```text
PASS: no leaks/no storage/no verifier network calls
```

### `bash scripts/the-farm/route-check.sh`

```text
PASS: canonical route /labs/the-farm only
```

### `bash scripts/the-farm/typecheck.sh`

```text
src/lib/the-vip/auth.ts(40,23): error TS2339: Property 'verifyTransactionSignature' does not exist on type 'typeof Utils'.
src/lib/the-vip/auth.ts(56,18): error TS2339: Property 'buildChallengeTx' does not exist on type 'typeof Utils'.
src/lib/the-vip/auth.ts(65,56): error TS2552: Cannot find name 'D1Database'. Did you mean 'IDBDatabase'?
...
src/test/zk-auth.test.ts(2,38): error TS2307: Cannot find module 'vitest' or its corresponding type declarations.
```

Status: fails due pre-existing non-FARM issues in `the-vip`/chat/test paths.

## Circom

Artifacts:
- `zk/circom-tier/artifacts/verification_key.json`
- `zk/circom-tier/artifacts/bundle.json`
- `zk/circom-tier/artifacts/samples/proof_invalid.json`
- `src/data/the-farm/circomBundle.ts`

### CLI verify output
Command:
- `bash zk/circom-tier/scripts/verify_samples.sh`

Output:

```text
== verifying sprout ==
[INFO] snarkJS: OK!
== verifying grower ==
[INFO] snarkJS: OK!
== verifying harvester ==
[INFO] snarkJS: OK!
== verifying whale ==
[INFO] snarkJS: OK!
== verifying edge ==
[INFO] snarkJS: OK!
== verifying invalid (should fail) ==
[ERROR] snarkJS: Invalid proof
```

### Browser timing evidence
Playwright browser-module run (warmed assets):

```text
circom-valid:  valid=true  durationMs=16  requestDelta=0
circom-invalid: valid=false durationMs=15  requestDelta=0
```

### Tamper-fail evidence
`invalid` Circom sample fails locally (`Groth16 verification returned false`) and via CLI (`Invalid proof`).

### 0-network during verify
In warmed-browser run, `requestDelta=0` for Circom verify calls.

## Noir

Artifacts:
- `.devcontainer/the-farm-noir/devcontainer.json`
- `scripts/the-farm/noir/open-container.md`
- `scripts/the-farm/noir/run.sh`
- `zk/noir-tier/artifacts/bundle.json`
- `src/data/the-farm/noirBundle.ts`

### Dev Container path
Use:
- `scripts/the-farm/noir/open-container.md`
- `bash scripts/the-farm/noir/run.sh`

### CLI verify output
Command:
- `bash zk/noir-tier/scripts/verify_samples.sh`

Output:

```text
PASS sprout
PASS grower
PASS harvester
PASS whale
PASS edge
FAIL invalid (expected)
```

### Browser timing evidence
Attempted browser execution for Noir verification in this environment exceeded a 300s headless timeout when running `verifyNoirProof` on the Noir sample.

Observed failure from worker-path attempt:

```text
NOIR_WORKER_RESULT={"ok":false,"error":"Uncaught TypeError: Cannot set property self of #<WorkerGlobalScope> which has only a getter"}
```

Status: browser timing sample for Noir is pending environment-specific tuning; CLI cryptographic verification is passing for valid/invalid samples.

### Tamper-fail evidence
`invalid` Noir sample fails as expected (`FAIL invalid (expected)`).

### 0-network during verify
Static guardrail check confirms no `fetch/XHR/ws` usage in `src/lib/the-farm/verifiers`.

## RISC0

Artifacts:
- `zk/risc0-tier/artifacts/bundle.json`
- `zk/risc0-tier/verifier-wasm/pkg/risc0_receipt_verifier_wasm.js`
- `src/data/the-farm/risc0Bundle.ts`

### CLI verify output
Command (Linux path used for toolchain compatibility):
- `bash -lc 'export PATH="$HOME/.cargo/bin:$PATH"; cd /mnt/c/Users/Jeff/Mixtape\ Auto/smol-fe && bash zk/risc0-tier/scripts/verify_samples.sh'`

Output:

```text
PASS sprout
PASS grower
PASS harvester
PASS whale
PASS edge
FAIL invalid (expected)
```

### Browser timing evidence
Playwright browser-module run (warmed assets):

```text
risc0-valid:   valid=true  durationMs=41  requestDelta=0
risc0-invalid: valid=false durationMs=40  requestDelta=0
```

### Tamper-fail evidence
`invalid` RISC0 sample fails locally (`RISC0 receipt verification returned false`) and via CLI (`FAIL invalid (expected)`).

### 0-network during verify
In warmed-browser run, `requestDelta=0` for RISC0 verify calls.

## Mainnet Attestation

Contract + client paths:
- `contracts/farm-attestations/src/lib.rs`
- `contracts/farm-attestations/scripts/deploy_mainnet.sh`
- `contracts/farm-attestations/scripts/invoke_attest_mainnet.sh`
- `src/lib/the-farm/attest/publishAttestationMainnet.ts`

Environment check:

```text
PUBLIC_MAINNET_RPC_URL=
PUBLIC_MAINNET_NETWORK_PASSPHRASE=
PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET=
```

Status:
- Mainnet deploy/invoke evidence is not complete in this environment because required vars are missing.
- UI remains gated and shows missing vars:
  - `PUBLIC_MAINNET_RPC_URL`
  - `PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET`

Required for full completion:
- Mainnet contract ID
- 3 mainnet tx hashes (Circom / Noir / RISC0)
- Stellar Expert links for each tx