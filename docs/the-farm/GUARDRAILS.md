# THE FARM Guardrails

These scripts enforce the non-negotiables for `/labs/the-farm`.

## Scripts

- `scripts/the-farm/no-stubs.sh`
- `scripts/the-farm/no-leaks.sh`
- `scripts/the-farm/route-check.sh`
- `scripts/the-farm/typecheck.sh`

## What They Enforce

### `no-stubs.sh`
- Fails on `setTimeout(` inside THE FARM paths.
- Fails on `return true` inside verifier/attestation modules.
- Fails on forbidden wording (`fake`, `mock`, `dummy`, `placeholder`) in THE FARM logic.
- Fails on forbidden copy string `Verified on Stellar`.

### `no-leaks.sh`
- Fails on `console.*` lines that mention `proof|witness|salt|balance|publicSignals|receipt|seal`.
- Fails on `localStorage`/`sessionStorage` usage in THE FARM flow.
- Fails on network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`) in local verifier modules.

### `route-check.sh`
- Requires canonical route file `src/pages/labs/the-farm.astro`.
- Requires registry link `href: "/labs/the-farm"`.
- Fails if extra THE FARM page routes exist.
- Fails if non-canonical `/the-farm` route strings appear.

### `typecheck.sh`
- Runs strict TypeScript compile:
  - `npx tsc --noEmit --strict`

## Run

```bash
bash scripts/the-farm/no-stubs.sh
bash scripts/the-farm/no-leaks.sh
bash scripts/the-farm/route-check.sh
bash scripts/the-farm/typecheck.sh
```