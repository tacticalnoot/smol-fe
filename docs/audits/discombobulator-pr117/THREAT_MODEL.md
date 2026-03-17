# Threat Model — Discombobulator PR #117

## System goal (current)
Enable commitment-key escrow deposits and note-based withdrawals without claiming anonymity-set guarantees.

## Assets at risk
- Escrowed balances in commitment pool.
- Commitment ticket secrets (`secret`, `nullifier`, serialized `dck1:*`).
- User trust in privacy claims.

## Adversaries
- External attacker with stolen ticket.
- Integrator who overclaims privacy in UI.
- Insider/admin key compromise.
- Replay/tamper attacker targeting statement mismatch.

## Trust boundaries
1. Client-side note/proof assembly.
2. On-chain verifier + pool contract.
3. Wallet signing + RPC submission.
4. Product copy/UX guidance.

## Key threat scenarios
1. **Claim mismatch:** UX implies recipient-bound proof while chain does not enforce that field.
2. **Replay confusion:** weak domain tags allow cross-context ambiguity.
3. **Bearer compromise:** leaked ticket transfers effective withdrawal rights.
4. **Governance compromise:** verifier/wasm upgrades alter assumptions.

## Outcome A security objectives
- Enforce exact statement fields on-chain.
- Keep nullifier anti-replay robust and test-proven.
- Make bearer custody/loss consequences explicit.
- Eliminate anonymity-set marketing claims.
