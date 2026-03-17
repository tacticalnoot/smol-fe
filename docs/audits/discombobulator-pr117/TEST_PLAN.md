# Test Plan — Adversarial Coverage

## Contract tests
1. Reject proof when `recipient_hash` in statement does not match recipient arg.
2. Reject proof when token hash differs from deposited token.
3. Reject proof when domain hash differs (network/contract/pool/version mismatch).
4. Confirm nullifier cannot be replayed.
5. Confirm nullifier is not burned on failed transfer/proof.

## Integration tests
1. Happy path deposit → withdraw with full bound statement.
2. Tampered frontend payloads fail on-chain.
3. Cross-network replay attempts fail.
4. Statement version migration behavior is deterministic.

## UI/copy tests
1. Snapshot tests assert warning copy appears in ticket flows.
2. Lint/check tests fail if banned phrases reappear ("mixer", "unlinkable", "Tornado-style").
3. Proof mode badge reflects runtime mode accurately.

## Deterministic vectors
- Commitment encoding vectors.
- Nullifier derivation vectors.
- Domain hash vectors.
- Public input ordering vectors.
