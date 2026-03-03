import type { APIRoute } from 'astro';
import { buildChallenge } from '../../../../lib/the-vip/auth';
import { StrKey } from '@stellar/stellar-sdk';
import {
    createRateLimitResponse,
    enforceRateLimit,
    parseJsonBodyWithLimit,
    trimString,
} from "../../../../lib/guardrails";

export const POST: APIRoute = async (context) => {
    const { request, locals } = context;
    const rate = await enforceRateLimit(request, {
        bucket: "api-chat-auth-challenge",
        limit: 40,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    try {
        const parsed = await parseJsonBodyWithLimit<{ address?: unknown }>(request, 4096);
        if (!parsed.ok) return parsed.response;

        const address = trimString(parsed.data.address, 80);
        if (!address) {
            return new Response(JSON.stringify({ error: 'Address required' }), { status: 400 });
        }
        if (!StrKey.isValidEd25519PublicKey(address)) {
            return new Response(JSON.stringify({ error: 'Invalid Stellar address' }), { status: 400 });
        }

        const env = (locals as any).runtime?.env;
        const serverSecret = env?.CHAT_SERVER_SECRET || process.env.CHAT_SERVER_SECRET;
        if (!serverSecret) {
            return new Response(JSON.stringify({ error: 'Missing CHAT_SERVER_SECRET' }), { status: 500 });
        }

        const networkPassphrase =
            env?.PUBLIC_NETWORK_PASSPHRASE ||
            process.env.PUBLIC_NETWORK_PASSPHRASE ||
            'Public Global Stellar Network ; September 2015';

        const challengeTx = buildChallenge(serverSecret, address, networkPassphrase);

        return new Response(JSON.stringify({
            xdr: challengeTx
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });

    } catch (e: any) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
};
