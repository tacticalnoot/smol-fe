
import type { APIRoute } from 'astro';
import { GoogleGenAI } from '@google/genai';
import {
    createErrorResponse,
    createJsonResponse,
    createRateLimitResponse,
    enforceRateLimit,
    parseJsonBodyWithLimit,
    trimString,
} from "../../../lib/guardrails";

// Initialize Gemini
// We use the same key variable name as radio/ai.ts for consistency
const apiKey = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

export const POST: APIRoute = async ({ request }) => {
    const rate = await enforceRateLimit(request, {
        bucket: "api-ai-commentary",
        limit: 30,
        windowMs: 60_000,
    });
    if (!rate.allowed) {
        return createRateLimitResponse(rate.retryAfterSec);
    }

    if (!apiKey) {
        console.warn("No GEMINI_API_KEY found. Returning fallback commentary.");
        return createJsonResponse({
            comment: "This setup looks solid. Waiting for the mix to drop.",
            mood: "waiting"
        });
    }

    const requestId = crypto.randomUUID().split('-')[0];

    // Global In-Memory Cache to prevent spamming generic prompts
    const CACHE_TTL_MS = 1000 * 60 * 30; // 30 mins
    const CACHE_MAX_ENTRIES = 500;
    const globalCache = (globalThis as any).__AI_DIRECTOR_CACHE__ || new Map();
    (globalThis as any).__AI_DIRECTOR_CACHE__ = globalCache;

    try {
        const parsed = await parseJsonBodyWithLimit<{ context?: unknown; type?: unknown }>(request, 4096);
        if (!parsed.ok) return parsed.response;

        const context = trimString(parsed.data?.context, 300);
        const type = trimString(parsed.data?.type, 24).toLowerCase();
        // context: string (lyrics or prompt)
        // type: 'lyrics' | 'prompt' | 'status'

        if (!context) {
            return createErrorResponse("context is required", 400);
        }
        if (!["lyrics", "prompt", "status"].includes(type)) {
            return createErrorResponse("type must be one of: lyrics, prompt, status", 400);
        }

        const cacheKey = `dir_${type}_${context.slice(0, 50).toLowerCase().trim()}`;
        const cached = globalCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            return new Response(cached.data, {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
            });
        }

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = `
      You are the "AI Director" of a futuristic music generation studio.
      Your persona is: Chill, observant, slightly nerdy, deeply appreciative of creativity, and supportive.
      You are in "Deep Thinking Mode" analyzing the user's creation as it generates.
      
      Task: Read the input and provide a SINGLE, short, flavorful sentence of commentary (max 15 words).
      
      Examples:
      - "Yo, that bassline description is heavy. Good choice."
      - "Reading these lyrics... getting serious synthwave vibes."
      - "Almost done cooking the beat. Hang tight."
      - "I like where you're going with this melody."
      
      INPUT CONTEXT: "${context}"
      INPUT TYPE: ${type}
      
      Output strictly valid JSON:
      {
        "comment": "string", 
        "mood": "string" // e.g., "vibing", "analyzing", "hyped"
      }
    `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: systemPrompt,
            config: {
                temperature: 0.8,
                maxOutputTokens: 100,
            }
        });

        let text = response.text || "";
        if (!text && typeof (response as any).text === 'function') {
            text = (response as any).text();
        }

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

        // simple validation
        try {
            JSON.parse(jsonStr);
        } catch (e) {
            // fallback if JSON broken
            return createJsonResponse({
                comment: "Processing this masterpiece... sounds promising.",
                mood: "analyzing"
            });
        }

        globalCache.set(cacheKey, {
            timestamp: Date.now(),
            data: jsonStr
        });
        if (globalCache.size > CACHE_MAX_ENTRIES) {
            const overflow = globalCache.size - CACHE_MAX_ENTRIES;
            let removed = 0;
            for (const key of globalCache.keys()) {
                globalCache.delete(key);
                removed += 1;
                if (removed >= overflow) break;
            }
        }

        return new Response(jsonStr, {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });

    } catch (error: any) {
        console.error('Gemini Director Error:', error);
        return createJsonResponse({
            comment: "System crunching... stand by.",
            mood: "error"
        });
    }
}
