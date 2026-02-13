import { VIP_API_BASE } from "./config";
import type { ClientKeyBundle } from "./e2ee/protocol";
import { exportPublicBundle } from "./e2ee/protocol";

export type Challenge = {
  nonce: string;
  issuedAt: number;
};

export type VerifyResult = {
  token: string;
  roomStatus: "ok" | "rejected";
  reason?: string;
  roster?: Array<{
    id: string;
    account: string;
    e2ee: { identity: string; dh: string };
  }>;
};

export async function fetchChallenge(roomId: string): Promise<Challenge> {
  const res = await fetch(`${VIP_API_BASE}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  });
  if (!res.ok) {
    throw new Error("Failed to request challenge");
  }
  return res.json();
}

export function buildChallengeMessage(params: {
  roomId: string;
  nonce: string;
  address: string;
  timestamp: string;
  e2eeDh: string;
}) {
  const { roomId, nonce, address, timestamp, e2eeDh } = params;
  return `THE-VIP|room:${roomId}|nonce:${nonce}|addr:${address}|e2ee-dh:${e2eeDh}|ts:${timestamp}`;
}

export async function signChallenge(
  kit: any,
  address: string,
  roomId: string,
  nonce: string,
  bundle: ClientKeyBundle
) {
  const timestamp = new Date().toISOString();
  const publicBundle = await exportPublicBundle(bundle);
  const payload = buildChallengeMessage({
    roomId,
    nonce,
    address,
    timestamp,
    e2eeDh: publicBundle.dh,
  });

  const { signedMessage } = await kit.signMessage(payload, {
    address,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });

  return {
    payload,
    timestamp,
    signedMessage,
    publicBundle,
  };
}

export async function verifyProof(params: {
  roomId: string;
  address: string;
  signedMessage: string;
  payload: string;
  timestamp: string;
  publicBundle: { identity: string; dh: string };
}): Promise<VerifyResult> {
  const res = await fetch(`${VIP_API_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}
