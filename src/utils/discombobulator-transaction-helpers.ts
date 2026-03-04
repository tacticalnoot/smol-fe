/**
 * Discombobulator-specific transaction helpers.
 *
 * Isolated from the shared transaction helper to avoid impacting Swapper while
 * tuning retries/error handling for Labs experiments.
 */

import { account, send } from "./passkey-kit";
import { getLatestSequence } from "./base";
import { getSafeRpId } from "./domains";
import { updateAllBalances } from "../stores/balance.svelte.ts";

export interface SignAndSendOptions {
    keyId: string;
    turnstileToken: string;
    updateBalance?: boolean;
    contractId?: string;
    useLock?: boolean;
}

export interface SignAndSendResult {
    success: boolean;
    result?: any;
    transactionHash?: string;
    error?: string;
    softSuccessReason?: "duplicate_nonce";
}

function extractHexTxHash(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    if (/^[0-9a-fA-F]{64}$/.test(normalized)) return normalized;
    return undefined;
}

export function extractTxHashFromRelayerResponse(
    result: any,
    depth = 0,
): string | undefined {
    if (!result || depth > 3) return undefined;

    const direct =
        extractHexTxHash(result?.hash) ||
        extractHexTxHash(result?.transactionHash) ||
        extractHexTxHash(result?.txHash) ||
        extractHexTxHash(result?.transaction_hash) ||
        extractHexTxHash(result?.data?.hash) ||
        extractHexTxHash(result?.data?.transactionHash) ||
        extractHexTxHash(result?.data?.txHash) ||
        extractHexTxHash(result?.data?.transaction_hash);

    if (direct) return direct;
    return extractTxHashFromRelayerResponse(result?.result, depth + 1);
}

function normalizeRelayerMessage(rawMessage: string): string {
    const message = rawMessage.toLowerCase();

    if (
        message.includes("pool_capacity") ||
        message.includes("too many transactions queued") ||
        message.includes("all_channels_busy_or_mutex_contention")
    ) {
        return "Relayer is at capacity. Retry in a few seconds.";
    }

    if (
        message.includes("temporarily unavailable") ||
        message.includes("503") ||
        message.includes("502") ||
        message.includes("gateway")
    ) {
        return "Relayer is temporarily unavailable. Please retry shortly.";
    }

    return rawMessage;
}

function isDuplicateNonceError(error: unknown): boolean {
    const message = String((error as any)?.message || error).toLowerCase();
    return (
        message.includes("simulation_signed_auth_validation_failed") &&
        (message.includes("nonce already exists") ||
            message.includes("existingvalue"))
    );
}

/**
 * Sign and send transaction for Discombobulator.
 *
 * Key behavior change from shared helper:
 * - Avoid outer send retries (send() already retries internally).
 * - Treat duplicate nonce replay as soft-success for idempotent UX.
 */
export async function signAndSend(
    transaction: any,
    options: SignAndSendOptions,
): Promise<SignAndSendResult> {
    const { keyId, turnstileToken, updateBalance, contractId } = options;

    console.log("[DiscomboSignAndSend] Starting:", {
        hasKeyId: !!keyId,
        hasTurnstileToken: !!turnstileToken,
        hasContractId: !!contractId,
        updateBalance,
        transactionType: transaction?.constructor?.name || typeof transaction,
    });

    try {
        const sequence = await getLatestSequence();
        const rpId = getSafeRpId(window.location.hostname);
        const kit = await account.get();

        console.log("[DiscomboSignAndSend] PasskeyKit state:", {
            hasWallet: !!kit.wallet,
            walletOptions: kit.wallet?.options ? "present" : "missing",
            rpId,
            sequence,
        });

        if (!kit.wallet && contractId) {
            console.log(
                "[DiscomboSignAndSend] Wallet not connected, calling connectWallet...",
            );
            await kit.connectWallet({
                rpId,
                keyId,
                getContractId: async () => contractId,
            });
            console.log(
                "[DiscomboSignAndSend] Wallet connected successfully",
            );
        }

        console.log("[DiscomboSignAndSend] Signing transaction...");
        const signedTx = await kit.sign(transaction, {
            rpId,
            keyId,
            expiration: sequence + 60,
        });
        console.log(
            "[DiscomboSignAndSend] Transaction signed, sending to relayer...",
        );

        const result = await send(signedTx, turnstileToken);

        if (updateBalance && contractId) {
            console.log("[DiscomboSignAndSend] Updating all balances...");
            await updateAllBalances(contractId);
        }

        const txHash = extractTxHashFromRelayerResponse(result);
        console.log("[DiscomboSignAndSend] SUCCESS:", {
            hash:
                result?.hash ||
                result?.transactionHash ||
                result?.data?.hash ||
                result?.data?.transactionHash,
            extractedHash: txHash,
        });

        return {
            success: true,
            result,
            transactionHash: txHash,
        };
    } catch (error: any) {
        if (isDuplicateNonceError(error)) {
            console.warn(
                "[DiscomboSignAndSend] Duplicate nonce detected. Treating as soft success.",
            );

            if (updateBalance && contractId) {
                try {
                    await updateAllBalances(contractId);
                } catch (balanceError) {
                    console.warn(
                        "[DiscomboSignAndSend] Balance refresh failed after duplicate nonce:",
                        balanceError,
                    );
                }
            }

            return {
                success: true,
                result: { duplicateNonce: true },
                softSuccessReason: "duplicate_nonce",
            };
        }

        const rawMessage = error?.message || String(error);
        const normalizedMessage = normalizeRelayerMessage(rawMessage);

        console.error("[DiscomboSignAndSend] FAILED:", {
            message: rawMessage,
            normalizedMessage,
            name: error?.name,
            stack: error?.stack?.split("\n").slice(0, 3).join("\n"),
            isAbort: error?.name === "AbortError",
            isNotAllowed: error?.name === "NotAllowedError",
        });

        return {
            success: false,
            error: normalizedMessage,
        };
    }
}

export const signSendAndVerify = signAndSend;

export function isUserCancellation(error: any): boolean {
    const msg = String(error).toLowerCase();
    return (
        msg.includes("abort") ||
        msg.includes("cancel") ||
        msg.includes("not allowed")
    );
}
