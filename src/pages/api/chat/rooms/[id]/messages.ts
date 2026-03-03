import type { APIRoute } from 'astro';
import { getDb, initDb } from '../../../../../lib/the-vip/db';
import { getSession } from '../../../../../lib/the-vip/auth';
import { ROOMS, isRoomAccessible } from '../../../../../lib/the-vip/rooms';
import {
    createRateLimitResponse,
    enforceRateLimit,
    enforceSameOrigin,
    parseJsonBodyWithLimit,
    trimString,
} from '../../../../../lib/guardrails';

export const GET: APIRoute = async (context) => {
    const { request, locals, params } = context;
    const rate = await enforceRateLimit(request, {
        bucket: "api-chat-room-messages-get",
        limit: 180,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    const env = (locals as any).runtime?.env;
    if (!env?.DB) {
        return new Response('Server not configured (missing DB binding)', { status: 500 });
    }

    const db = await getDb(env);
    await initDb(db);
    const session = await getSession(request, db);
    if (!session) return new Response('Unauthorized', { status: 401 });

    const roomId = params.id;
    if (!roomId) return new Response('Room ID required', { status: 400 });

    // Validate room exists and is not disabled
    const room = ROOMS.find(r => r.id === roomId);
    if (!room) return new Response('Room not found', { status: 404 });
    if (room.disabled) return new Response('Room is disabled', { status: 403 });

    // Check room-level access (gated rooms require eligibility)
    if (!isRoomAccessible(roomId, session.address)) {
        return new Response('Room access denied', { status: 403 });
    }

    // Fetch messages
    // Default limit 50
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');

    let query = `SELECT * FROM messages WHERE room_id = ?`;
    const args: any[] = [roomId];

    if (cursor) {
        if (!/^\d+$/.test(cursor)) {
            return new Response('Invalid cursor', { status: 400 });
        }
        query += ` AND id < ?`;
        args.push(parseInt(cursor, 10)); // Simple ID cursor
    }

    query += ` ORDER BY id DESC LIMIT 50`;

    const { results } = await db.prepare(query).bind(...args).all();

    // Get current Epoch to help client self-heal
    const roomKeyRow = await db.prepare('SELECT epoch FROM room_keys WHERE room_id = ?').bind(roomId).first();
    const currentEpoch = roomKeyRow ? roomKeyRow.epoch : 0;

    return new Response(JSON.stringify({
        messages: results.reverse(),
        meta: { currentEpoch }
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};

export const POST: APIRoute = async (context) => {
    const { request, locals, params } = context;
    const originError = enforceSameOrigin(request);
    if (originError) return originError;

    const rate = await enforceRateLimit(request, {
        bucket: "api-chat-room-messages-post",
        limit: 120,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    const env = (locals as any).runtime?.env;
    if (!env?.DB) {
        return new Response('Server not configured (missing DB binding)', { status: 500 });
    }

    const db = await getDb(env);
    await initDb(db);
    const session = await getSession(request, db);
    if (!session) return new Response('Unauthorized', { status: 401 });

    const roomId = params.id;
    if (!roomId) return new Response('Room ID required', { status: 400 });

    // Validate room exists and is not disabled
    const room = ROOMS.find(r => r.id === roomId);
    if (!room) return new Response('Room not found', { status: 404 });
    if (room.disabled) return new Response('Room is disabled', { status: 403 });

    // Check room-level access
    if (!isRoomAccessible(roomId, session.address)) {
        return new Response('Room access denied', { status: 403 });
    }

    const parsed = await parseJsonBodyWithLimit<{ ciphertext?: unknown; nonce?: unknown }>(
        request,
        24_000
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const ciphertext = trimString(body.ciphertext, 20_000);
    const nonce = trimString(body.nonce, 256);

    if (!ciphertext || !nonce) {
        return new Response('Missing ciphertext or nonce', { status: 400 });
    }

    // Rate limit?
    // Size limit?
    if (ciphertext.length > 10000) {
        return new Response('Message too large', { status: 400 });
    }

    // Pseudonym for sender
    // Hash(address + SALT) so we don't store raw address on the message row (privacy hardening).
    // Or just use address if we don't care about metadata privacy vs DB admin.
    // Prompt says: "sender pseudonymous id (hash of account + server salt)".
    const salt = (env as any).CHAT_SALT || 'salt';
    // simple hash
    const senderHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session.address + salt))
        .then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16));


    await db.prepare(`
        INSERT INTO messages (room_id, sender_hash, ciphertext, nonce, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).bind(roomId, senderHash, ciphertext, nonce, Date.now()).run();

    return new Response(JSON.stringify({ success: true, id: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
};
