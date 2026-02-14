import type { APIRoute } from "astro";
import {
  addDungeonEvent,
  createDungeonSession,
  getDungeonRoom,
  type DungeonRosterEntry,
} from "../../../../../lib/dungeon/server/state";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (Labs-only)
const MAX_EVENTS = 200;
const MAX_ROSTER = 2;

function normalizeRoomId(value: string): string | null {
  const roomId = (value || "").trim().toUpperCase();
  if (roomId.length < 4 || roomId.length > 12) return null;
  if (!/^[A-Z0-9]+$/.test(roomId)) return null;
  return roomId;
}

function sanitizeName(value: string): string {
  const name = (value || "").trim().replace(/\s+/g, " ");
  if (!name) return "Seeker";
  return name.slice(0, 32);
}

export const POST: APIRoute = async (ctx) => {
  const { request, params } = ctx;
  const roomId = normalizeRoomId(params.id || "");
  if (!roomId) return new Response("Room id required", { status: 400 });

  try {
    const body = (await request.json()) as { account?: string; name?: string };
    const account = body?.account?.trim() || "";
    const name = sanitizeName(body?.name || "");
    if (!account) return new Response("Missing account", { status: 400 });

    const state = getDungeonRoom(roomId);
    const now = Date.now();

    const existing = state.rosterByAccount[account];
    const rosterCount = Object.keys(state.rosterByAccount).length;
    if (!existing && rosterCount >= MAX_ROSTER) {
      return new Response("Room full", { status: 409 });
    }

    const entry: DungeonRosterEntry = existing
      ? {
          ...existing,
          name,
          lastSeenAt: now,
        }
      : {
          id: crypto.randomUUID(),
          account,
          name,
          joinedAt: now,
          lastSeenAt: now,
          ready: false,
          floor: 1,
          attempts: 0,
        };

    state.rosterByAccount[account] = entry;

    addDungeonEvent(
      roomId,
      {
        kind: "system",
        message: `${name} joined`,
        ts: now,
      },
      { maxEvents: MAX_EVENTS },
    );

    const session = createDungeonSession({ roomId, account, name, ttlMs: SESSION_TTL_MS });

    return new Response(
      JSON.stringify({
        token: session.token,
        roster: Object.values(state.rosterByAccount),
        cursor: state.nextSeq - 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Join failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
