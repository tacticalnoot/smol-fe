# NOOT_MIXTAPE_AUTO

This file is the bridge between ChatGPT mobile, the `smol-fe` GitHub repo, and the Codex local workspace named `mixtape auto`.

## Current status

A first scaffold exists in this repo:

- `src/lib/mixtapeAuto.mjs`
- `src/pages/api/mixtape-auto.json.ts`
- `tests/mixtape-auto.test.js`

This is not the final product. It is a local/testnet-safe starting surface that proves Smol/Mixtape capability can become a callable tool.

## What the scaffold does

The current scaffold exposes:

`/api/mixtape-auto.json`

- `GET` returns route metadata.
- `POST` accepts JSON input and returns a structured Mixtape Auto prompt plan.
- No secrets are required.
- No mainnet behavior is enabled.
- No live payment execution is enabled.

## Codex local target

When working in Codex, open the local workspace named:

`mixtape auto`

Then compare it against this repo and decide how the scaffold should connect to the real local runtime.

## Codex prompt

Read `AGENTS.md` and this file. Then:

1. Inventory the local `mixtape auto` workspace.
2. Compare it to this `smol-fe` scaffold.
3. Run available checks:
   - `pnpm test`
   - `pnpm check`
   - `pnpm build`
4. Fix any import/path/type issues caused by the scaffold.
5. Decide whether `/api/mixtape-auto.json` should stay in `smol-fe`, move into the local workspace, or become a shared package.
6. Keep all payment behavior local/testnet only.
7. Do not commit secrets.
8. Produce a PR or exact patch summary.

## First product thesis

Do not think narrowly as one endpoint.

Mixtape Auto should become a capability surface:

- prompt generator
- mixtape planner
- music workflow router
- paid-tool candidate
- 402/testnet payment lab candidate
- agent-callable creative service

## Next implementation steps

1. Verify the scaffold compiles.
2. Connect it to real Mixtape Auto logic if present locally.
3. Add richer input schema.
4. Add output formats for:
   - 380-char smol prompts
   - 2280-char structured prompts
   - mixtape sequence plans
   - cover/art prompts
5. Add a testnet-only payment gate only after the free/local endpoint works.

## Safety

- Local/testnet first.
- No secrets in repo.
- No mainnet payment movement.
- No custody claims.
- No live payment execution without exact current approval.
