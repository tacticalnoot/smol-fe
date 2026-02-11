import { Keypair } from "@stellar/stellar-sdk";
import { accountExists } from "./qualifiers/commons";
import { isPreCutoff } from "./qualifiers/lumenauts";
import { aquariusStub } from "./qualifiers/aquarius";
export { RoomsDO } from "./roomsDO";

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

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    if (url.pathname === "/api/vip/challenge" && request.method === "POST") {
      const nonce = crypto.randomUUID();
      const expiresAt =
        Date.now() +
        1000 * (Number(env.VIP_CHALLENGE_TTL_SECONDS) || 300);
      challenges.set(nonce, { nonce, expiresAt });
      return Response.json({ nonce, issuedAt: Date.now() });
    }

    if (url.pathname === "/api/vip/verify" && request.method === "POST") {
      const body = await request.json();
      const { roomId, address, signedMessage, payload, timestamp, publicBundle } = body;
      const nonce = extractNonce(payload);
      if (!nonce) return new Response("Invalid payload", { status: 400 });
      const saved = challenges.get(nonce);
      if (!saved || saved.expiresAt < Date.now()) {
        return new Response("Challenge expired", { status: 400 });
      }
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
        const res = await isPreCutoff(
          address,
          "2019-10-28T16:00:00Z",
          horizon
        );
        ok = res.ok;
        reason = res.reason || reason;
      } else if (roomId === "aquarius") {
        const res = await aquariusStub();
        ok = res.ok;
        reason = res.reason || reason;
      } else {
        reason = "Unknown room";
      }

      if (!ok) {
        return Response.json({ roomStatus: "rejected", reason }, { status: 403 });
      }

      const token = crypto.randomUUID();
      const expiresAt =
        Date.now() + 1000 * (Number(env.VIP_TOKEN_TTL_SECONDS) || 600);
      sessions.set(token, {
        roomId,
        account: address,
        e2ee: publicBundle,
        expiresAt,
      });

      return Response.json({
        token,
        roomStatus: "ok",
        roster: [],
      });
    }

    if (url.pathname === "/api/vip/ws" && request.headers.get("upgrade") === "websocket") {
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
  },
};
