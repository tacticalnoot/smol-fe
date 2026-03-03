
import type { APIRoute } from 'astro';
import {
    createErrorResponse,
    createRateLimitResponse,
    enforceRateLimit,
} from "../../../lib/guardrails";

const ALLOWED_PARAMS = new Set([
    "from",
    "to",
    "amount",
    "slippage",
    "network",
    "exact",
]);

export const GET: APIRoute = async ({ request }) => {
    const rate = await enforceRateLimit(request, {
        bucket: "api-xbull-quote",
        limit: 120,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    const url = new URL(request.url);
    const filtered = new URLSearchParams();

    for (const [key, value] of url.searchParams.entries()) {
        if (!ALLOWED_PARAMS.has(key)) continue;
        if (value.length > 128) {
            return createErrorResponse(`Query parameter too long: ${key}`, 400);
        }
        filtered.set(key, value);
    }

    if (![...filtered.keys()].length) {
        return createErrorResponse("No valid quote parameters provided", 400);
    }

    const query = filtered.toString();
    const targetUrl = `https://swap.apis.xbull.app/swaps/quote?${query}`;

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return new Response(JSON.stringify({ message: 'Failed to fetch quote from xBull' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};
