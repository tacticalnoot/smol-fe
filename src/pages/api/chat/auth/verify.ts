import type { APIRoute } from "astro";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { verifyChallengeTx } from "../../../../lib/the-vip/auth";
import { initDb, getDb } from "../../../../lib/the-vip/db";
import {
  createRateLimitResponse,
  enforceRateLimit,
  parseJsonBodyWithLimit,
  trimString,
} from "../../../../lib/guardrails";

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const rate = await enforceRateLimit(request, {
    bucket: "api-chat-auth-verify",
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  try {
    const env = (locals as any).runtime?.env;
    if (!env?.DB) {
      return new Response("Server not configured (missing DB binding)", {
        status: 500,
      });
    }

    const parsed = await parseJsonBodyWithLimit<{
      xdr?: string;
      address?: string;
      zkProof?: unknown;
    }>(request, 8192);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    if (body.zkProof) {
      // This endpoint previously attempted server-side Noir proof verification. It was incomplete and
      // is intentionally disabled to avoid "pretend proofs" and false security claims.
      return new Response(JSON.stringify({ error: "ZK auth is not supported" }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });
    }

    const xdr = trimString(body.xdr, 6000);
    const address = trimString(body.address, 80);

    if (!xdr || !address) {
      return new Response(JSON.stringify({ error: "Invalid auth request" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return new Response(JSON.stringify({ error: "Invalid Stellar address" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const serverSecret = env?.CHAT_SERVER_SECRET || process.env.CHAT_SERVER_SECRET;
    if (!serverSecret) {
      return new Response(JSON.stringify({ error: "Missing CHAT_SERVER_SECRET" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const serverKeypair = Keypair.fromSecret(serverSecret);
    const networkPassphrase =
      env?.PUBLIC_NETWORK_PASSPHRASE ||
      process.env.PUBLIC_NETWORK_PASSPHRASE ||
      "Public Global Stellar Network ; September 2015";

    const result = await verifyChallengeTx(
      xdr,
      address,
      networkPassphrase,
      serverKeypair.publicKey(),
    );

    if (!result.valid) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    const db = await getDb(env);
    await initDb(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        type TEXT DEFAULT 'wallet',
        expires_at INTEGER NOT NULL
      );
    `);

    await db
      .prepare("INSERT INTO sessions (token, address, type, expires_at) VALUES (?, ?, ?, ?)")
      .bind(token, address, "wallet", expiresAt)
      .run();

    return new Response(JSON.stringify({ token, address }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    console.error("Chat auth verify error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

