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

let smolAuthTokenCache: string | null = null;

function isContractAddress(address: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(address);
}

function readCookieToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split("; ");
  const tokenCookie = cookies.find((c) => c.startsWith("smol_token="));
  if (!tokenCookie) return null;
  const idx = tokenCookie.indexOf("=");
  if (idx < 0) return null;
  const raw = tokenCookie.slice(idx + 1).trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function refreshSmolAuthToken(contractAddress: string): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const storedContractId = localStorage.getItem("smol:contractId")?.trim() || "";
  const storedKeyId = localStorage.getItem("smol:keyId")?.trim() || "";
  if (!storedContractId || !storedKeyId || storedContractId !== contractAddress) {
    return null;
  }

  const apiBase = import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";
  const res = await fetch(`${apiBase}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "connect",
      keyId: storedKeyId,
      contractId: storedContractId,
      response: null,
    }),
  });
  if (!res.ok) return null;

  const token = (await res.text()).trim();
  if (token) {
    smolAuthTokenCache = token;
    return token;
  }
  return null;
}

function getSmolAuthHeaders(): Record<string, string> {
  const token = readCookieToken() || smolAuthTokenCache;
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
  if (isContractAddress(params.address) && !getSmolAuthHeaders().Authorization) {
    await refreshSmolAuthToken(params.address);
  }

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
  if (isContractAddress(params.address) && !getSmolAuthHeaders().Authorization) {
    await refreshSmolAuthToken(params.address);
  }

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
