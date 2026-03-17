# Executive Verdict — Discombobulator PR #117

## 1) What PR #117 actually implements today
PR #117 implements a **pre-alpha bearer-note escrow prototype**:
- Deposit stores a commitment-keyed escrow record `(commitment, token, amount, depositor)`.
- Withdraw verifies a Groth16 proof through external verifier client using exactly two public inputs (`amount`, `commitment`).
- Double-spend prevention is enforced by storage-backed `NullifierUsed(nullifier_hash)` checks.
- Recipient is runtime calldata for token transfer, not part of the on-chain verified statement.

## 2) What it only appears to implement
The current naming/copy can appear to imply a Tornado-like privacy pool, but the implementation does **not** currently provide:
- Merkle membership anonymity-set proofing,
- cryptographically enforced recipient/token/domain in withdrawal statement,
- on-chain enforcement of recipient hash computed in frontend,
- full privacy-pool unlinkability math.

## 3) Classification
This is closest to: **note-based bearer escrow + private-routing UX experiments**.

## 4) Narrowest honest label
> "Research bearer-note commitment escrow with nullifier replay guard."

## 5) Claims that must be removed now
- Any "Tornado Cash style" equivalence language.
- Any "privacy pool" claim that implies anonymity-set guarantees.
- Any "unlinkable mixer" claim beyond currently proven statement bounds.

## 6) Path choice
**Outcome A — Honest Bearer-Note Primitive.**
Outcome B requires circuit and contract architecture changes not present in PR #117.

## 7) Mainnet recommendation
**NO-GO** right now. Promote only after statement-integrity, domain separation, and truthful UX gates are all green.
