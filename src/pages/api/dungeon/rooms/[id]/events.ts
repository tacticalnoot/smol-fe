import type { APIRoute } from "astro";
import {
  addDungeonEvent,
  getBearerToken,
  getDungeonRoom,
  getDungeonSession,
  type DungeonEvent,
} from "../../../../../lib/dungeon/server/state";

const MAX_EVENTS = 200;

function normalizeRoomId(value: string): string | null {
  const roomId = (value || "").trim().toUpperCase();
  if (roomId.length < 4 || roomId.length > 12) return null;
  if (!/^[A-Z0-9]+$/.test(roomId)) return null;
  return roomId;
}

function parseCursor(value: string | null): number {
  if (!value) return 0;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export const GET: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = normalizeRoomId(params.id || "");
  if (!roomId) return new Response("Room id required", { status: 400 });

  const token = getBearerToken(request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const session = getDungeonSession(token);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.roomId !== roomId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("cursor"));

  const state = getDungeonRoom(roomId);
  const events = state.events.filter((evt) => evt.seq > cursor);

  const me = state.rosterByAccount[session.account];
  if (me) {
    me.lastSeenAt = Date.now();
    state.rosterByAccount[session.account] = me;
  }

  return new Response(
    JSON.stringify({
      roster: Object.values(state.rosterByAccount),
      events,
      cursor: state.nextSeq - 1,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const POST: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = normalizeRoomId(params.id || "");
  if (!roomId) return new Response("Room id required", { status: 400 });

  const token = getBearerToken(request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const session = getDungeonSession(token);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.roomId !== roomId) return new Response("Unauthorized", { status: 401 });

  const now = Date.now();
  const state = getDungeonRoom(roomId);

  try {
    const body = (await request.json()) as Partial<DungeonEvent>;
    if (!body?.kind) return new Response("Missing kind", { status: 400 });

    if (body.kind === "system") {
      // System messages are server-authored only.
      return new Response("Forbidden", { status: 403 });
    }

    if (body.kind === "ready") {
      const account = (body as any).account as string | undefined;
      const ready = (body as any).ready as boolean | undefined;
      if (!account || account !== session.account) return new Response("Invalid account", { status: 400 });
      if (typeof ready !== "boolean") return new Response("Malformed ready", { status: 400 });

      const entry = state.rosterByAccount[account];
      if (!entry) return new Response("Not in roster", { status: 409 });
      state.rosterByAccount[account] = { ...entry, ready, lastSeenAt: now };

      addDungeonEvent(roomId, { kind: "ready", account, ready, ts: now }, { maxEvents: MAX_EVENTS });
      return new Response(JSON.stringify({ ok: true, cursor: state.nextSeq - 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.kind === "start") {
      const roster = Object.values(state.rosterByAccount);
      const readyOk = roster.length < 2 || roster.every((r) => r.ready);
      if (!readyOk) return new Response("Both players must be ready", { status: 409 });

      addDungeonEvent(roomId, { kind: "start", ts: now }, { maxEvents: MAX_EVENTS });
      return new Response(JSON.stringify({ ok: true, cursor: state.nextSeq - 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.kind === "progress") {
      const account = (body as any).account as string | undefined;
      const floor = (body as any).floor as number | undefined;
      const attempts = (body as any).attempts as number | undefined;

      if (!account || account !== session.account) return new Response("Invalid account", { status: 400 });
      if (typeof floor !== "number" || !Number.isFinite(floor) || floor < 1 || floor > 10) {
        return new Response("Malformed floor", { status: 400 });
      }
      if (typeof attempts !== "number" || !Number.isFinite(attempts) || attempts < 0 || attempts > 9999) {
        return new Response("Malformed attempts", { status: 400 });
      }

      const entry = state.rosterByAccount[account];
      if (!entry) return new Response("Not in roster", { status: 409 });

      state.rosterByAccount[account] = { ...entry, floor, attempts, lastSeenAt: now };

      addDungeonEvent(roomId, { kind: "progress", account, floor, attempts, ts: now }, { maxEvents: MAX_EVENTS });
      return new Response(JSON.stringify({ ok: true, cursor: state.nextSeq - 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Unsupported event kind", { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event write failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
