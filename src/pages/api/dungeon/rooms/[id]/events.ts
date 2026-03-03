import type { APIRoute } from "astro";
import {
  createErrorResponse,
  createRateLimitResponse,
  enforceRateLimit,
  parseTextBodyWithLimit,
} from "../../../../../lib/guardrails";

export const GET: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = params.id || "";

  if (!roomId) return new Response("Room id required", { status: 400 });

  const rate = await enforceRateLimit(request, {
    bucket: "api-dungeon-room-events-get",
    limit: 120,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || "0";
  const token = request.headers.get("Authorization") || "";
  if (token && !token.toLowerCase().startsWith("bearer ")) {
    return createErrorResponse("Invalid Authorization header", 400);
  }

  try {
    const proxyRes = await fetch(
      `https://kalefarm.xyz/api/dungeon/rooms/${encodeURIComponent(roomId)}/events?cursor=${encodeURIComponent(cursor)}`,
      {
        method: "GET",
        headers: { "Authorization": token },
      }
    );

    const data = await proxyRes.text();

    return new Response(data, {
      status: proxyRes.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy GET events failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = params.id || "";

  if (!roomId) return new Response("Room id required", { status: 400 });

  const rate = await enforceRateLimit(request, {
    bucket: "api-dungeon-room-events-post",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  const token = request.headers.get("Authorization") || "";
  if (token && !token.toLowerCase().startsWith("bearer ")) {
    return createErrorResponse("Invalid Authorization header", 400);
  }

  try {
    const parsedBody = await parseTextBodyWithLimit(request, 24_000);
    if (!parsedBody.ok) return parsedBody.response;
    const textBody = parsedBody.text;

    const proxyRes = await fetch(
      `https://kalefarm.xyz/api/dungeon/rooms/${encodeURIComponent(roomId)}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token
        },
        body: textBody,
      }
    );

    const data = await proxyRes.text();

    return new Response(data, {
      status: proxyRes.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy POST events failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
