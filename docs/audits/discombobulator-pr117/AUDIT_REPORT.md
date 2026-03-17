# Audit Report — PR #117 (Severity Ranked)

## Scope reviewed
- `contracts/commitment-pool/src/lib.rs`
- `src/utils/discombobulator-commitment-key.ts`
- `src/utils/discombobulator-private-paths.ts`
- `src/components/labs/DiscombobulatorCore.svelte`
- `src/test/commitment-key.test.ts`
- `contracts/commitment-pool/test_snapshots/*`

---

## Critical Findings

### C1 — Recipient binding is presented in frontend but not enforced on-chain
- Frontend computes `recipientAddressHash` in proof artifact.
- Contract verification path submits only `[amount_bytes32, commitment]` to verifier.
- Therefore recipient-binding is **not cryptographically enforced on-chain**.

**Risk:** users can infer stronger guarantees than implementation provides.

### C2 — `nullifier_hash` is policy state, not part of proven relation
- Contract accepts/stores `nullifier_hash` and rejects re-use from storage.
- Current verified public input set excludes nullifier hash.

**Risk:** anti-replay guarantee depends on contract policy/state design only, not full proof statement binding.

### C3 — Domain separation missing from proven statement
- No explicit statement binding to network passphrase, contract ID, pool ID, token ID, or statement version.

**Risk:** replay/confusion risk across contexts and weak auditability of statement scope.

---

## High Findings

### H1 — Language overclaim risk (Tornado/mixer framing)
UI/comments imply privacy-pool properties that are not present cryptographically.

### H2 — Circuit intent mismatch (`kale_tier` reuse)
Current circuit relation is tier/commitment-oriented, not anonymity-set membership-oriented.

### H3 — Admin trust model under-communicated
Verifier replacement and contract upgrade are admin-authorized but not surfaced with strong user-facing trust disclosures.

---

## Medium Findings

### M1 — Missing adversarial coverage for statement tamper vectors
Tests should explicitly fail for recipient/token/domain mismatch assumptions.

### M2 — Dual mode confusion (`groth16_circuit` vs `poseidon_only`)
Fallback is useful for development, but must be surfaced as reduced assurance in product UX.

---

## Low Findings

### L1 — Terminology drift
"Private", "pool", "ticket", and "commitment" are used with inconsistent threat-model semantics across files.

---

## Recommended immediate direction
Adopt **Outcome A** now:
1. Truthful naming and docs.
2. Statement schema hardening.
3. Domain separation.
4. Adversarial tests.
5. Explicit bearer-risk UX.
