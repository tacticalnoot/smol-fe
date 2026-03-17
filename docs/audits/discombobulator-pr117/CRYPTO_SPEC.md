# Crypto Spec — Outcome A (Hardened Bearer-Note Primitive)

## Current relation in PR #117
- `C = Poseidon(secret, amount, nullifier)`
- On-chain verified public inputs: `[amount, C]`
- Replay guard: storage boolean keyed by `nullifier_hash`

## Required relation for mainnet-worthy Outcome A

### Domain tag
`D = H(protocol_version, network_passphrase_hash, contract_id, pool_id, token_id, statement_version)`

### Note commitment
`C = Poseidon(secret, amount, nullifier, token_id_hash, pool_id_hash, D)`

### Nullifier (recommended)
`N = Poseidon(nullifier, C, D)`

### Withdrawal public inputs (minimum)
1. `C`
2. `N`
3. `amount`
4. `token_id_hash`
5. `recipient_hash`
6. `D`

## Enforcement rules
- Contract must verify fixed-length, fixed-order public inputs.
- Contract must reject any token/recipient/domain mismatch.
- Nullifier marked spent only after successful proof + transfer path.

## Explicit non-goals for Outcome A
- No Merkle tree membership set.
- No anonymity-set claims.
- No Tornado-equivalence claim.
