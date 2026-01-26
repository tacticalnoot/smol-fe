/**
 * C Address Swap Builder
 * 
 * Builds swap transactions for smart wallets (C addresses) by invoking
 * the Soroswap Aggregator contract directly.
 * 
 * Based on canary script: scripts/canary/simulate-swap.mjs
 */

import {
    Contract,
    Address,
    nativeToScVal,
    xdr,
    TransactionBuilder,
    Networks,
    Account
} from "@stellar/stellar-sdk";
import { Server, Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { QuoteResponse, RawTradeDistribution } from "./soroswap";
import logger, { LogCategory } from "./debug-logger";
import { safeStringify } from "./soroswap";



/**
 * Soroswap Aggregator Contract (Mainnet)
 */
export const AGGREGATOR_CONTRACT = import.meta.env.PUBLIC_AGGREGATOR_CONTRACT_ID || "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH";

/** Protocol ID mapping (matches aggregator contract enum) */
const PROTOCOL_MAP: Record<string, number> = {
    soroswap: 0,
    phoenix: 1,
    aqua: 2,
    comet: 3,
    sdex: 4
};

/** RPC endpoint */
const RPC_URL = import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";

/** 
 * Stellar SDK's official NULL_ACCOUNT for building unsigned transactions
 */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Validate that amounts are valid numeric strings before BigInt conversion
 */
function validateAmount(value: string, fieldName: string): void {
    const trimmed = String(value).trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
        throw new Error(`Invalid ${fieldName}: "${value}" - must be a positive integer string`);
    }
    try {
        BigInt(trimmed);
    } catch (error) {
        throw new Error(`Cannot convert ${fieldName} to BigInt: "${value}" - ${error}`);
    }
}

/** Extended distribution with optional poolHashes for aqua protocol */
interface ExtendedDistribution extends RawTradeDistribution {
    pool_hashes?: string[]; // Match API response
    poolHashes?: string[];  // Some internal types use camel
}

/**
 * Build a swap transaction for C address using direct aggregator invocation
 *
 * This implementation follows the CANARY script (scripts/canary/simulate-swap.mjs)
 * which provides the verified mainnet signature order.
 */
