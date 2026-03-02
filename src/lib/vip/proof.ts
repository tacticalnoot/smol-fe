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

function getSmolAuthHeaders(): Record<string, string> {
  const token = readCookieToken() || smolAuthTokenCache;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function extractBearerToken(headers: Record<string, string>): string | null {
  const auth = headers.Authorization || headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function ensureSmolSession(contractAddress: string): Promise<void> {
  if (typeof window === "undefined") return;

  const existing = getSmolAuthHeaders();
  const existingToken = extractBearerToken(existing);
  if (existingToken) {
    smolAuthTokenCache = existingToken;
    return;
  }

  const { useAuthentication } = await import("../../hooks/useAuthentication");
  const auth = useAuthentication();
  await auth.login();

  const afterLoginHeaders = auth.getAuthHeaders();
  const afterLoginToken = extractBearerToken(afterLoginHeaders) || readCookieToken();
  if (afterLoginToken) {
    smolAuthTokenCache = afterLoginToken;
    return;
  }

  throw new Error(
    `Smol ID session missing after login for ${contractAddress}. Please refresh and try again.`
  );
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
  const isContract = isContractAddress(params.address);
  if (isContract) {
    await ensureSmolSession(params.address);
  }

  let res = await fetch(`${VIP_API_BASE}/challenge`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...getSmolAuthHeaders(),
    },
    body: JSON.stringify({ roomId: params.roomId, address: params.address }),
  });
  if (isContract && res.status === 401) {
    await ensureSmolSession(params.address);
    res = await fetch(`${VIP_API_BASE}/challenge`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getSmolAuthHeaders(),
      },
      body: JSON.stringify({ roomId: params.roomId, address: params.address }),
    });
  }

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
  const isContract = isContractAddress(params.address);
  if (isContract) {
    await ensureSmolSession(params.address);
  }

  let res = await fetch(`${VIP_API_BASE}/verify`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...getSmolAuthHeaders(),
    },
    body: JSON.stringify(params),
  });
  if (isContract && res.status === 401) {
    await ensureSmolSession(params.address);
    res = await fetch(`${VIP_API_BASE}/verify`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getSmolAuthHeaders(),
      },
      body: JSON.stringify(params),
    });
  }

  if (!res.ok) {
    throw new Error(await getErrorMessage(res));
  }
  return res.json();
}
