import { VIP_API_BASE } from "./config";

export type Challenge = {
  authMode?: "sep10" | "smol-token";
  xdr: string;
};

export type VerifyResult = {
  token: string;
  roomStatus: "ok" | "rejected";
  reason?: string;
};

function getSmolAuthHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const cookies = document.cookie.split("; ");
  const tokenCookie = cookies.find((c) => c.startsWith("smol_token="));
  if (!tokenCookie) return {};
  const token = tokenCookie.split("=")[1];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.reason === "string") return body.reason;
  } catch {
    // Ignore parse errors and fall back to plain text/status.
  }

  const text = await res.text();
  return text || `${res.status} ${res.statusText}`;
}

export async function fetchChallenge(params: {
  roomId: string;
  address: string;
}): Promise<Challenge> {
  const res = await fetch(`${VIP_API_BASE}/challenge`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...getSmolAuthHeaders(),
    },
    body: JSON.stringify({ roomId: params.roomId, address: params.address }),
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res));
  }
  return res.json();
}

export async function signChallenge(
  kit: any,
  address: string,
  challenge: Challenge
) {
  if (challenge.authMode === "smol-token" || !challenge.xdr) {
    return { xdr: "" };
  }

  const { signedTxXdr } = await kit.signTransaction(challenge.xdr, {
    address,
  });

  return {
    xdr: signedTxXdr,
  };
}

export async function verifyProof(params: {
  roomId: string;
  address: string;
  xdr: string;
}): Promise<VerifyResult> {
  const res = await fetch(`${VIP_API_BASE}/verify`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...getSmolAuthHeaders(),
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res));
  }
  return res.json();
}
