<!--
CONTRACT:
- SSOT: [STATE_OF_WORLD.md](../STATE_OF_WORLD.md)
- AUDIENCE: Agent, Dev
- NATURE: Prompt
- LAST_HARDENED: 2026-03-17
- VERIFICATION_METHOD: [Claim check]
-->
# Mainnet-Grade Discombobulator Upgrade Mandate

**PR Context:** smol-fe PR #117 (merged)  
**Target:** The Discombobulator (Labs)  
**Destination:** Mainnet — only after all gates in this prompt are green.  
**Constraint:** No testnet crutch. Local/unit/integration simulation is allowed for proof.

You are the lead Soroban architect, ZK systems expert, security auditor, and redesign authority for Smol’s Discombobulator.

You have total freedom to:
- rename/delete features
- replace weak crypto
- redesign contracts, proofs, storage, and UI flows
- change naming, scope, and architecture
- reject the current design entirely and start from zero if needed

Your job is to make this real. No fake privacy claims. No "Tornado-style" language unless the implementation actually matches Tornado-grade guarantees (commitment membership set + nullifier set + full statement integrity).

---

## Primary Mission

Review every file in PR #117 and force the system into one—and only one—honest outcome:

### Outcome A — Honest Bearer-Note Primitive
A scoped note-based bearer ticket system (deposit → secret ticket → ZK withdrawal to any address) with cryptographically enforced nullifier + domain separation. No anonymity-set claims.

### Outcome B — Real Privacy Pool
A genuine shielded pool with Merkle membership proofs, nullifier set, public-input statement integrity, and honest anonymity-set math.

Pick exactly one. If current code is neither, redesign from truth. Do not preserve ambiguous middle-ground.

---

## Required Source Set (must be used)
- https://github.com/tacticalnoot/smol-fe/pull/117 (full diff + all files)
- Local repo code for the same surfaces in `contracts/` and `src/`
- https://github.com/stellar/stellar-dev-skill (`zk-proofs.md`, `contracts-soroban.md`, `security.md`, `common-pitfalls.md` minimum)
- Official Stellar docs:
  - https://developers.stellar.org/docs/build/apps/zk
  - https://developers.stellar.org/docs/build/smart-contracts
  - https://developers.stellar.org/docs/networks/resource-limits-fees
  - CAP-0074 (BN254 host functions)
  - CAP-0075 (Soroban upgrades)
  - Soroban example contracts + stellar-protocol repo

If the PR URL is inaccessible, use local merge base + commit history and state the fallback explicitly.

---

## Evidence Protocol (non-optional)
1. Build an explicit table of proven statement fields vs UI-computed fields.
2. For every finding, include exact file path + line references.
3. Mark each claim as one of:
   - **ENFORCED ON-CHAIN**
   - **ENFORCED OFF-CHAIN ONLY**
   - **NOT ENFORCED**
4. Any uncertainty must be written as an open research question, not a confident claim.

No invented guarantees. No "vibes". No role-play language.

---

## First Output: Executive Truth (answer plainly first)
1. What does PR #117 actually implement today?
2. What does it only appear to implement?
3. Is it a note generator, bearer-note escrow, partial private payment, or fake mixer shell?
4. What is the narrowest honest label for it today?
5. Which claims must be removed immediately (especially any "Tornado Cash style", "full privacy pool", "unlinkable mixer", etc.)?

---

## Mandatory Audit Sections (run in order)

### A) Proof Statement Integrity
Map all private/public inputs, witness mapping, and verified statement fields. Check whether the contract enforces exactly what frontend/circuit computes (`commitment`, `nullifier_hash`, `recipient`, `amount`, `token`, `network_id`, etc.). Flag anything computed but not bound.

### B) Replay / Double-Spend / Spend Safety
Prove (or disprove) that replay, double-spend, and drain are impossible under stated assumptions. If exploitable, provide attack path, prerequisites, and blast radius.

### C) Domain Separation
Verify protocol version, network passphrase hash, contract ID, pool ID, token identity, statement version are bound in cryptographic statement.

