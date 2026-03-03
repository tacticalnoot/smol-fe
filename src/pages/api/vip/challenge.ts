import type { APIRoute } from "astro";
import { StrKey } from "@stellar/stellar-sdk";
import {
  buildVipChallengeTxXdr,
  verifyVipSmolTokenAuth,
} from "../../../lib/vip/server/auth";
import { findRoom } from "../../../lib/vip/rooms";
import {
  createRateLimitResponse,
  enforceRateLimit,
  enforceSameOrigin,
  parseJsonBodyWithLimit,
} from "../../../lib/guardrails";

export const POST: APIRoute = async ({ request }) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rate = await enforceRateLimit(request, {
    bucket: "api-vip-challenge",
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  try {
    const parsed = await parseJsonBodyWithLimit<{ roomId?: string; address?: string }>(
      request,
      4096
    );
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    const roomId = body?.roomId?.trim() || "";
    const address = body?.address?.trim() || "";

    if (!roomId) {
      return new Response(JSON.stringify({ error: "roomId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const room = findRoom(roomId);
    if (!room) {
      return new Response(JSON.stringify({ error: "Unknown VIP room" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (room.status !== "enabled") {
      return new Response(JSON.stringify({ error: "Room not enabled" }), {
        status: 409,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const isClassic = StrKey.isValidEd25519PublicKey(address);
    const isContract = StrKey.isValidContract(address);
    if (!address || (!isClassic && !isContract)) {
      return new Response(JSON.stringify({ error: "Valid Stellar address required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (isContract) {
      const auth = await verifyVipSmolTokenAuth({
        request,
        contractAddress: address,
      });
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }

      return new Response(JSON.stringify({ authMode: "smol-token", xdr: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const xdr = buildVipChallengeTxXdr({ request, clientAddress: address });
    return new Response(JSON.stringify({ authMode: "sep10", xdr }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VIP challenge failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
};

