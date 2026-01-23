/**
 * Unified Horizon API utilities for querying Stellar network data
 *
 * This module provides:
 * - Account existence checks
 * - Operations queries with pagination
 * - XDR parsing for contract invocations
 * - Request deduplication
 * - Proper error handling
 */

import { xdr, StrKey, scValToNative } from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon.stellar.org';

/**
 * In-flight request tracker to prevent duplicate parallel requests
 */
const inflightRequests = new Map<string, Promise<any>>();

/**
 * Transfer operation parsed from XDR
 */
export interface ParsedTransfer {
    from: string;
    to: string;
    amount: number; // Converted to decimal (divided by 10^7)
    contractAddress: string;
    functionName: string;
}

/**
 * Result of operations scan
 */
export interface OperationsScanResult {
    transfers: ParsedTransfer[];
    operationsScanned: number;
    hasMore: boolean;
}

/**
 * Check if an account/contract exists on the Stellar network
 *
 * @param address - Stellar address (G... or C...)
 * @returns true if account exists, false otherwise
 */
export async function accountExists(address: string): Promise<boolean> {
    // Validate address format first
    const trimmed = address.trim();
    if (!trimmed) return false;

    // Accept both account (G) and contract (C) addresses
    const isValid = StrKey.isValidEd25519PublicKey(trimmed) || StrKey.isValidContract(trimmed);
    if (!isValid) {
        console.warn('[Horizon] Invalid address format:', address);
        return false;
    }

    const cacheKey = `account:${trimmed}`;

    // Deduplicate parallel requests
    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey)!;
    }

    const request = (async () => {
        try {
            const url = `${HORIZON_URL}/accounts/${trimmed}`;
            const response = await fetch(url);
            return response.ok;
        } catch (error) {
            console.error('[Horizon] Account existence check failed:', error);
            return false;
        } finally {
            inflightRequests.delete(cacheKey);
        }
    })();

    inflightRequests.set(cacheKey, request);
    return request;
}

/**
 * Scan operations for an account, parsing transfer operations from XDR
 *
 * @param address - Stellar address to scan
 * @param options - Query options
 * @returns Parsed transfers and scan metadata
 */
export async function scanAccountOperations(
    address: string,
    options: {
        limit?: number;
        includeFailedTransactions?: boolean;
        maxPages?: number;
        stopAtTransfer?: (transfer: ParsedTransfer) => boolean;
    } = {}
): Promise<OperationsScanResult> {
    const {
        limit = 200,
        includeFailedTransactions = false,
        maxPages = 1,
        stopAtTransfer
    } = options;

    // Validate address
    const trimmed = address.trim();
    if (!trimmed || !StrKey.isValidContract(trimmed)) {
        console.warn('[Horizon] Invalid contract address for operations scan:', address);
        return { transfers: [], operationsScanned: 0, hasMore: false };
    }

    // Check if account exists first
    const exists = await accountExists(trimmed);
    if (!exists) {
        console.log('[Horizon] Account not found on network, skipping operations scan');
        return { transfers: [], operationsScanned: 0, hasMore: false };
    }

    const cacheKey = `operations:${trimmed}:${limit}:${includeFailedTransactions}`;

    // Deduplicate parallel requests
    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey)!;
    }

    const request = (async () => {
        try {
            const transfers: ParsedTransfer[] = [];
            let operationsScanned = 0;
            let currentUrl = `${HORIZON_URL}/accounts/${trimmed}/operations?limit=${limit}&order=desc&include_failed=${includeFailedTransactions}`;
            let pagesScanned = 0;
            let shouldStop = false;

            while (currentUrl && pagesScanned < maxPages && !shouldStop) {
                const response = await fetch(currentUrl);

                if (!response.ok) {
                    console.warn('[Horizon] Operations query failed:', response.status);
                    break;
                }

                const data = await response.json();
                const operations = data._embedded?.records || [];
                operationsScanned += operations.length;

                for (const op of operations) {
                    // Only process Soroban contract invocations
                    if (op.type !== 'invoke_host_function') continue;

                    const parsed = parseTransferOperation(op);
                    if (parsed) {
                        transfers.push(parsed);

                        // Check if caller wants to stop early
                        if (stopAtTransfer && stopAtTransfer(parsed)) {
                            shouldStop = true;
                            break;
                        }
                    }
                }

                // Get next page URL
                currentUrl = data._links?.next?.href || null;
                pagesScanned++;
            }

            return {
                transfers,
                operationsScanned,
                hasMore: !!currentUrl && pagesScanned >= maxPages
            };
        } catch (error) {
            console.error('[Horizon] Operations scan failed:', error);
            return { transfers: [], operationsScanned: 0, hasMore: false };
        } finally {
            inflightRequests.delete(cacheKey);
        }
    })();

    inflightRequests.set(cacheKey, request);
    return request;
}

