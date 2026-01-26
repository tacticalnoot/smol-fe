import { PasskeyKit, SACClient } from "passkey-kit";
import { AssembledTransaction } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { getTurnstileToken } from "../stores/turnstile.svelte.ts";
import logger, { LogCategory } from "./debug-logger";

import { getRpcUrl } from "./rpc";

/**
 * Singleton PasskeyKit instance.
 *
 * CRITICAL: PasskeyKit.sign() requires the wallet to be connected first.
 * The sign() method accesses `this.wallet.options` internally, which is only
 * set after connectWallet() is called. Creating a new instance for each
 * operation loses this state.
 */
let _passkeyKitInstance: PasskeyKit | null = null;

function getPasskeyKit(): PasskeyKit {
    if (!_passkeyKitInstance) {
        _passkeyKitInstance = new PasskeyKit({
            rpcUrl: getRpcUrl(),
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
            walletWasmHash: import.meta.env.PUBLIC_WALLET_WASM_HASH,
            timeoutInSeconds: 30,
        });
    }
    return _passkeyKitInstance;
}

/**
 * Reset the PasskeyKit singleton (for logout/disconnect scenarios)
 */
export function resetPasskeyKit(): void {
    _passkeyKitInstance = null;
}

export const account = {
    get: getPasskeyKit
};

export const sac = {
    get: () => new SACClient({
        rpcUrl: getRpcUrl(), // Dynamic failover
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

    let relayerUrl = "";
    let headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    const getRelayerConfig = (useDirect: boolean) => {
        if (useDirect) {
            return {
                url: "https://channels.openzeppelin.com",
                headers: { ...headers, 'Authorization': `Bearer ${apiKey}` },
                body: { params: { xdr } }
            };
        } else {
            const token = turnstileToken || getTurnstileToken();
            const isLocalhost = typeof window !== 'undefined' && window.location.hostname.includes('localhost');
            if (!token && !isLocalhost) {
                // If we are on pages.dev and have no token, this might fail unless we promote.
                // But for now, we try.
            }
            return {
                url: import.meta.env.PUBLIC_RELAYER_URL || "https://api.kalefarm.xyz",
                headers: { ...headers, 'X-Turnstile-Response': token || '' },
                body: { xdr }
            };
        }
    };

    async function attemptSend(useDirect: boolean) {
        const config = getRelayerConfig(useDirect);

        const requestDebug = {
            url: config.url,
            method: 'POST',
            headers: config.headers,
            body: config.body
        };

        const response = await fetch(config.url, {
            method: 'POST',
            headers: config.headers,
            body: JSON.stringify(config.body),
        });

        const responseText = await response.text();
        const responseDebug = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseText
        };

        logger.info(LogCategory.RELAYER, `Relayer Interaction (${useDirect ? 'DIRECT' : 'PROXY'})`, {
            request: requestDebug,
            response: responseDebug
        });

        if (!response.ok) {
            throw { status: response.status, text: responseText, isDirect: useDirect };
        }

        return JSON.parse(responseText);
    }

    try {
        if (isDirectMode) {
            try {
                return await attemptSend(true);
            } catch (err: any) {
                // FAILOVER: If OZ is 503, try KaleFarm
                if (err.status === 503 || err.status === 502) {
                    console.warn('[Relayer] DIRECT mode failed, attempting failover to PROXY...');
                    return await attemptSend(false);
                }
                throw err;
            }
        } else {
            return await attemptSend(false);
        }
    } catch (e: any) {
        const msg = e.text || e.message || "Relayer failure";
        logger.error(LogCategory.TRANSACTION, `Final Relayer Failure`, { error: msg });
        throw new Error(`Relayer proxy error: ${msg}`);
    }
}