### D) Soroban Contract Security
Audit auth, storage class usage (persistent vs instance), TTL strategy, external calls, upgrade path, token handling, failure atomicity, and events.

### E) Frontend / UX Truthfulness
Rewrite all labels/tooltips/warnings/empty states so they never overclaim privacy, finality, or unlinkability.

### F) Testing Quality
Audit current tests and snapshots. Add missing adversarial coverage (auth, tamper, replay, wrong-recipient, wrong-token, archival, resource limits).

### G) Mainnet Operational Readiness
Define deployment ceremony, reproducible builds, artifact provenance, upgrade governance, incident response, and user note-loss handling.

---

## Decision Gate
After audit, choose exactly one path (A or B) and justify with constraints, timeline, and risk. Prefer truthful scope over complexity. Delete misleading behavior before preserving compatibility.

---

## Mandatory “Make It Real” Questions (answer explicitly)
1. Is the current design a category error vs true Tornado/privacy-pool architecture?
2. Should `kale_tier` be scrapped or fixed for this product goal?
3. What is the smallest honest mainnet-worthy v1?
4. What must be added for real privacy-pool properties?
5. What user-fund loss modes exist today?
6. Correct ownership split: frontend note tooling / verifier / pool contract / relayer.
7. Compliance-forward guardrails that belong in v1.
8. Naming that replaces "Tornado Cash style".
9. Concrete changes that make this respectable instead of cosplay.

---

## Mainnet Readiness Gates (all must be green)
1. Truth Gate — honest naming/docs
2. Statement Gate — proof/contract alignment
3. Spend Safety Gate — no replay/double-spend
4. Domain Separation Gate
5. Auth Gate — exact auth tested
6. Asset Safety Gate
7. Ops Gate — reproducible builds
8. User Safety Gate — clear irreversible-risk warnings
9. Audit Gate — external audit package ready
10. Mainnet Recommendation Gate — only claim "mainnet-ready" if 1–9 are green

---

## Required Deliverables (exact order)
1. `EXECUTIVE_VERDICT.md`
2. `AUDIT_REPORT.md` (severity-ranked findings)
3. `THREAT_MODEL.md`
4. `CRYPTO_SPEC.md` (exact formulas, inputs, domain rules)
5. `PRODUCT_SCOPE_DECISION.md` (Path A or B + rationale)
6. `IMPLEMENTATION_PLAN.md` (hotfixes + refactors)
7. `TEST_PLAN.md` (adversarial tests)
8. `UI_COPY_PATCH.md` (rewritten copy)
9. `FILE_BY_FILE_PATCH_PLAN.md`
10. `MAINNET_READINESS_CHECKLIST.md`

Each document must include: assumptions, explicit risks, and pass/fail criteria.

---

## Files to Review Explicitly (minimum)
- `contracts/commitment-pool/src/lib.rs`
- `src/utils/discombobulator-commitment-key.ts`
- `src/utils/discombobulator-private-paths.ts`
- `src/components/labs/DiscombobulatorCore.svelte`
- `src/test/commitment-key.test.ts`
- all snapshots under `contracts/commitment-pool/test_snapshots/`
- any circuit/proof generation code
- all UI copy mentioning privacy/ticket/redeem/pool

---

## Final Output Format (exact order)
1. EXECUTIVE VERDICT
2. WHAT PR #117 REALLY IS
3. WHAT IT FALSELY IMPLIES
4. CRITICAL FINDINGS
5. HIGH/MEDIUM FINDINGS
6. PATH CHOICE (A or B)
7. MAINNET READINESS STATUS
8. REQUIRED ARCHITECTURE CHANGES
9. FILE-BY-FILE PATCH PLAN
10. TEST PLAN
11. UI/COPY PATCHES
12. OPEN RESEARCH QUESTIONS
13. FINAL GO / NO-GO

**Final rule:** If this is closer to cryptographic note theater than real privacy infrastructure, say so plainly and redesign from zero.
