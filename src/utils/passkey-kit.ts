import { PasskeyKit, SACClient } from "passkey-kit";
import { AssembledTransaction } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { getTurnstileToken } from "../stores/turnstile.svelte.ts";
import logger, { LogCategory } from "./debug-logger";

export const account = {
    get: () => new PasskeyKit({
        rpcUrl: import.meta.env.PUBLIC_RPC_URL,
        networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
        walletWasmHash: import.meta.env.PUBLIC_WALLET_WASM_HASH,
        timeoutInSeconds: 30,
    })
};

export const sac = {
    get: () => new SACClient({
        rpcUrl: import.meta.env.PUBLIC_RPC_URL,
        networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
    })
};

export const kale = {
    get: () => sac.get().getSACClient(import.meta.env.PUBLIC_KALE_SAC_ID)
};

export const xlm = {
    get: () => sac.get().getSACClient(import.meta.env.PUBLIC_XLM_SAC_ID || "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA")
};

/**
 * Send a transaction through the relayer proxy.
 * Supports two modes:
 * 1. DIRECT (OZ): Uses PUBLIC_RELAYER_API_KEY + channels.openzeppelin.com (Bypasses Turnstile)
 * 2. PROXY (KALE): Uses Turnstile token + api.kalefarm.xyz
 */
export async function send<T>(txn: AssembledTransaction<T> | Tx | string, turnstileToken?: string) {
    // Extract XDR from transaction
    let xdr: string;
    if (txn instanceof AssembledTransaction) {
        xdr = txn.built!.toXDR();
    } else if (typeof txn !== 'string') {
        xdr = txn.toXDR();
    } else {
        xdr = txn;
    }

    const apiKey = import.meta.env.PUBLIC_RELAYER_API_KEY;
    const isDirectMode = !!apiKey;

    // Default to KaleFarm if no API key is present
    let relayerUrl = import.meta.env.PUBLIC_RELAYER_URL || "https://api.kalefarm.xyz";
    let headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (isDirectMode) {
        // Path 2: Direct to OpenZeppelin Channels
        relayerUrl = "https://channels.openzeppelin.com";
        // NOTE: Commented out to avoid CORS 'header not allowed' error.
        // headers['X-API-Key'] = apiKey; 
        logger.info(LogCategory.TRANSACTION, "Relayer Request (DIRECT)", { url: relayerUrl, xdr });
    } else {
        // Path 1: Proxy through KaleFarm with Turnstile
        const token = turnstileToken || getTurnstileToken();
        if (!token) {
            throw new Error('Turnstile token not available');
        }
        headers['X-Turnstile-Response'] = token;
        logger.info(LogCategory.TRANSACTION, "Relayer Request (PROXY)", { url: relayerUrl, xdr, has_turnstile: !!token });
    }

    if (!relayerUrl) {
        throw new Error('Relayer URL not configured');
    }

    const response = await fetch(relayerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ xdr }),
    });

    if (!response.ok) {
        const error = await response.text();
        logger.error(LogCategory.TRANSACTION, `Relayer Error (${isDirectMode ? 'DIRECT' : 'PROXY'})`, { status: response.status, error });
        throw new Error(`Relayer proxy error: ${error}`);
    }

    const result = await response.json();
    logger.info(LogCategory.TRANSACTION, "Relayer Success", { hash: result.hash || result.transactionHash });
    return result;
}
