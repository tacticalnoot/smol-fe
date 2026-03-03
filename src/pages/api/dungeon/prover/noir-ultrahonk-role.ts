export const prerender = false;

import type { APIContext } from "astro";
import { getProverEnv, proverFetch } from "../../../../lib/dungeon/prover/proxy";
import {
  createRateLimitResponse,
  enforceRateLimit,
  enforceSameOrigin,
  parseJsonBodyWithLimit,
} from "../../../../lib/guardrails";

export async function POST({ request, locals }: APIContext) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rate = await enforceRateLimit(request, {
    bucket: "api-dungeon-prover-noir",
    limit: 12,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return createRateLimitResponse(rate.retryAfterSec);
  }

  const env = getProverEnv(locals);

  const parsed = await parseJsonBodyWithLimit<unknown>(request, 128_000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const resp = await proverFetch(env, "/noir-ultrahonk-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

