/**
 * Simplified Transaction Helpers
 */

import { account, send } from "./passkey-kit";
import { getLatestSequence } from "./base";
import { getSafeRpId } from "./domains";
import { updateContractBalance } from "../stores/balance.svelte";

export interface SignAndSendOptions {
    keyId: string;
    turnstileToken: string;
    updateBalance?: boolean;
    contractId?: string;
    useLock?: boolean; // Maintained for API compatibility
}

export interface SignAndSendResult {
    success: boolean;
    result?: any;
    transactionHash?: string;
    error?: string;
}

/**
 * Simplified sign and send
 */
export async function signAndSend(
    transaction: any,
    options: SignAndSendOptions
): Promise<SignAndSendResult> {
    const { keyId, turnstileToken, updateBalance, contractId } = options;

    try {
        const sequence = await getLatestSequence();
        const rpId = getSafeRpId(window.location.hostname);

        const signedTx = await account.get().sign(transaction, {
            rpId,
            keyId,
            expiration: sequence + 60,
        });

        const result = await send(signedTx, turnstileToken);

        if (updateBalance && contractId) {
            await updateContractBalance(contractId);
        }

        return {
            success: true,
            result,
            transactionHash: result.hash || result.transactionHash,
        };
    } catch (error: any) {
        console.error("[SignAndSend] Error:", error);
        return {
            success: false,
            error: error.message || String(error),
        };
    }
}

/**
 * Alias for signAndSend (for backward compatibility)
 */
export const signSendAndVerify = signAndSend;

/**
 * Universal cancellation check
 */
export function isUserCancellation(error: any): boolean {
    const msg = String(error).toLowerCase();
    return msg.includes("abort") || msg.includes("cancel") || msg.includes("not allowed");
}
