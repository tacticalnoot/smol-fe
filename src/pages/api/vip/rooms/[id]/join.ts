import type { APIRoute } from "astro";
import { findRoom } from "../../../../../lib/vip/rooms";
import {
  addVipEvent,
  getBearerToken,
  getVipRoom,
  getVipSession,
  saveVipRoom,
  type VipRosterEntry,
} from "../../../../../lib/vip/server/state";

const MAX_EVENTS = 200;

export const POST: APIRoute = async ({ request, params }) => {
  const roomId = params.id || "";
  if (!roomId) return new Response("Room id required", { status: 400 });

  const room = findRoom(roomId);
  if (!room) return new Response("Unknown room", { status: 404 });
  if (room.status !== "enabled") return new Response("Room not enabled", { status: 409 });

  const token = getBearerToken(request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const session = await getVipSession(token);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.roomId !== roomId) return new Response("Unauthorized", { status: 401 });

  try {
    const body = (await request.json()) as {
      account?: string;
      e2ee?: { identity?: string; dh?: string };
    };

    const account = body?.account?.trim() || "";
    const identity = body?.e2ee?.identity || "";
    const dh = body?.e2ee?.dh || "";

    if (!account || account !== session.account) {
      return new Response("Invalid account", { status: 400 });
    }
    if (!identity || !dh) {
      return new Response("Missing E2EE public bundle", { status: 400 });
    }

    const state = await getVipRoom(roomId);
    const now = Date.now();

    const existing = state.roster.find((entry) => entry.account === account);
    const entry: VipRosterEntry = existing
      ? {
          ...existing,
          e2ee: { identity, dh },
          lastSeenAt: now,
        }
      : {
          id: crypto.randomUUID(),
          account,
          e2ee: { identity, dh },
          joinedAt: now,
          lastSeenAt: now,
        };

    state.roster = state.roster
      .filter((rosterEntry) => rosterEntry.account !== account)
      .concat(entry);
    await saveVipRoom(state);

    await addVipEvent(
      roomId,
      {
        kind: "system",
        message: `${account} joined`,
        ts: now,
      },
      { maxEvents: MAX_EVENTS }
    );

    const refreshed = await getVipRoom(roomId);

    const historyLimit = Math.max(
      0,
      Math.min(MAX_EVENTS, room.e2eePolicy?.history ?? 0)
    );
    const recentEvents =
      historyLimit > 0 ? refreshed.events.slice(-historyLimit) : [];

    return new Response(
      JSON.stringify({
        roster: refreshed.roster,
        events: recentEvents,
        cursor: refreshed.nextSeq - 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Join failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

