# Mainnet Readiness Checklist — Outcome A

## Gate 1: Truth
- [x] All UI/docs/comments use Outcome A language. (PR #118 + this branch)
- [x] No anonymity-set/mixer overclaims remain. (enforced by copy-claims test)

## Gate 2: Statement Integrity
- [ ] Contract verifies full intended statement fields. (Phase 1 — requires circuit update)
- [x] Public input schema is versioned (`WITHDRAWAL_STATEMENT_VERSION`) and documented.

## Gate 3: Spend Safety
- [x] Replay/double-spend adversarial tests pass. (`test_double_spend_rejected`)
- [x] Nullifier burn happens only after successful withdrawal flow. (`test_invalid_proof_rejected`)

## Gate 4: Domain Separation
- [x] Network/contract/pool/token/version all bound in client-side statement hash (`buildWithdrawalStatementPublicInputs`).
- [ ] Domain hash enforced on-chain by verifier. (Phase 1 — requires circuit update)

## Gate 5: Auth
- [x] Auth requirements explicit: depositor.require_auth() on deposit.
- [ ] Admin/upgrade trust model fully tested and surfaced to users.

## Gate 6: Asset Safety
- [x] No known drain path in validated model (nullifier replay blocked, duplicate commitment blocked).
- [ ] Full formal security review pending.

## Gate 7: Operations
- [ ] Reproducible contract+circuit builds documented.
- [ ] Artifact provenance/checksum manifest published.

## Gate 8: User Safety
- [x] Bearer-ticket and irrecoverable-loss warnings present in UI (ticket display, redeem panel).
- [x] poseidon_only reduced-assurance notice surfaces in proof result UI.
- [x] "Research mode" banner present on pool section header.
- [x] Mandatory warning phrases enforced by automated test (`discombobulator-copy-claims.test.ts`).

## Gate 9: Audit
- [x] Audit documents assembled (`docs/audits/discombobulator-pr117/`).
- [ ] Independent external audit review pending.

## Gate 10: Recommendation
- [ ] Only claim "mainnet-ready" when Gates 1–9 are green.

## Current status
**NO-GO** — Gates 2 (partial), 4 (partial), 5 (partial), 7, 9 (external review), 10 are open.
Gates 1, 3, 8 are green. Statement/circuit hardening (Phase 1) is the critical path to mainnet.
