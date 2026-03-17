# Ops & Provenance — Discombobulator Outcome A

## Gate 7 Requirements
- Reproducible contract + circuit builds documented.
- Artifact provenance / checksum manifest published.
- Upgrade policy and emergency response documented.

---

## 1. Contract Build Reproducibility

### Soroban contract (`contracts/commitment-pool/`)

```bash
# Install Rust + wasm target
rustup target add wasm32v1-none

# Reproducible build (locked deps, no incremental)
cargo build --release --target wasm32v1-none --locked \
  --manifest-path contracts/commitment-pool/Cargo.toml

# Output artifact
contracts/commitment-pool/target/wasm32v1-none/release/commitment_pool.wasm

# Compute checksum
sha256sum contracts/commitment-pool/target/wasm32v1-none/release/commitment_pool.wasm
```

Two independent builds from the same source commit and locked Cargo.lock **must** produce identical SHA-256 checksums. Any mismatch indicates a build environment or toolchain difference.

### Contract test suite

```bash
# Run Soroban unit tests (requires soroban-sdk test harness)
cargo test --manifest-path contracts/commitment-pool/Cargo.toml
```

All tests must pass before publishing a WASM artifact.

---

## 2. Circuit Artifact Provenance

The ZK circuit artifacts (`tier_proof.wasm`, `tier_proof.zkey`, `verification_key.json`) are **not** compiled in this repo. They are served from `/zk/` and consumed by the frontend.

### Required provenance for each circuit release

| Artifact | Expected SHA-256 | Source commit | Builder |
|---|---|---|---|
| `tier_proof.wasm` | `<pending>` | `<pending>` | `<pending>` |
| `tier_proof.zkey` | `<pending>` | `<pending>` | `<pending>` |
| `verification_key.json` | `<pending>` | `<pending>` | `<pending>` |

**Action required (Phase 1):** Populate this table with real checksums before any mainnet deployment. Pin served artifacts to these values and add a CI check that rejects drift.

### Public input order guard

A CI lint step must fail if `buildWithdrawalStatementPublicInputs` in
`src/utils/discombobulator-commitment-key.ts` reorders its output array without
bumping `WITHDRAWAL_STATEMENT_VERSION`. Suggested implementation:

```bash
# In CI: snapshot the output of buildWithdrawalStatementPublicInputs index
# order and compare to a committed golden file.
# Any reorder without a version bump is a breaking change.
```

---

## 3. Upgrade Policy

### Contract upgrade path

- `upgrade(new_wasm_hash)` is admin-only. Admin must call `require_auth()`.
- Before any upgrade: publish new WASM checksum and diff to a public changelog.
- After upgrade: verify `withdraw_statement_version()` matches expected value.
- Emergency downgrade: re-deploy prior WASM hash via same `upgrade()` path.

### Verifier replacement

- `set_verifier(verifier)` is admin-only.
- Replacing the verifier **freezes all outstanding deposits** if the new verifier
  uses a different verification key. Users cannot withdraw until a compatible
  verifier is restored.
- Pre-announce verifier replacements with ≥ 72-hour notice.
- Post-replacement: verify a test withdrawal proof against the new verifier
  before announcing the change as complete.

### Trust disclosure to users

Users must be shown the following before depositing:

> "This contract is upgradeable by an admin key. The verifier contract
> can also be replaced by the admin. This means an admin key compromise
> or a malicious upgrade could affect escrowed funds. Treat this as a
> research prototype, not a trustless system."

Current status: this warning is displayed in the UI commitment-ticket mode
description. See `src/components/labs/DiscombobulatorCore.svelte` pool section.

---

## 4. Emergency Response

| Scenario | Response |
|---|---|
| Admin key compromise | Immediately call `upgrade()` to a frozen WASM that blocks all withdrawals; rotate admin via new deploy |
| Verifier key leaked | Replace verifier via `set_verifier()` before any malicious proof can be submitted |
| Double-spend exploit found | Freeze contract via upgrade; assess nullifier storage state |
| Circuit soundness break | Replace verifier with a reject-all stub; pause until new circuit is audited |

---

## 5. Checklist Before Mainnet Deploy

- [ ] Contract WASM SHA-256 published and matches reproducible build.
- [ ] Circuit artifact checksums published (`tier_proof.wasm`, `.zkey`, `vkey.json`).
- [ ] Public input order locked and CI guard active.
- [ ] Admin key is a multisig or time-locked address (not a hot wallet).
- [ ] Upgrade policy disclosed in product UI.
- [ ] At least one independent verifier build confirmed by a third party.
- [ ] Emergency response contacts and runbook shared with team.
