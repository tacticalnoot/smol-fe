
import type { APIRoute } from 'astro';
import {
    createErrorResponse,
    createRateLimitResponse,
    enforceRateLimit,
    enforceSameOrigin,
    parseJsonBodyWithLimit,
} from "../../../lib/guardrails";

export const POST: APIRoute = async ({ request }) => {
    const originError = enforceSameOrigin(request);
    if (originError) return originError;

    const rate = await enforceRateLimit(request, {
        bucket: "api-xbull-accept-quote",
        limit: 60,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    try {
        const parsed = await parseJsonBodyWithLimit<Record<string, unknown>>(request, 32_000);
        if (!parsed.ok) return parsed.response;
        const body = parsed.data;

        if (typeof body !== "object" || body === null) {
            return createErrorResponse("Invalid quote payload", 400);
        }

        const targetUrl = `https://swap.apis.xbull.app/swaps/accept-quote`;

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
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
        return new Response(JSON.stringify({ message: 'Failed to accept quote from xBull' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};
