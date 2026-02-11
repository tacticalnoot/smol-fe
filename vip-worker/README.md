# THE VIP Worker

Cloudflare Worker + Durable Object that handles VIP challenges, eligibility checks, and ciphertext-only chat relay.

## Quick start

```bash
cd vip-worker
pnpm install
pnpm dev -- --local-protocol=https
```

The worker exposes:

- `POST /api/vip/challenge` → issues a short-lived nonce
- `POST /api/vip/verify` → verifies the signed payload + qualifier and returns a room-scoped token
- `GET  /api/vip/ws?room=...&token=...` → WebSocket upgrade proxied to the `RoomsDO`

## Deployment

1. Set your Cloudflare account + project in `wrangler.toml` (routes, account_id).
2. Deploy migrations once:
   ```bash
   pnpm wrangler deploy --dry-run # verify
   pnpm wrangler deploy
   ```
3. Map a route such as `https://<your-pages-domain>/api/vip*` to this worker so the frontend can call it with relative paths.

## Config

`wrangler.toml` vars:

- `VIP_TOKEN_TTL_SECONDS` (default 600)
- `VIP_CHALLENGE_TTL_SECONDS` (default 300)
- `VIP_HORIZON_URL` (default `https://horizon.stellar.org`)

Durable Object binding: `VIP_ROOMS` (class `RoomsDO`).

## Privacy guardrails

- DO refuses any payload containing a `plaintext` field name.
- DO and Worker never log ciphertext or message bodies.
- History is kept in-memory only (last 50 messages) and cleared on restart.
