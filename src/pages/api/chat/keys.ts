
import type { APIRoute } from 'astro';
import { initDb, getDb } from '../../../lib/the-vip/db';
import { getSession } from '../../../lib/the-vip/auth';
import {
    createRateLimitResponse,
    enforceRateLimit,
    enforceSameOrigin,
    parseJsonBodyWithLimit,
    trimString,
} from "../../../lib/guardrails";

export const PUT: APIRoute = async (context) => {
    const { request, locals } = context;
    const originError = enforceSameOrigin(request);
    if (originError) return originError;

    const rate = await enforceRateLimit(request, {
        bucket: "api-chat-keys-put",
        limit: 80,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    try {
        const env = (locals as any).runtime?.env;
        if (!env?.DB) {
            return new Response('Server not configured (missing DB binding)', { status: 500 });
        }
        const db = await getDb(env);
        await initDb(db);

        const session = await getSession(request, db);
        if (!session) {
            return new Response('Unauthorized', { status: 401 });
        }

        const parsed = await parseJsonBodyWithLimit<{ publicKey?: unknown }>(request, 4096);
        if (!parsed.ok) return parsed.response;

        const publicKey = trimString(parsed.data.publicKey, 128).toLowerCase();
        if (!publicKey) {
            return new Response('Missing publicKey', { status: 400 });
        }
        if (!/^[0-9a-f]{64}$/.test(publicKey)) {
            return new Response('Invalid publicKey format', { status: 400 });
        }

        // Store user key
        await db.prepare(`
            INSERT INTO user_keys(address, x25519_pubkey, created_at)
VALUES(?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
x25519_pubkey = excluded.x25519_pubkey,
    created_at = excluded.created_at
        `).bind(session.address, publicKey, Date.now()).run();

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });

    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    }
};

export const GET: APIRoute = async (_context) => {
    // Check if we need to fetch SOMEONE else's key?
    // For MVP, maybe not needed if Server acts as KDC.
    // But good for debugging.
    return new Response('Not implemented', { status: 501 });
}
