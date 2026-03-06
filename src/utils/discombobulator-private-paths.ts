/**
 * Discombobulator Private Payment Paths
 *
 * Implements real private payment routing for the Discombobulator:
 *
 * - Private Send: routes tokens through the Soroswap DEX with `to = recipient`
 *   (sender's token → DEX pool → recipient's XLM, no direct P2P transfer on-chain)
 *
 * - Private Receive: commitment-sealed receive requests (handled by privacy executor)
 *
 * - Private Pool: aggregates payment intents with commitment receipts before
 *   settling them on-chain. Each entry is pre-committed before execution.
 */

import {
    Contract,
    Address,
    nativeToScVal,
    TransactionBuilder,
    Networks,
    Account,
    rpc,
    Transaction,
} from "@stellar/stellar-sdk/minimal";

import { ROUTER_CONTRACT } from "./swap-builder";
import { getQuote, TOKENS, type QuoteResponse } from "./soroswap";
import { sha256Hex, stableStringify } from "./discombobulator-spp";

const { assembleTransaction, Server, Api } = rpc;

const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrivateRouteTokenSymbol = "XLM" | "KALE" | "USDC";

export interface PrivateSendQuoteParams {
    sendToken: PrivateRouteTokenSymbol;
    amountStroops: bigint;
    recipientAddress: string;
    fromAddress: string;
    slippageBps?: number;
}

export interface PrivateSendQuote {
    tokenInAddress: string;
    tokenOutAddress: string;
    tokenInSymbol: string;
    tokenOutSymbol: string;
    amountIn: string;
    amountOut: string;
    amountOutMin: string;
    priceImpactPct: string;
    routeLabel: string;
    path: string[];
    rawQuote: QuoteResponse;
}

export type PrivatePoolEntryPhase = "send" | "receive";
export type PrivatePoolEntryStatus =
    | "queued"
    | "submitted"
    | "confirmed"
    | "failed";

export interface PrivatePoolEntry {
    entryId: string;
    phase: PrivatePoolEntryPhase;
    sendToken: PrivateRouteTokenSymbol;
    recipientMasked: string;
    amountMasked: string;
    routeLabel: string;
    commitmentId: string | null;
    intentId: string | null;
    status: PrivatePoolEntryStatus;
    addedAt: string;
    settledAt: string | null;
    txHash: string | null;
}

// ---------------------------------------------------------------------------
// Route selection
// ---------------------------------------------------------------------------

/**
 * Choose the intermediary token for private routing.
 *
 * XLM → KALE → recipient gets KALE  (breaks XLM→address trace)
 * KALE → XLM → recipient gets XLM   (breaks KALE→address trace)
 * USDC → XLM → recipient gets XLM   (breaks USDC→address trace)
 *
 * The DEX pool mediates settlement, so no direct P2P token transfer appears.
 */
export function getPrivateRouteOut(sendToken: PrivateRouteTokenSymbol): {
    tokenOutAddress: string;
    tokenOutSymbol: PrivateRouteTokenSymbol;
} {
    if (sendToken === "XLM") {
        return { tokenOutAddress: TOKENS.KALE, tokenOutSymbol: "KALE" };
    }
    // KALE and USDC both route to XLM
    return { tokenOutAddress: TOKENS.XLM, tokenOutSymbol: "XLM" };
}

