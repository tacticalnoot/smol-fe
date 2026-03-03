type RateRecord = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

const RL_MEMORY_KEY = "__smolRateLimitMemory";
const RL_CACHE_PREFIX = "smol-rl-v1";
const RL_CACHE_BASE_URL = "https://guardrails.smol.local";
const RL_MAX_RECORDS = 20_000;

function getMemoryStore(): Map<string, RateRecord> {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[RL_MEMORY_KEY] as Map<string, RateRecord> | undefined;
  if (existing) return existing;
  const created = new Map<string, RateRecord>();
  g[RL_MEMORY_KEY] = created;
  return created;
}

function pruneMemoryStore(store: Map<string, RateRecord>, now: number): void {
  if (store.size <= RL_MAX_RECORDS) return;

  for (const [key, record] of store.entries()) {
    if (record.resetAt <= now) {
      store.delete(key);
    }
  }

  if (store.size <= RL_MAX_RECORDS) return;

  const targetSize = Math.floor(RL_MAX_RECORDS * 0.9);
  for (const key of store.keys()) {
    if (store.size <= targetSize) break;
    store.delete(key);
  }
}

function getCache(): Cache | null {
  const maybeCaches = (globalThis as any)?.caches;
  const cache = maybeCaches?.default;
  return cache || null;
}

function cacheRequest(key: string): Request {
  return new Request(`${RL_CACHE_BASE_URL}/${encodeURIComponent(key)}`);
}

function cacheKey(bucket: string, clientKey: string): string {
  return `${RL_CACHE_PREFIX}:${bucket}:${clientKey}`;
}

function normalizeClientKey(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const forwarded = request.headers.get("x-forwarded-for")?.trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const ua = request.headers.get("user-agent") || "unknown-ua";
  const lang = request.headers.get("accept-language") || "unknown-lang";
  return `${ua.slice(0, 80)}|${lang.slice(0, 40)}`;
}

async function readCachedRecord(key: string): Promise<RateRecord | null> {
  const cache = getCache();
  if (!cache) return null;

  const res = await cache.match(cacheRequest(key));
  if (!res) return null;

  try {
    const data = (await res.json()) as Partial<RateRecord>;
    if (
      typeof data.count === "number" &&
      Number.isFinite(data.count) &&
      typeof data.resetAt === "number" &&
      Number.isFinite(data.resetAt)
    ) {
      return { count: data.count, resetAt: data.resetAt };
    }
  } catch {
    // Ignore cache parse failures and fall back to memory state.
  }
  return null;
}

async function writeCachedRecord(key: string, record: RateRecord): Promise<void> {
  const cache = getCache();
  if (!cache) return;

  const ttlSec = Math.max(1, Math.ceil((record.resetAt - Date.now()) / 1000));
  await cache.put(
    cacheRequest(key),
    new Response(JSON.stringify(record), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${ttlSec}`,
      },
    })
  );
}

function noStoreJsonHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(extra || {}),
  };
}

export function createJsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: noStoreJsonHeaders(extraHeaders),
  });
}

export function createErrorResponse(
  message: string,
  status = 400,
  extraHeaders?: Record<string, string>
): Response {
  return createJsonResponse({ error: message }, status, extraHeaders);
}

export async function enforceRateLimit(
  request: Request,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  if (import.meta.env.DEV) {
    return { allowed: true, remaining: options.limit, retryAfterSec: 0 };
  }

  const clientKey = normalizeClientKey(request);
  const key = cacheKey(options.bucket, clientKey);
  const now = Date.now();

  const memory = getMemoryStore();
  pruneMemoryStore(memory, now);
  const memoryRecord = memory.get(key);
  const cachedRecord = await readCachedRecord(key);
  const current = cachedRecord || memoryRecord;

  const base: RateRecord =
    current && now < current.resetAt
      ? { count: current.count, resetAt: current.resetAt }
      : { count: 0, resetAt: now + options.windowMs };

  base.count += 1;
  memory.set(key, base);
  await writeCachedRecord(key, base);

  const remaining = Math.max(0, options.limit - base.count);
  const retryAfterSec = Math.max(1, Math.ceil((base.resetAt - now) / 1000));

  return {
    allowed: base.count <= options.limit,
    remaining,
    retryAfterSec,
  };
}

export function createRateLimitResponse(retryAfterSec: number): Response {
  return createErrorResponse(
    "Too many requests. Please slow down and try again shortly.",
    429,
    { "Retry-After": String(Math.max(1, retryAfterSec)) }
  );
}

export async function parseJsonBodyWithLimit<T>(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: createErrorResponse("Content-Type must be application/json", 415) };
  }

  const text = await request.text();
  if (!text.trim()) {
    return { ok: false, response: createErrorResponse("Request body is required", 400) };
  }
  if (text.length > maxBytes) {
    return { ok: false, response: createErrorResponse("Request body too large", 413) };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: createErrorResponse("Invalid JSON body", 400) };
  }
}

export async function parseTextBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: false, response: createErrorResponse("Request body is required", 400) };
  }
  if (text.length > maxBytes) {
    return { ok: false, response: createErrorResponse("Request body too large", 413) };
  }
  return { ok: true, text };
}

export function trimString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}
