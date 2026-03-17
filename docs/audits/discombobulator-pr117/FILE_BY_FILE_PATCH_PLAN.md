# File-by-File Patch Plan

## contracts/commitment-pool/src/lib.rs
- Expand verifier public input schema to include recipient/token/domain/nullifier fields.
- Add explicit statement version constant and input order checks.
- Add tests for recipient/token/domain tamper rejection.

## src/utils/discombobulator-commitment-key.ts
- Align generated proof statement with hardened contract schema.
- Remove any implication of on-chain recipient binding unless verified fields include it.
- Replace "Tornado Cash alignment" wording with neutral protocol-alignment wording.

## src/utils/discombobulator-private-paths.ts
- Clarify DEX routing is obfuscation, not shielded-pool anonymity.
- Keep mode labels consistent with Outcome A terminology.

## src/components/labs/DiscombobulatorCore.svelte
- Rewrite labels/tooltips/banners to truthful Outcome A language.
- Add hard warnings around ticket custody and loss.
- Surface proof mode assurance level in UI.

## src/test/commitment-key.test.ts
- Add vectors and tests for domain-separated statement construction.
- Add negative tests for recipient/token/domain mismatch assumptions.

## contracts/commitment-pool/test_snapshots/*
- Regenerate snapshots after input schema changes.
- Include new failure-path snapshots for tamper attempts.

## circuit/proof artifact surfaces
- Publish artifact checksums and statement schema doc.
- Add CI guard for public input order drift.