export function getPrivateRouteLabel(sendToken: PrivateRouteTokenSymbol): string {
    const { tokenOutSymbol } = getPrivateRouteOut(sendToken);
    return `${sendToken}→${tokenOutSymbol} via DEX pool`;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export async function getPrivateSendQuote(
    params: PrivateSendQuoteParams,
): Promise<PrivateSendQuote> {
    const { sendToken, amountStroops, slippageBps = 300 } = params;

    const tokenInAddress = TOKENS[sendToken];
    const { tokenOutAddress, tokenOutSymbol } = getPrivateRouteOut(sendToken);

    const quote = await getQuote({
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountStroops.toString(),
        tradeType: "EXACT_IN",
        slippageBps,
    });

    const rawTrade = quote.rawTrade as {
        amountIn?: string;
        amountOutMin?: string;
        distribution?: Array<{ parts: number; path: string[] }>;
    } | null;

    const distribution = rawTrade?.distribution ?? [];
    const sortedDist = [...distribution].sort((a, b) => b.parts - a.parts);
    const bestPath = sortedDist[0]?.path ?? [tokenInAddress, tokenOutAddress];

    const amountOutMin =
        rawTrade?.amountOutMin ??
        (quote.otherAmountThreshold && quote.otherAmountThreshold !== "0"
            ? String(BigInt(quote.otherAmountThreshold))
            : String(BigInt(quote.amountOut)));

    return {
        tokenInAddress,
        tokenOutAddress,
        tokenInSymbol: sendToken,
        tokenOutSymbol,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        amountOutMin,
        priceImpactPct: quote.priceImpactPct,
        routeLabel: getPrivateRouteLabel(sendToken),
        path: bestPath,
        rawQuote: quote,
    };
}

// ---------------------------------------------------------------------------
// Build private send transaction (to = recipient, not sender)
// ---------------------------------------------------------------------------

/**
 * Build a swap transaction where the output goes to `recipientAddress`
 * rather than the sender. This is the core of the private send path:
 *
 * sender deducts sendToken → Soroswap router mediates → recipient receives tokenOut
 *
 * On-chain: no direct transfer between sender and recipient — only the pool
 * settlement is visible.
 */
export async function buildPrivateSendTransaction(
    quote: PrivateSendQuote,
    fromAddress: string,
    recipientAddress: string,
): Promise<string> {
    const rpcUrl =
        import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";
    const server = new Server(rpcUrl);
    const contract = new Contract(ROUTER_CONTRACT);
    const sourceAccount = new Account(NULL_ACCOUNT, "0");

    const pathAddresses = quote.path.map((addr) => new Address(addr));

    const amountIn = quote.amountIn;
    const amountOutMin = quote.amountOutMin;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // KEY DIFFERENCE from normal swaps: `to` = recipientAddress (not fromAddress)
    const invokeArgs = [
        nativeToScVal(BigInt(amountIn), { type: "i128" }),
        nativeToScVal(BigInt(amountOutMin), { type: "i128" }),
        nativeToScVal(pathAddresses),
        nativeToScVal(new Address(recipientAddress)), // ← RECIPIENT receives output
        nativeToScVal(deadline, { type: "u64" }),
    ];

    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000",
        networkPassphrase: Networks.PUBLIC,
    })
        .addOperation(
            contract.call("swap_exact_tokens_for_tokens", ...invokeArgs),
        )
        .setTimeout(300)
        .build();

    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        throw new Error(
            `Private send simulation failed: ${simResult.error}`,
        );
    }

    const finalTx = assembleTransaction(tx, simResult).build();
    return finalTx.toXDR();
}

/**
 * Reconstruct a Transaction object from private send XDR for signing.
 */
export function parsePrivateSendXdr(
    xdr: string,
    networkPassphrase: string,
): Transaction {
    return new Transaction(xdr, networkPassphrase);
}

// ---------------------------------------------------------------------------
// Private Pool helpers
// ---------------------------------------------------------------------------

export async function generatePoolEntryId(
    phase: PrivatePoolEntryPhase,
    addedAt: string,
    commitmentId: string | null,
): Promise<string> {
    const source = stableStringify({ phase, addedAt, commitmentId });
    const hash = await sha256Hex(source);
    return `pool-${Date.now().toString(36)}-${hash.slice(0, 8)}`;
}

export function maskPoolAmount(amount: string, token: string): string {
    // Show only the magnitude bucket, not the exact amount
    const num = parseFloat(amount);
    if (!isFinite(num) || num <= 0) return `~? ${token}`;
    if (num < 1) return `~<1 ${token}`;
    if (num < 10) return `~1-10 ${token}`;
    if (num < 100) return `~10-100 ${token}`;
    return `~100+ ${token}`;
}

export function maskPoolRecipient(address: string): string {
    if (!address || address.length < 8) return "unknown";
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function getPoolDepthLabel(entries: PrivatePoolEntry[]): string {
    const n = entries.length;
    if (n === 0) return "empty";
    if (n === 1) return "1 entry (too shallow for privacy)";
    if (n < 4) return `${n} entries (building depth)`;
    return `${n} entries (sufficient depth)`;
}

export function isPoolReadyToSubmit(entries: PrivatePoolEntry[]): boolean {
    return entries.some((e) => e.status === "queued");
}
