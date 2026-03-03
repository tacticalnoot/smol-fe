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

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization issues and fall back.
    }
  }
  return fallback;
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
  try {
    const loginToken = await auth.login();
    if (loginToken?.trim()) {
      smolAuthTokenCache = loginToken.trim();
      return;
    }

    const afterLoginHeaders = auth.getAuthHeaders();
    const afterLoginToken =
      extractBearerToken(afterLoginHeaders) || readCookieToken();
    if (afterLoginToken) {
      smolAuthTokenCache = afterLoginToken;
      return;
    }
  } catch (error) {
    const message = normalizeErrorMessage(
      error,
      `Smol ID session refresh failed for ${contractAddress}.`
    );
    throw new Error(message);
  }

  throw new Error(
    `Smol ID session token was not available after login for ${contractAddress}.`
  );
}

async function getErrorMessage(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`;
  let text = "";

  try {
    text = await res.text();
    if (!text) return fallback;

    const body = JSON.parse(text);
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.reason === "string") return body.reason;
    if (typeof body?.message === "string") return body.message;
    return text;
  } catch {
    // Fall back to raw text/status when JSON parsing fails.
    return text || fallback;
  }
}

export async function fetchChallenge(params: {
  roomId: string;
  address: string;
}): Promise<Challenge> {
  const isContract = isContractAddress(params.address);

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
