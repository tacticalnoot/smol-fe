import type { APIRoute } from "astro";
import { GoogleGenAI } from "@google/genai";
import { buildSmolPersonaPrompt } from "../../lib/smolPersona/buildSmolPersonaPrompt";
import type { SmolPersonaChatMessage, SmolPersonaContext } from "../../lib/smolPersona/types";
import {
  createErrorResponse,
  createJsonResponse,
  createRateLimitResponse,
  enforceRateLimit,
  enforceSameOrigin,
  parseJsonBodyWithLimit,
  trimString,
} from "../../lib/guardrails";

const apiKey = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

type AskTheSmolBody = {
  smolPersonaContext?: SmolPersonaContext;
  message?: unknown;
  chatHistory?: SmolPersonaChatMessage[];
};

function isContext(value: unknown): value is SmolPersonaContext {
  return Boolean(value && typeof value === "object" && typeof (value as SmolPersonaContext).title === "string");
}

export const POST: APIRoute = async ({ request }) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rate = await enforceRateLimit(request, {
    bucket: "api-ask-the-smol",
    limit: 25,
    windowMs: 60_000,
  });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSec);

  const parsed = await parseJsonBodyWithLimit<AskTheSmolBody>(request, 32_000);
  if (!parsed.ok) return parsed.response;

  const message = trimString(parsed.data.message, 1200);
  if (!message) return createErrorResponse("message is required", 400);
  if (!isContext(parsed.data.smolPersonaContext)) {
    return createErrorResponse("smolPersonaContext is required", 400);
  }

  const chatHistory = Array.isArray(parsed.data.chatHistory) ? parsed.data.chatHistory : [];
  const promptPackage = buildSmolPersonaPrompt(parsed.data.smolPersonaContext, message, chatHistory);

  if (!apiKey) {
    return createJsonResponse({
      ok: false,
      mode: "error",
      reply: "",
      error: "Gemini key not configured or needs update. Check GEMINI_API_KEY in the server/Cloudflare Pages environment.",
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: promptPackage.finalPrompt,
      config: {
        temperature: 0.9,
        maxOutputTokens: 700,
      },
    });

    let text = response.text || "";
    if (!text && typeof (response as any).text === "function") {
      text = (response as any).text();
    }

    const reply = text.trim();
    if (!reply) {
      return createJsonResponse({
        ok: false,
        mode: "error",
        reply: "",
        error: "Gemini returned an empty response. The key may need checking or the provider may be unavailable.",
      });
    }

    return createJsonResponse({ ok: true, mode: "llm", reply });
  } catch (error: any) {
    console.error("Ask the Smol Gemini error:", error?.message || error);
    return createJsonResponse({
      ok: false,
      mode: "error",
      reply: "",
      error: "Gemini key not configured or needs update, or the provider call failed. Check GEMINI_API_KEY in the server environment.",
    });
  }
};
