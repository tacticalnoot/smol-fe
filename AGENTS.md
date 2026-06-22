# AGENTS.md — smol-fe

## Prime directive
This repo is a likely build surface for Smol/Mixtape/agentic music tooling.

For the current experiment, treat the Codex local workspace named `mixtape auto` as the preferred runtime/build target when it is available in Codex.

ChatGPT mobile remains the command surface. Codex should execute code/runtime work only when needed.

## Read first

If working from the broader Life OS context, read these AUTOPILOT files when available:

- `NOOT_HOME/START_HERE.md`
- `NOOT_HOME/CHATGPT_COMMAND_SURFACE.md`
- `NOOT_HOME/MONEY_ENGINE.md`
- `NOOT_HOME/402_PAYMENT_LAB.md`
- `NOOT_HOME/UNBLOCKING_PROTOCOL.md`

If those are not available locally, continue with the rules below.

## Current build thesis

Do not think narrowly as a single paid endpoint.

The goal is to turn Smol/Mixtape capabilities into agent-callable tools that can later connect to safe testnet payment rails.

First useful surface:

- Mixtape auto generation
- Smol prompt generation
- prompt upgrade for music creation
- payment rail comparison for tool access
- local/testnet HTTP 402-style access demo

## Safety

- Local/testnet only for payment experiments.
- No secrets committed.
- No mainnet movement.
- No live payment execution without exact current approval.
- No custody claims.

## Operating law

When broad work begins:

1. Inventory what exists in the local `mixtape auto` workspace if available.
2. Inventory this repo's stack.
3. Find the smallest working demo.
4. Prefer a local/testnet prototype over more documentation.
5. Create issues/specs only when runtime execution is blocked.
6. Report exact blockers and routes tried.

## Known stack from package.json

- Astro server output
- Cloudflare adapter
- Svelte
- Stellar SDK
- Stellar wallets kit
- pnpm
- tests via `node --test tests/*.test.js`
- e2e via Playwright
- checks via `svelte-check`

## Useful commands

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm check`
- `pnpm doctor`

## Done criteria for the Mixtape Auto 402 Lab

A useful first pass should produce:

- chosen first capability/tool
- local or testnet-only route
- one endpoint or callable function
- no secrets committed
- setup notes
- exact next patch
