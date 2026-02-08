# THE FARM — Revamp Notes (Agent Handoff)

> **Last updated:** 2026-02-07
> **Status:** Plan written, awaiting user approval before implementation
> **Plan file:** `~/.claude/plans/jaunty-orbiting-bengio.md`

---

## What's Already Done (Pushed to main)

### Contract (Soroban Rust) — `contracts/tier-verifier/`
- **Rewritten** with real Groth16 on-chain verification using Protocol 25 BN254 host functions
- `verify_and_attest()` does full pairing check: `e(-pi_a, pi_b) * e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta) == 1`
- Soroban SDK upgraded 22.0.0 → 25.1.0
- Legacy `attest_tier()` kept for backwards compat
- **NOT YET DEPLOYED** — Jeff needs to deploy the upgraded WASM via `scripts/deploy-tier-verifier.mjs`

### Frontend ZK Modules — All fixed and pushed
- `zkProof.ts` — Proper BN254 serialization (CAP-0074), `verify_and_attest` support, fixed SDK
- `zkTypes.ts` — Single source of truth for all types
- `proof.ts` — Thin re-export + legacy SHA-256 helpers
- `zkGames.ts` — Fixed to `stellar-mainnet`, dead code removed
- `FarmBadge.svelte` — Imports from zkTypes
- `TheFarmCore.svelte` — Partial fix (proof submission, concept/live distinction)

### DO NOT Touch These
- `zkProof.ts`, `zkTypes.ts`, `zkGames.ts`, `proof.ts`, `FarmBadge.svelte` — Done
- `contracts/tier-verifier/` — Real Groth16 verifier, done
- `circuits/tier_proof/` — Real circom circuit
- `public/zk/` — Real compiled artifacts (wasm + zkey + vkey)

---

## The Big Revamp (Next Step)

### Goal
Transform TheFarmCore.svelte from a messy 2,400-line monolith into a **polished web3/web4 ZK dashboard** worthy of a $10K hackathon. Not a pile of cards — an intelligent, cohesive design.

### Design Language
- **Dark mode** (`#0a0f1a`) with subtle noise texture
- **Glassmorphism panels** — backdrop-blur, thin green borders
- **"Press Start 2P"** for headings only, clean sans-serif for body
- **Kale green** (`#9ae600`) used sparingly, not everywhere
- **Micro-interactions** — hover glows, smooth transitions
- Think: Zora meets Animal Crossing

### New Page Layout
```
Hero Banner — THE FARM title + tier + balance (one atmospheric section)
    ↓
Your Plot — Single glassmorphism panel for proof generation/verification
    ↓
Three Portals — 🎮 Arcade | ⚔️ Dungeon (locked) | 🌿 Greenhouse
    ↓
Proof Gallery — Compact horizontal strip (4 proofs: 1 live, 3 concept)
    ↓
ZK Arcade — Existing 3 games, reframed with arcade header
    ↓
Footer — Tech attribution (Protocol 25 · Groth16 · BN254)
```

### Replace Concept Proofs (Smol-native instead of random kale stuff)
| Kill | Replace With | What It Proves |
|------|-------------|----------------|
| Compost Pledge | **Melody Mint** | You minted N songs as NFTs |
| Sprout Sprint | **Mixtape Seal** | You curated a mixtape with N tracks |
| Field Escort | **First Listen** | You played N songs on the platform |

### Key Files to Modify
| File | Change |
|------|--------|
| `TheFarmCore.svelte` | Major template + CSS rewrite (the big one) |
| `public/proofs/smol-compost-pledge.json` | → `smol-melody-mint.json` |
| `public/proofs/smol-sprout-sprint.json` | → `smol-mixtape-seal.json` |
| `public/proofs/smol-field-escort.json` | → `smol-first-listen.json` |
| `labs/registry.json` | Update description + readiness |

### What Gets Removed
- Dreamboard badges section (5 placeholders → clutter)
- Compost Pledge, Sprout Sprint, Field Escort proofs
- Swaying stems animation, ambient audio toggle
- Duplicate tier/balance displays
- Landing CTA paragraph

### Build Verification
`npx astro check` — 0 new errors in farm files (21 pre-existing elsewhere are known)

### Push Target
`git push origin main` to `tacticalnoot/smol-fe`. Push after each major section.