/**
 * Parse a transfer operation from Horizon operation object
 *
 * @param op - Horizon operation object
 * @returns Parsed transfer or null if not a transfer
 */
function parseTransferOperation(op: any): ParsedTransfer | null {
    try {
        // Parse the host function XDR
        if (!op.function) return null;

        const buffer = Buffer.from(op.function, 'base64');
        const hostFn = xdr.HostFunction.fromXDR(buffer);

        // We expect InvokeContract
        if (hostFn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
            return null;
        }

        const args = hostFn.invokeContract();
        const contractAddress = StrKey.encodeContract(args.contractAddress().contractId() as any);
        const functionName = args.functionName().toString();

        // Only interested in 'transfer' function
        if (functionName !== 'transfer') return null;

        const valArgs = args.args();

        // transfer(from, to, amount)
        if (valArgs.length !== 3) return null;

        const fromVal = valArgs[0];
        const toVal = valArgs[1];
        const amountVal = valArgs[2];

        const from = scValToNative(fromVal);
        const to = scValToNative(toVal);
        const amountRaw = scValToNative(amountVal);

        // Convert amount from token units (7 decimals) to decimal
        const amount = Number(amountRaw) / 10000000;

        return {
            from,
            to,
            amount,
            contractAddress,
            functionName
        };
    } catch (error) {
        // Silently ignore parse errors - not all operations will be parseable
        return null;
    }
}

/**
 * Find transfers to a specific recipient with specific amounts
 *
 * This is a convenience method for finding specific payment patterns,
 * useful for verifying purchases or upgrades.
 *
 * @param address - Address to scan
 * @param recipient - Expected recipient address
 * @param amounts - Expected payment amounts (will match with 0.1 tolerance)
 * @param options - Additional options
 * @returns Map of amount to whether it was found
 */
export async function findTransfersToRecipient(
    address: string,
    recipient: string,
    amounts: number[],
    options: {
        limit?: number;
        maxPages?: number;
        contractAddress?: string; // Optional: filter by specific token contract
    } = {}
): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>();
    amounts.forEach(amount => result.set(amount, false));

    const amountsRemaining = new Set(amounts);

    const scanResult = await scanAccountOperations(address, {
        ...options,
        stopAtTransfer: (transfer) => {
            // Check if this transfer matches our criteria
            if (transfer.to !== recipient) return false;

            // If contractAddress specified, must match
            if (options.contractAddress && transfer.contractAddress !== options.contractAddress) {
                return false;
            }

            // Check if amount matches any of our target amounts (with tolerance)
            for (const targetAmount of amountsRemaining) {
                if (Math.abs(transfer.amount - targetAmount) < 0.1) {
                    result.set(targetAmount, true);
                    amountsRemaining.delete(targetAmount);

                    // Stop if we found all amounts
                    return amountsRemaining.size === 0;
                }
            }

            return false;
        }
    });

    return result;
}

/**
 * Clear in-flight request cache
 * Useful for testing or forcing fresh requests
 */
export function clearRequestCache(): void {
    inflightRequests.clear();
}
