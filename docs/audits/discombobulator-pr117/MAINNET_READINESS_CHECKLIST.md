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
- [x] Admin verifier-replacement and governance implications tested (`test_admin_can_replace_verifier`, `test_verifier_replacement_gates_future_withdrawals`).
- [x] Admin trust model disclosed in UI (commitment-ticket mode description + redeem panel).
- [ ] Admin key is a multisig / time-locked address — ops requirement, not code.

## Gate 6: Asset Safety
- [x] No known drain path in validated model (nullifier replay blocked, duplicate commitment blocked).
- [x] Verifier replacement security tested: frozen deposits if verifier swapped to reject-all.
- [ ] Full formal security review pending.

## Gate 7: Operations
- [x] Reproducible build instructions documented (`docs/audits/discombobulator-pr117/OPS_AND_PROVENANCE.md`).
- [x] Upgrade policy and emergency response documented (`OPS_AND_PROVENANCE.md §3-4`).
- [ ] Circuit artifact SHA-256 checksums published (requires Phase 1 circuit build).
- [ ] CI public-input-order guard active (requires Phase 1).

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
**NO-GO** — remaining open items all require external work:
- Gates 2, 4 (partial): on-chain statement/domain enforcement blocked on Phase 1 circuit update.
- Gate 7 (partial): circuit artifact checksums and CI guard pending Phase 1 build.
- Gate 9: independent external audit not yet started.
- Gate 10: gated on all above.

**Green** (all in-repo work complete): Gates 1, 3, 5 (code + tests), 6, 7 (docs), 8.

Critical path to mainnet: Phase 1 circuit hardening → external audit → multisig admin key.
