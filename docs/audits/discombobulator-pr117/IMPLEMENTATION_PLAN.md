# Implementation Plan — Outcome A Hardening

## Phase 0 (truth and harm reduction)
- Remove overclaiming privacy language in docs/comments/UI.
- Add unavoidable warnings where commitment ticket is generated/imported/exported.
- Surface proof assurance mode (`groth16_circuit` vs `poseidon_only`) with clear risk text.

## Phase 1 (statement integrity)
- Update circuit statement to include recipient hash, token hash, domain hash, and nullifier binding.
- Update contract withdraw verification to enforce exact public input schema.
- Add strict versioning for statement layout.

## Phase 2 (domain separation)
- Bind network, contract, pool, token, and protocol version in statement hash.
- Add deterministic test vectors for domain and statement encodings.

## Phase 3 (security + ops)
- Reproducible builds for wasm/circuit artifacts.
- Publish artifact checksum manifest and provenance.
- Document upgrade policy and emergency response.

## Phase 4 (product readiness)
- Rewrite Labs copy to honest scope.
- Add user education: ticket loss, transfer risk, and non-recoverability.
- Gate any "mainnet" label on readiness checklist pass.
