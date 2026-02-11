import { Keypair } from "@stellar/stellar-sdk";

type Session = {
  roomId: string;
  account: string;
  e2ee: { identity: string; dh: string };
  expiresAt: number;
};

type Challenge = { nonce: string; expiresAt: number };

const challenges: Map<string, Challenge> = new Map();
const sessions: Map<string, Session> = new Map();

function base64ToUint8(str: string): Uint8Array {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extractNonce(payload: string) {
  const part = payload.split("|").find((p) => p.startsWith("nonce:"));
  if (!part) return null;
  return part.split("nonce:")[1];
}

async function verifySignature(address: string, payload: string, signature: string) {
  const kp = Keypair.fromPublicKey(address);
  const msg = new TextEncoder().encode(payload);
  const sig = base64ToUint8(signature);
  return kp.verify(msg, sig);
}

async function accountExists(account: string, horizon: string) {
  const res = await fetch(`${horizon}/accounts/${account}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return { ok: false, reason: "Account not found on-ledger" };
  if (!res.ok) return { ok: false, reason: `Horizon error ${res.status}` };
  return { ok: true };
}

async function isPreCutoff(account: string, cutoffIso: string, horizon: string) {
  const res = await fetch(
    `${horizon}/accounts/${account}/effects?limit=1&order=asc`,
    { headers: { Accept: "application/json" } }
  );
  if (res.status === 404) return { ok: false, reason: "Account not found on-ledger" };
  if (!res.ok) return { ok: false, reason: `Horizon error ${res.status}` };
  const json = await res.json();
  const record = json?._embedded?.records?.[0];
  if (!record?.created_at) return { ok: false, reason: "Could not determine creation time" };
  const created = Date.parse(record.created_at);
  const cutoff = Date.parse(cutoffIso);
  if (Number.isNaN(created) || Number.isNaN(cutoff)) {
    return { ok: false, reason: "Invalid cutoff or created_at timestamp" };
  }
  if (created < cutoff) return { ok: true };
  return {
    ok: false,
    reason: `Account created at ${record.created_at} which is after cutoff ${cutoffIso}`,
  };
}

function assertNoPlaintext(data: unknown) {
  if (typeof data !== "object" || data === null) return;
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase().includes("plain")) {
      throw new Error("plaintext-field-blocked");
    }
    if (typeof v === "object") assertNoPlaintext(v);
  }
}

export class RoomsDO {
  private connections: Map<string, { ws: WebSocket; account: string; e2ee: { identity: string; dh: string } }> =
    new Map();
  private history: any[] = [];

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const account = request.headers.get("x-vip-account") || "unknown";
    const identity = request.headers.get("x-vip-identity") || "";
    const dh = request.headers.get("x-vip-dh") || "";
    const connId = crypto.randomUUID();

    server.accept();
    this.connections.set(connId, { ws: server, account, e2ee: { identity, dh } });

    server.addEventListener("message", (event) => this.onMessage(connId, event));
    server.addEventListener("close", () => this.onClose(connId));
    server.addEventListener("error", () => this.onClose(connId));

    await this.broadcastRoster();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(connId: string, event: MessageEvent) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    try {
      const data = JSON.parse(event.data);
      assertNoPlaintext(data);
      if (data.kind === "chat" || data.kind === "sender-key-share") {
        const enriched = { ...data, serverTs: Date.now() };
        this.history.push(enriched);
        if (this.history.length > 50) this.history.shift();
        this.broadcast(enriched, connId);
      }
    } catch {
      // drop silently
    }
  }

  private onClose(connId: string) {
    this.connections.delete(connId);
    void this.broadcastRoster();
  }

  private broadcast(payload: any, skipConn?: string) {
    const encoded = JSON.stringify(payload);
    for (const [id, connection] of this.connections.entries()) {
      if (id === skipConn) continue;
      try {
        connection.ws.send(encoded);
      } catch {
        // ignore
      }
    }
  }

  private async broadcastRoster() {
    const roster = Array.from(this.connections.values()).map((c) => ({
      id: c.account,
      account: c.account,
      e2ee: c.e2ee,
    }));
    this.broadcast({ kind: "roster", roster });
  }
}

export async function onRequest(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/vip", "");

  if (path === "" || path === "/challenge") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const nonce = crypto.randomUUID();
    const expiresAt =
      Date.now() + 1000 * (Number(env.VIP_CHALLENGE_TTL_SECONDS || 300));
    challenges.set(nonce, { nonce, expiresAt });
    return Response.json({ nonce, issuedAt: Date.now() });
  }

  if (path === "/verify") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await request.json();
    const { roomId, address, signedMessage, payload, publicBundle } = body;
    const nonce = extractNonce(payload);
    if (!nonce) return new Response("Invalid payload", { status: 400 });
    const saved = challenges.get(nonce);
    if (!saved || saved.expiresAt < Date.now()) return new Response("Challenge expired", { status: 400 });
    challenges.delete(nonce);

    const valid = await verifySignature(address, payload, signedMessage);
    if (!valid) return new Response("Bad signature", { status: 401 });

    const horizon = env.VIP_HORIZON_URL || "https://horizon.stellar.org";
    let ok = false;
    let reason = "Not eligible";
    if (roomId === "commons") {
      const res = await accountExists(address, horizon);
      ok = res.ok;
      reason = res.reason || reason;
    } else if (roomId === "lumenauts") {
      const res = await isPreCutoff(address, "2019-10-28T16:00:00Z", horizon);
      ok = res.ok;
      reason = res.reason || reason;
    } else if (roomId === "aquarius") {
      reason = "Aquarius verifier coming soon";
    } else {
      reason = "Unknown room";
    }

    if (!ok) {
      return Response.json({ roomStatus: "rejected", reason }, { status: 403 });
    }

    const token = crypto.randomUUID();
    const expiresAt =
      Date.now() + 1000 * (Number(env.VIP_TOKEN_TTL_SECONDS || 600));
    sessions.set(token, {
      roomId,
      account: address,
      e2ee: publicBundle,
      expiresAt,
    });

    return Response.json({ token, roomStatus: "ok", roster: [] });
  }

  if (path.startsWith("/ws") && request.headers.get("upgrade") === "websocket") {
    const token = url.searchParams.get("token") || "";
    const roomId = url.searchParams.get("room") || "";
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now() || session.roomId !== roomId) {
      return new Response("Invalid token", { status: 401 });
    }
    const headers = new Headers(request.headers);
    headers.set("x-vip-account", session.account);
    headers.set("x-vip-identity", session.e2ee.identity);
    headers.set("x-vip-dh", session.e2ee.dh);

    const doId = env.VIP_ROOMS.idFromName(roomId || "default");
    const stub = env.VIP_ROOMS.get(doId);
    const forwarded = new Request(request.url, {
      method: request.method,
      headers,
    });
    return stub.fetch(forwarded);
  }

  return new Response("Not found", { status: 404 });
}
