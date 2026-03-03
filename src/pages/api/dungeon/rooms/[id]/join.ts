import type { APIRoute } from "astro";
import {
  createRateLimitResponse,
  enforceRateLimit,
  parseTextBodyWithLimit,
} from "../../../../../lib/guardrails";

export const POST: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = params.id || "";

  if (!roomId) return new Response("Room id required", { status: 400 });

  const rate = await enforceRateLimit(request, {
    bucket: "api-dungeon-room-join",
    limit: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  try {
    const parsedBody = await parseTextBodyWithLimit(request, 24_000);
    if (!parsedBody.ok) return parsedBody.response;
    const textBody = parsedBody.text;

    // Server-to-Server fetch bypasses browser CORS.
    // Proxy the request directly to the centralized kalefarm.xyz relay.
    const proxyRes = await fetch(
      `https://kalefarm.xyz/api/dungeon/rooms/${encodeURIComponent(roomId)}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: textBody,
      }
    );

    const data = await proxyRes.text();

    return new Response(data, {
      status: proxyRes.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy Join failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
