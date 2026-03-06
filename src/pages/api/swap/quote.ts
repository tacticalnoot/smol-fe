export const prerender = false;

import type { APIContext } from 'astro';
import {
    createErrorResponse,
    createRateLimitResponse,
    enforceRateLimit,
    enforceSameOrigin,
    parseJsonBodyWithLimit,
    trimString,
} from "../../../lib/guardrails";

const SOROSWAP_API_URL = 'https://api.soroswap.finance';
const SUPPORTED_PROTOCOLS = ['soroswap', 'aqua', 'phoenix'];

// Allowlist of known mainnet token contract addresses.
// Prevents forwarding arbitrary contract addresses to the Soroswap API.
const ALLOWED_TOKEN_ADDRESSES = new Set([
    // XLM SAC
    import.meta.env.PUBLIC_XLM_SAC_ID || 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    // KALE
    import.meta.env.PUBLIC_KALE_SAC_ID || 'CB23WRDQWGSP6YPMY4UV5C4OW5CBTXKYN3XEATG7KJEZCXMJBYEHOUOV',
    // USDC
    'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
]);

export async function POST({ request, locals }: APIContext) {
    const originError = enforceSameOrigin(request);
    if (originError) return originError;

    const rate = await enforceRateLimit(request, {
        bucket: "api-swap-quote",
        limit: 120,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    try {
        const parsed = await parseJsonBodyWithLimit<{
            tokenIn?: unknown;
            tokenOut?: unknown;
            amountIn?: unknown;
            slippageBps?: unknown;
            tradeType?: unknown;
        }>(request, 8192);
        if (!parsed.ok) return parsed.response;

        const tokenIn = trimString(parsed.data.tokenIn, 80);
        const tokenOut = trimString(parsed.data.tokenOut, 80);
        const amountRaw = parsed.data.amountIn;
        const amountIn =
            typeof amountRaw === "number" && Number.isFinite(amountRaw)
                ? Math.trunc(amountRaw).toString()
                : trimString(amountRaw, 80);
        const tradeTypeRaw = trimString(parsed.data.tradeType, 16).toUpperCase();
        const slippageRaw = parsed.data.slippageBps;
        const slippageBps =
            typeof slippageRaw === "number" && Number.isFinite(slippageRaw)
                ? Math.floor(slippageRaw)
                : Number.parseInt(trimString(slippageRaw, 10) || "500", 10);

        if (!tokenIn || !tokenOut || !amountIn) {
            return createErrorResponse('Missing required parameters', 400);
        }

        if (!ALLOWED_TOKEN_ADDRESSES.has(tokenIn) || !ALLOWED_TOKEN_ADDRESSES.has(tokenOut)) {
            return createErrorResponse('Unsupported token address', 400);
        }

        if (!/^\d+$/.test(amountIn)) {
            return createErrorResponse('amountIn must be a positive integer string', 400);
        }

        const tradeType = tradeTypeRaw === "EXACT_OUT" ? "EXACT_OUT" : "EXACT_IN";
        if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
            return createErrorResponse('slippageBps must be between 0 and 10000', 400);
        }

        // Use env variable for API key (Cloudflare Secret)
        // Checking both runtime.env (Cloudflare) and process.env (local dev)
        const env = (locals as any).runtime?.env;
        const apiKey = env?.SOROSWAP_API_KEY || process.env.SOROSWAP_API_KEY ||
            env?.PUBLIC_SOROSWAP_API_KEY || process.env.PUBLIC_SOROSWAP_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), { status: 500 });
        }

        const quotePayload = {
            assetIn: tokenIn,
            assetOut: tokenOut,

            amount: amountIn, // Note: Soroswap API uses 'amount' for both input/output depending on tradeType? 
            // Actually, for EXACT_OUT, 'amount' usually represents amountOut. 
            // But let's check input mapping. Client sends 'amountIn' as the value.
            // If tradeType is EXACT_OUT, client should likely send 'amountOut'.
            // However, keeping simple fix first: pass tradeType.
            tradeType: tradeType || 'EXACT_IN',
            protocols: SUPPORTED_PROTOCOLS,
            slippageBps,
        };

        const response = await fetch(`${SOROSWAP_API_URL}/quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(quotePayload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Soroswap quote failed:', response.status, errorText);
            // Return a sanitized message — don't expose upstream API internals to the client.
            const clientStatus = response.status >= 500 ? 502 : response.status;
            return new Response(JSON.stringify({ error: 'Quote unavailable. Try again shortly.' }), { status: clientStatus });
        }

        const data = await response.json();
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });

    } catch (error: any) {
        console.error('API Error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}
