import { Keypair, Networks, WebAuth, rpc, xdr } from "@stellar/stellar-sdk";

export const VIP_HOME_DOMAIN = "smol.xyz";

const SERVER_KEYPAIR_GLOBAL = "__smolVipServerKeypair";

function getWebAuthDomain(request: Request): string {
  const url = new URL(request.url);
  return url.host;
}

function getNetworkPassphrase(): string {
  return import.meta.env.PUBLIC_NETWORK_PASSPHRASE || Networks.PUBLIC;
}

function getSmolApiBase(): string {
  return import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";
}

function getVipRpcUrl(): string {
  return import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";
}

export function getVipNetworkPassphrase(): string {
  return getNetworkPassphrase();
}

export function getVipWebAuthDomain(request: Request): string {
  return getWebAuthDomain(request);
}

function getBearerTokenFromRequest(request: Request): string | null {
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const smolToken = cookies.find((cookie) => cookie.startsWith("smol_token="));
  if (!smolToken) return null;
  const token = smolToken.slice("smol_token=".length).trim();
  return token || null;
}

function decodeJwtPayloadSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;

  const normalized = payloadPart
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");

  try {
    const json = atob(normalized);
    const payload = JSON.parse(json) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function getVipServerKeypair(): Keypair {
  const envSecret = import.meta.env.VIP_SERVER_SECRET as string | undefined;
  if (envSecret) {
    return Keypair.fromSecret(envSecret);
  }

  // For local/dev: allow an ephemeral server key so Labs can run without config.
  // Production reviewers should set `VIP_SERVER_SECRET` as an environment secret.
  if (import.meta.env.DEV) {
    const g = globalThis as unknown as Record<string, unknown>;
    const existing = g[SERVER_KEYPAIR_GLOBAL] as Keypair | undefined;
    if (existing) return existing;
    const created = Keypair.random();
    g[SERVER_KEYPAIR_GLOBAL] = created;
    console.warn(
      "[vip] VIP_SERVER_SECRET missing; using an ephemeral server keypair for DEV only."
    );
    return created;
  }

  throw new Error("VIP server secret is not configured (set VIP_SERVER_SECRET).");
}

export function buildVipChallengeTxXdr(params: {
  request: Request;
  clientAddress: string;
  timeoutSeconds?: number;
}): string {
  const serverKeypair = getVipServerKeypair();
  const networkPassphrase = getVipNetworkPassphrase();
  const webAuthDomain = getVipWebAuthDomain(params.request);

  const timeout = params.timeoutSeconds ?? 300;
  return WebAuth.buildChallengeTx(
    serverKeypair,
    params.clientAddress,
    VIP_HOME_DOMAIN,
    timeout,
    networkPassphrase,
    webAuthDomain
  );
}

export function verifyVipChallengeTx(params: {
  request: Request;
  challengeXdr: string;
  clientAddress: string;
}): { ok: true } | { ok: false; error: string } {
  try {
    const serverKeypair = getVipServerKeypair();
    const networkPassphrase = getVipNetworkPassphrase();
    const webAuthDomain = getVipWebAuthDomain(params.request);

    // Throws on invalid / expired / wrong domain / missing signatures.
    WebAuth.verifyChallengeTxSigners(
      params.challengeXdr,
      serverKeypair.publicKey(),
      networkPassphrase,
      [params.clientAddress],
      VIP_HOME_DOMAIN,
      webAuthDomain
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid challenge transaction";
    return { ok: false, error: message };
  }
}

export async function verifyVipSmolTokenAuth(params: {
  request: Request;
  contractAddress: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getBearerTokenFromRequest(params.request);
  if (!token) {
    return {
      ok: false,
      error: "Smol ID session required. Please sign in with your passkey first.",
    };
  }

  const smolApiBase = getSmolApiBase();
  try {
    const res = await fetch(`${smolApiBase}/created?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        error: "Smol ID session is invalid or expired. Please sign in again.",
      };
    }

    // /created only succeeds with a valid signed token in smol-workflow.
    // Once that passes, we can safely read `sub` from token payload.
    const sub = decodeJwtPayloadSub(token);
    if (!sub) {
      return {
        ok: false,
        error: "Unable to resolve Smol ID session address.",
      };
    }

    if (sub !== params.contractAddress) {
      return {
        ok: false,
        error: "Selected Smol ID wallet does not match your active session.",
      };
    }

    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Smol ID session verification failed.";
    return { ok: false, error: message };
  }
}

export async function contractExistsOnRpc(contractAddress: string): Promise<boolean> {
  try {
    const server = new rpc.Server(getVipRpcUrl());
    await server.getContractData(
      contractAddress,
      xdr.ScVal.scvLedgerKeyContractInstance()
    );
    return true;
  } catch {
    return false;
  }
}
