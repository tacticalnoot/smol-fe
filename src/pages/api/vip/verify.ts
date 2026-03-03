import { StrKey } from "@stellar/stellar-sdk";
import type { APIRoute } from "astro";
import { findRoom } from "../../../lib/vip/rooms";
import { verifyVipChallengeTx, verifyVipSmolTokenAuth } from "../../../lib/vip/server/auth";
import { checkVipEligibility } from "../../../lib/vip/server/eligibility";
import { createVipSession } from "../../../lib/vip/server/state";
import {
  createRateLimitResponse,
  enforceRateLimit,
  enforceSameOrigin,
  parseJsonBodyWithLimit,
} from "../../../lib/guardrails";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (Labs-only)

export const POST: APIRoute = async ({ request }) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rate = await enforceRateLimit(request, {
    bucket: "api-vip-verify",
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  try {
    const parsed = await parseJsonBodyWithLimit<{
      roomId?: string;
      address?: string;
      xdr?: string;
    }>(request, 8192);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;

    const roomId = body?.roomId?.trim() || "";
    const address = body?.address?.trim() || "";
    const xdr = body?.xdr?.trim() || "";

    if (!roomId || !address) {
      return new Response(
        JSON.stringify({ token: "", roomStatus: "rejected", reason: "Missing roomId/address" }),
        { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    const room = findRoom(roomId);
    if (!room) {
      return new Response(
        JSON.stringify({ token: "", roomStatus: "rejected", reason: "Unknown VIP room" }),
        { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    const isClassic = StrKey.isValidEd25519PublicKey(address);
    const isContract = StrKey.isValidContract(address);

    if (!isClassic && !isContract) {
      return new Response(
        JSON.stringify({ token: "", roomStatus: "rejected", reason: "Valid Stellar address required" }),
        { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    if (isClassic) {
      if (!xdr) {
        return new Response(
          JSON.stringify({ token: "", roomStatus: "rejected", reason: "Missing challenge signature" }),
          { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }

      const auth = verifyVipChallengeTx({
        request,
        challengeXdr: xdr,
        clientAddress: address,
      });
      if (!auth.ok) {
        return new Response(
          JSON.stringify({ token: "", roomStatus: "rejected", reason: auth.error }),
          { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }
    } else {
      const auth = await verifyVipSmolTokenAuth({
        request,
        contractAddress: address,
      });
      if (!auth.ok) {
        return new Response(
          JSON.stringify({ token: "", roomStatus: "rejected", reason: auth.error }),
          { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }
    }

    const eligible = await checkVipEligibility({ roomId, address });
    if (!eligible.ok) {
      return new Response(
        JSON.stringify({ token: "", roomStatus: "rejected", reason: eligible.reason }),
        { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    const session = await createVipSession({
      roomId,
      account: address,
      ttlMs: SESSION_TTL_MS,
    });

    return new Response(JSON.stringify({ token: session.token, roomStatus: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VIP verification failed";
    return new Response(JSON.stringify({ token: "", roomStatus: "rejected", reason: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
};

