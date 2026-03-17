# Mainnet Readiness Checklist — Outcome A

## Gate 1: Truth
- [ ] All UI/docs/comments use Outcome A language.
- [ ] No anonymity-set/mixer overclaims remain.

## Gate 2: Statement Integrity
- [ ] Contract verifies full intended statement fields.
- [ ] Public input schema is versioned and immutable per release.

## Gate 3: Spend Safety
- [ ] Replay/double-spend adversarial tests pass.
- [ ] Nullifier burn happens only after successful withdrawal flow.

## Gate 4: Domain Separation
- [ ] Network/contract/pool/token/version all bound in statement.

## Gate 5: Auth
- [ ] Auth requirements are explicit and tested.

## Gate 6: Asset Safety
- [ ] No known drain path in validated model.

## Gate 7: Operations
- [ ] Reproducible contract+circuit builds documented.
- [ ] Artifact provenance/checksum manifest published.

## Gate 8: User Safety
- [ ] Bearer-ticket and irrecoverable-loss warnings are unavoidable.

## Gate 9: Audit
- [ ] Independent audit package assembled and reviewed.

## Gate 10: Recommendation
- [ ] Only claim "mainnet-ready" when Gates 1–9 are green.

## Current status
**NO-GO** until statement/domain/UX and ops gates are closed.
