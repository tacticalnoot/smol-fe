/**
 * VIP state store with Cloudflare-compatible shared persistence.
 *
 * Priority order:
 * 1) Cloudflare Cache API (`caches.default`) for cross-isolate sharing.
 * 2) In-memory Maps as fallback for local dev/non-Worker runtimes.
 *
 * Notes:
 * - Cache API is shared across isolates, eliminating isolate-local session drops.
 * - Cache writes are eventually consistent and not transactional.
 * - For strict guarantees, migrate this module to Durable Objects.
 */
export type VipSession = {
  token: string;
  roomId: string;
  account: string;
  createdAt: number;
  expiresAt: number;
};

export type VipRosterEntry = {
  id: string;
  account: string;
  e2ee: { identity: string; dh: string };
  joinedAt: number;
  lastSeenAt: number;
};

export type VipEvent =
  | {
      seq: number;
      kind: "sender-key-share";
      from: string;
      to: string;
      wrappedKey: string;
      nonce: string;
      keyVersion: number;
      ts: number;
    }
  | {
      seq: number;
      kind: "chat";
      sender: string;
      ciphertext: string;
      nonce: string;
      keyVersion: number;
      signature: string;
      ts: number;
    }
  | { seq: number; kind: "system"; message: string; ts: number };

export type VipEventInput =
  | Omit<Extract<VipEvent, { kind: "sender-key-share" }>, "seq">
  | Omit<Extract<VipEvent, { kind: "chat" }>, "seq">
  | Omit<Extract<VipEvent, { kind: "system" }>, "seq">;

export type VipRoomState = {
  roomId: string;
  roster: VipRosterEntry[];
  events: VipEvent[];
  nextSeq: number;
};

type VipMemoryStore = {
  sessionsByToken: Map<string, VipSession>;
  roomsById: Map<string, VipRoomState>;
};

const STORE_KEY = "__smolVipStore";
const CACHE_KEY_PREFIX = "smol-vip-v1";
const CACHE_BASE_URL = "https://vip-state.smol.local";
const ROOM_TTL_SECONDS = 12 * 60 * 60; // 12h rolling room state retention

function cloneRoomState(room: VipRoomState): VipRoomState {
  return {
    roomId: room.roomId,
    roster: room.roster.map((entry) => ({
      ...entry,
      e2ee: { ...entry.e2ee },
    })),
    events: room.events.map((evt) => ({ ...evt })),
    nextSeq: room.nextSeq,
  };
}

function createEmptyRoom(roomId: string): VipRoomState {
  return {
    roomId,
    roster: [],
    events: [],
    nextSeq: 1,
  };
}

function getMemoryStore(): VipMemoryStore {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[STORE_KEY] as VipMemoryStore | undefined;
  if (existing) return existing;

  const created: VipMemoryStore = {
    sessionsByToken: new Map(),
    roomsById: new Map(),
  };
  g[STORE_KEY] = created;
  return created;
}

function getCache(): Cache | null {
  const maybeCaches = (globalThis as any)?.caches;
  const cache = maybeCaches?.default;
  return cache || null;
}

function cacheRequest(key: string): Request {
  return new Request(`${CACHE_BASE_URL}/${encodeURIComponent(key)}`);
}

async function cacheGetJson<T>(key: string): Promise<T | null> {
  const cache = getCache();
  if (!cache) return null;

  const res = await cache.match(cacheRequest(key));
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function cachePutJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const cache = getCache();
  if (!cache) return;

  await cache.put(
    cacheRequest(key),
    new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
      },
    })
  );
}

async function cacheDelete(key: string): Promise<void> {
  const cache = getCache();
  if (!cache) return;
  await cache.delete(cacheRequest(key));
}

function sessionKey(token: string): string {
  return `${CACHE_KEY_PREFIX}:session:${token}`;
}

function roomKey(roomId: string): string {
  return `${CACHE_KEY_PREFIX}:room:${roomId}`;
}

export async function getVipRoom(roomId: string): Promise<VipRoomState> {
  const key = roomKey(roomId);
  const cached = await cacheGetJson<VipRoomState>(key);
  if (cached?.roomId === roomId && Array.isArray(cached.roster) && Array.isArray(cached.events)) {
    return {
      roomId,
      roster: cached.roster,
      events: cached.events,
      nextSeq: Number.isFinite(cached.nextSeq) && cached.nextSeq > 0 ? cached.nextSeq : 1,
    };
  }

  const memory = getMemoryStore();
  const existing = memory.roomsById.get(roomId);
  if (existing) return cloneRoomState(existing);

  return createEmptyRoom(roomId);
}

export async function saveVipRoom(room: VipRoomState): Promise<void> {
  const normalized: VipRoomState = {
    roomId: room.roomId,
    roster: Array.isArray(room.roster) ? room.roster : [],
    events: Array.isArray(room.events) ? room.events : [],
    nextSeq: Number.isFinite(room.nextSeq) && room.nextSeq > 0 ? room.nextSeq : 1,
  };

  const memory = getMemoryStore();
  memory.roomsById.set(normalized.roomId, cloneRoomState(normalized));
  await cachePutJson(roomKey(normalized.roomId), normalized, ROOM_TTL_SECONDS);
}

export async function addVipEvent(
  roomId: string,
  event: VipEventInput,
  opts: { maxEvents: number }
): Promise<VipEvent> {
  const room = await getVipRoom(roomId);
  const seq = room.nextSeq > 0 ? room.nextSeq : 1;
  const next = { ...event, seq } as VipEvent;

  room.events.push(next);
  room.nextSeq = seq + 1;

  const maxEvents = Math.max(1, opts.maxEvents);
  if (room.events.length > maxEvents) {
    room.events = room.events.slice(-maxEvents);
  }

  await saveVipRoom(room);
  return next;
}

export async function createVipSession(params: {
  roomId: string;
  account: string;
  ttlMs: number;
}): Promise<VipSession> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const ttlMs = Math.max(1_000, params.ttlMs);
  const session: VipSession = {
    token,
    roomId: params.roomId,
    account: params.account,
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  const memory = getMemoryStore();
  memory.sessionsByToken.set(token, session);

  await cachePutJson(sessionKey(token), session, Math.ceil(ttlMs / 1000));
  return session;
}

export async function getVipSession(token: string): Promise<VipSession | null> {
  const key = sessionKey(token);
  const cached = await cacheGetJson<VipSession>(key);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      await cacheDelete(key);
      getMemoryStore().sessionsByToken.delete(token);
      return null;
    }
    getMemoryStore().sessionsByToken.set(token, cached);
    return cached;
  }

  const memory = getMemoryStore();
  const existing = memory.sessionsByToken.get(token);
  if (!existing) return null;
  if (Date.now() > existing.expiresAt) {
    memory.sessionsByToken.delete(token);
    return null;
  }
  return existing;
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
