import { PasskeyKit, SACClient } from "passkey-kit";
import { AssembledTransaction } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { getTurnstileToken } from "../stores/turnstile.svelte";

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
 * Send a transaction through the relayer proxy with Turnstile authentication.
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

    const token = turnstileToken || getTurnstileToken();
    if (!token) {
        throw new Error('Turnstile token not available');
    }

    const relayerUrl = import.meta.env.PUBLIC_RELAYER_URL || "https://api.kalefarm.xyz";
    if (!relayerUrl) {
        throw new Error('Relayer URL not configured');
    }

    const response = await fetch(relayerUrl, {
        method: 'POST',
        headers: {
            'X-Turnstile-Response': token,
        },
        body: JSON.stringify({ xdr }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Relayer proxy error: ${error}`);
    }

    return response.json();
}
