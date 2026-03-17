# Product Scope Decision — PR #117

## Decision
**Choose Outcome A: Honest Bearer-Note Primitive.**

## Rationale
PR #117 contains a workable escrow-note core but does not contain core privacy-pool primitives (Merkle membership, anonymity-set relation, full statement-bound nullifier model).

## Smallest honest mainnet-worthy v1
1. Commitment-keyed escrow deposits.
2. Withdraw proofs with recipient/token/domain/nullifier fully bound in statement.
3. Strict anti-replay checks and adversarial tests.
4. Explicit bearer-custody and loss warnings.
5. Transparent upgrade/admin trust policy.

## Naming to adopt
- "Discombobulator Bearer Note (Research)"
- "Commitment Ticket Escrow"

## Naming to remove
- "Tornado Cash style"
- "privacy pool" (unless/anonymity-set architecture exists)
- "unlinkable mixer"
