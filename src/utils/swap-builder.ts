/**
 * C Address Swap Builder
 * 
 * Builds swap transactions for smart wallets (C addresses) by invoking
 * the Soroswap Aggregator contract directly.
 * 
 * Based on kalepail/ohloss swapService.ts pattern.
 * 
 * @see https://github.com/kalepail/ohloss/blob/main/ohloss-frontend/src/lib/swapService.ts
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
 * Uses environment variable for consistency across the codebase
 * @see https://github.com/kalepail/ohloss/blob/main/ohloss-frontend/src/lib/swapService.ts
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
 * The relayer will rewrap the transaction with its own source account
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
    poolHashes?: string[];
}

/**
 * Build a swap transaction for C address using direct aggregator invocation
 *
 * This implementation follows Tyler's ohloss pattern:
 * - Uses quote.amountIn (top-level) for the input amount
 * - Uses rawTrade.amountOutMin (nested) for minimum output with slippage
 * - Uses rawTrade.distribution for routing information
 *
 * @param quote - Quote response from Soroswap API /quote
 * @param fromAddress - User's C address (smart wallet contract ID)
 * @returns Unsigned XDR string ready for PasskeyKit signing
 */
export async function buildSwapTransactionForCAddress(
    quote: QuoteResponse,
    fromAddress: string
): Promise<string> {
    console.log("[SwapBuilder] Starting buildSwapTransactionForCAddress", {
        quoteAmountIn: quote.amountIn,
        quoteAmountOut: quote.amountOut,
        fromAddress
    });

    // Extract rawTrade from quote response
    const rawTrade = quote.rawTrade as {
        amountIn: string;
        amountOutMin?: string;
        amountInMax?: string;
        amountOut?: string;
        distribution: ExtendedDistribution[];
    };

    if (!rawTrade || !rawTrade.distribution) {
        console.error("[SwapBuilder] Invalid rawTrade - missing distribution", safeStringify(quote, 2));
        throw new Error("Quote does not contain valid rawTrade distribution");
    }

    console.log("[SwapBuilder] RawTrade:", safeStringify(rawTrade, 2));

    const tradeType = quote.tradeType || 'EXACT_IN';
    console.log(`[SwapBuilder] Trade Type: ${tradeType}`);

    let amount1: string;
    let amount2: string;
    let methodName: string;

    if (tradeType === 'EXACT_OUT') {
        amount1 = rawTrade.amountInMax || String(quote.amountIn);
        amount2 = rawTrade.amountOut || String(quote.amountOut);
        methodName = "swap_tokens_for_exact_tokens";

        if (!amount1 || !amount2) {
            throw new Error("Missing amountInMax or amountOut for EXACT_OUT swap");
        }
    } else {
        amount1 = String(quote.amountIn);
        amount2 = rawTrade.amountOutMin || String(quote.amountOut);
        methodName = "swap_exact_tokens_for_tokens";

        if (!amount1 || !amount2) {
            throw new Error("Missing amountIn or amountOutMin for EXACT_IN swap");
        }
    }

    validateAmount(amount1, 'amount1');
    validateAmount(amount2, 'amount2');

    // Get token addresses from the quote's distribution path
    const firstPath = rawTrade.distribution[0]?.path || [];
    const tokenIn = firstPath[0];
    const tokenOut = firstPath[firstPath.length - 1];

    if (!tokenIn || !tokenOut) {
        throw new Error("Could not determine token addresses from quote distribution");
    }

    // Deadline: 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const server = new Server(RPC_URL);
    const contract = new Contract(AGGREGATOR_CONTRACT);

    // Use NULL_ACCOUNT as source - the relayer will rewrap with its funded account
    const sourceAccount = new Account(NULL_ACCOUNT, "0");

    // Build distribution ScVal array with proper structure
    const distributionArg = buildDistributionArg(rawTrade.distribution);

    // BUILD INVOKE ARGS (7 ARGUMENTS)
    // IMPORTANT: Matches useTradeExecution.ts which is the source of truth
    // Signature: method(token_in, amount, token_out, amount_limit, distribution, to, deadline)
    const invokeArgs = [
        nativeToScVal(new Address(tokenIn)),
        nativeToScVal(BigInt(amount1), { type: "i128" }),
        nativeToScVal(new Address(tokenOut)),
        nativeToScVal(BigInt(amount2), { type: "i128" }),
        distributionArg,
        nativeToScVal(new Address(fromAddress)),
        nativeToScVal(deadline, { type: "u64" }),
    ];

    console.log(`[SwapBuilder] Built ${methodName} args (7-arg mode):`, {
        tokenIn,
        amount1,
        tokenOut,
        amount2,
        to: fromAddress,
        deadline: deadline.toString()
    });

    const invokeOp = contract.call(methodName, ...invokeArgs);

    // Build transaction with NULL_ACCOUNT as source
    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000", // 1 XLM max fee
        networkPassphrase: Networks.PUBLIC
    })
        .addOperation(invokeOp)
        .setTimeout(300)
        .build();

    const currentXdr = tx.toXDR();

    // PREEMPTIVE LOGGING: Log the XDR BEFORE simulation
    logger.info(LogCategory.TRANSACTION, "Swap Transaction Built (Pre-Sim)", {
        xdr: currentXdr,
        tradeType,
        method: methodName,
        from: fromAddress
    });

    // Simulate to get auth entries and resource costs
    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
    }

    // Assemble the transaction with simulation results
    const finalTx = assembleTransaction(tx, simResult).build();
    const finalXdr = finalTx.toXDR();

    // Log the successful final XDR (with auth entries)
    logger.info(LogCategory.TRANSACTION, "Swap Transaction Simulated & Assembled", {
        xdr: finalXdr,
        tradeType,
        method: methodName,
        from: fromAddress
    });

    return finalXdr;
}