export async function buildSwapTransactionForCAddress(
    quote: QuoteResponse,
    fromAddress: string
): Promise<string> {
    console.log("[SwapBuilder] Starting buildSwapTransactionForCAddress (Canary Mode)", {
        quoteAmountIn: quote.amountIn,
        quoteAmountOut: quote.amountOut,
        fromAddress
    });

    const rawTrade = quote.rawTrade as {
        amountIn: string;
        amountOutMin?: string;
        amountInMax?: string;
        amountOut?: string;
        distribution: ExtendedDistribution[];
    };

    if (!rawTrade || !rawTrade.distribution) {
        throw new Error("Quote does not contain valid rawTrade distribution");
    }

    const tradeType = quote.tradeType || 'EXACT_IN';
    console.log(`[SwapBuilder] Trade Type: ${tradeType}`);

    let amount1: string;
    let amountLimit: string;
    let methodName: string;

    if (tradeType === 'EXACT_OUT') {
        amount1 = rawTrade.amountOut || String(quote.amountOut);
        amountLimit = rawTrade.amountInMax || String(quote.amountIn);
        methodName = "swap_tokens_for_exact_tokens";
    } else {
        amount1 = String(quote.amountIn);
        amountLimit = rawTrade.amountOutMin || String(quote.amountOut);
        methodName = "swap_exact_tokens_for_tokens";
    }

    validateAmount(amount1, 'amount1');
    validateAmount(amountLimit, 'amountLimit');

    // Get token addresses from the distribution path
    const firstPath = rawTrade.distribution[0]?.path || [];
    const tokenIn = firstPath[0];
    const tokenOut = firstPath[firstPath.length - 1];

    if (!tokenIn || !tokenOut) {
        throw new Error("Could not determine token addresses from quote distribution");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const server = new Server(RPC_URL);
    const contract = new Contract(AGGREGATOR_CONTRACT);
    const sourceAccount = new Account(NULL_ACCOUNT, "0");
    const distributionArg = buildDistributionArg(rawTrade.distribution);

    /**
     * CANARY SIGNATURE (7 ARGUMENTS)
     * 1. token_in (Address)
     * 2. token_out (Address)
     * 3. amount (i128)
     * 4. amount_limit (i128)
     * 5. distribution (Vec<ScMap>)
     * 6. to (Address)
     * 7. deadline (u64)
     * 
     * NOTE: This order (tokens first, then both amounts) differs from typical Router signatures 
     * but matches the verified Canary script.
     */
    const invokeArgs = [
        nativeToScVal(new Address(tokenIn)),
        nativeToScVal(new Address(tokenOut)),
        nativeToScVal(BigInt(amount1), { type: "i128" }),
        nativeToScVal(BigInt(amountLimit), { type: "i128" }),
        distributionArg,
        nativeToScVal(new Address(fromAddress)),
        nativeToScVal(deadline, { type: "u64" }),
    ];

    console.log(`[SwapBuilder] Built ${methodName} args:`, {
        tokenIn,
        tokenOut,
        amount1,
        amountLimit,
        to: fromAddress
    });

    const invokeOp = contract.call(methodName, ...invokeArgs);

    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000",
        networkPassphrase: Networks.PUBLIC
    })
        .addOperation(invokeOp)
        .setTimeout(300)
        .build();

    const currentXdr = tx.toXDR();

    // Log the base XDR before simulation for debug visibility
    logger.info(LogCategory.TRANSACTION, `Swap Transaction Built (Pre-Sim) - ${methodName}`, {
        xdr: currentXdr,
        tradeType,
        args: { tokenIn, tokenOut, amount: amount1, limit: amountLimit }
    });

    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
    }

    const finalTx = assembleTransaction(tx, simResult).build();
    const finalXdr = finalTx.toXDR();

    logger.info(LogCategory.TRANSACTION, "Swap Transaction Simulated & Assembled", {
        xdr: finalXdr,
        tradeType,
        method: methodName
    });

    return finalXdr;
}

/**
 * Convert pool hashes to ScVal
 * Canary requirement: Must return scvVoid() if empty!
 */
function poolHashesToScVal(poolHashes?: string[]): xdr.ScVal {
    if (!poolHashes || poolHashes.length === 0) {
        return xdr.ScVal.scvVoid(); // CANARY FIX: Use Void not empty Vec
    }

    const scVec: xdr.ScVal[] = poolHashes.map((base64Str) => {
        const binaryString = atob(base64Str);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return xdr.ScVal.scvBytes(Buffer.from(bytes));
    });

    return xdr.ScVal.scvVec(scVec);
}

function buildDistributionArg(distribution: ExtendedDistribution[]): xdr.ScVal {
    return xdr.ScVal.scvVec(
        distribution.map(d => {
            const protocolId = typeof d.protocol_id === "string"
                ? PROTOCOL_MAP[d.protocol_id.toLowerCase()] ?? 0
                : d.protocol_id;

            // Alphabetical order: bytes, parts, path, protocol_id
            const entries: xdr.ScMapEntry[] = [
                new xdr.ScMapEntry({
                    key: xdr.ScVal.scvSymbol("bytes"),
                    val: poolHashesToScVal(d.pool_hashes || d.poolHashes)
                }),
                new xdr.ScMapEntry({
                    key: xdr.ScVal.scvSymbol("parts"),
                    val: nativeToScVal(d.parts, { type: "u32" })
                }),
                new xdr.ScMapEntry({
                    key: xdr.ScVal.scvSymbol("path"),
                    val: nativeToScVal(d.path.map(addr => new Address(addr)))
                }),
                new xdr.ScMapEntry({
                    key: xdr.ScVal.scvSymbol("protocol_id"),
                    val: nativeToScVal(protocolId, { type: "u32" })
                })
            ];

            return xdr.ScVal.scvMap(entries);
        })
    );
}

export function isCAddress(address: string): boolean {
    return address.startsWith("C");
}

export function isGAddress(address: string): boolean {
    return address.startsWith("G");
}