/**
 * Convert pool hashes to ScVal (Option<Vec<BytesN<32>>>)
 */
function poolHashesToScVal(poolHashes?: string[]): xdr.ScVal {
    if (!poolHashes || poolHashes.length === 0) {
        return xdr.ScVal.scvVec([]); // Return empty Vec, not Void
    }

    const scVec: xdr.ScVal[] = poolHashes.map((base64Str) => {
        const binaryString = atob(base64Str);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        if (bytes.length !== 32) {
            throw new Error(`Expected 32 bytes, got ${bytes.length}`);
        }
        return xdr.ScVal.scvBytes(Buffer.from(bytes));
    });

    return xdr.ScVal.scvVec(scVec);
}

/**
 * Build the distribution argument as ScVal
 */
function buildDistributionArg(distribution: ExtendedDistribution[]): xdr.ScVal {
    return xdr.ScVal.scvVec(
        distribution.map(d => buildDexDistributionScVal(d))
    );
}

/**
 * Build a single DexDistribution as ScVal struct
 * IMPORTANT: Fields must be in alphabetical order for Soroban!
 */
function buildDexDistributionScVal(dist: ExtendedDistribution): xdr.ScVal {
    if (!dist.path || !Array.isArray(dist.path) || dist.path.length === 0) {
        throw new Error("Distribution path must be a non-empty array");
    }

    for (const addr of dist.path) {
        if (typeof addr !== 'string' || !addr.match(/^[GC][A-Z2-7]{55}$/)) {
            throw new Error(`Invalid Stellar address in path: "${addr}"`);
        }
    }

    const protocolId = typeof dist.protocol_id === "string"
        ? PROTOCOL_MAP[dist.protocol_id.toLowerCase()] ?? 0
        : dist.protocol_id;

    // Fields in alphabetical order: bytes, parts, path, protocol_id
    const entries: xdr.ScMapEntry[] = [
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("bytes"),
            val: poolHashesToScVal(dist.poolHashes)
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("parts"),
            val: nativeToScVal(dist.parts, { type: "u32" })
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("path"),
            val: nativeToScVal(dist.path.map(addr => new Address(addr)))
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("protocol_id"),
            val: nativeToScVal(protocolId, { type: "u32" })
        })
    ];

    return xdr.ScVal.scvMap(entries);
}

/**
 * Check if an address is a C address (contract)
 */
export function isCAddress(address: string): boolean {
    return address.startsWith("C");
}

/**
 * Check if an address is a G address (account)
 */
export function isGAddress(address: string): boolean {
    return address.startsWith("G");
}
