import { PasskeyKit, SACClient } from "passkey-kit";
import { AssembledTransaction } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { RPC_URL } from "./rpc";
import {
    createCircuitBreakerError,
    createRelayerError,
    createTimeoutError,
    createNetworkError,
    createXDRParsingError,
    logError,
    type SmolError,
} from "./errors";

// Lazy-initialized singletons (avoid SSR initialization on CF Workers)
let _account: PasskeyKit | null = null;
let _sac: SACClient | null = null;
let _kale: ReturnType<SACClient['getSACClient']> | null = null;
let _xlm: ReturnType<SACClient['getSACClient']> | null = null;

function getAccount(): PasskeyKit {
    if (!_account) {
        // console.log("[DEBUG] Initializing PasskeyKit with RPC:", RPC_URL);
        _account = new PasskeyKit({
            rpcUrl: RPC_URL,
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
            walletWasmHash: import.meta.env.PUBLIC_WALLET_WASM_HASH,
            timeoutInSeconds: 60, // Increased from 30s to handle complex transactions
        });
    }
    return _account;
}

function getSac(): SACClient {
    if (!_sac) {
        _sac = new SACClient({
            rpcUrl: RPC_URL,
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
        });
    }
    return _sac;
}

function getKale() {
    if (!_kale) {
        _kale = getSac().getSACClient(
            import.meta.env.PUBLIC_KALE_SAC_ID || "CB23WRDQWGSP6YPMY4UV5C4OW5CBTXKYN3XEATG7KJEZCXMJBYEHOUOV"
        );
    }
    return _kale;
}

function getXlm() {
    if (!_xlm) {
        _xlm = getSac().getSACClient(
            import.meta.env.PUBLIC_XLM_SAC_ID || "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
        );
    }
    return _xlm;
}

// Export getters that lazy-init (safe for SSR)
export const account = { get: getAccount };
export const sac = { get: getSac };
export const kale = { get: getKale };
export const xlm = { get: getXlm };

/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects the relayer service from being overwhelmed during outages.
 * Based on industry-standard resilience patterns:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Service is failing, reject all requests for timeout period
 * - HALF_OPEN: Testing recovery with limited requests
 *
 * References:
 * - https://www.codecentric.de/en/knowledge-hub/blog/resilience-design-patterns-retry-fallback-timeout-circuit-breaker
 * - https://dev.to/rafaeljcamara/downstream-resiliency-the-timeout-retry-and-circuit-breaker-patterns-2bej
 */
interface CircuitBreakerState {
    failures: number;
    lastFailureTime: number;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'CLOSED'
};

const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 consecutive failures (recommended: 3-5)
const CIRCUIT_BREAKER_TIMEOUT = 30000; // Reset after 30s (recommended: 30-60s)
const CIRCUIT_BREAKER_HALF_OPEN_MAX_RETRIES = 1; // Only 1 retry in HALF_OPEN state

function checkCircuitBreaker(): void {
    const now = Date.now();

    if (circuitBreaker.state === 'OPEN') {
        // Check if timeout has passed
        if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
            console.log('[CircuitBreaker] Transitioning to HALF_OPEN after timeout');
            circuitBreaker.state = 'HALF_OPEN';
            circuitBreaker.failures = 0;
        } else {
            const error = createCircuitBreakerError();
            logError(error);
            throw error;
        }
    }
}

function recordCircuitBreakerSuccess(): void {
    if (circuitBreaker.state === 'HALF_OPEN') {
        console.log('[CircuitBreaker] Success in HALF_OPEN, closing circuit');
        circuitBreaker.state = 'CLOSED';
    }
    circuitBreaker.failures = 0;
}

function recordCircuitBreakerFailure(): void {
    circuitBreaker.failures++;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        console.warn(`[CircuitBreaker] Opening circuit after ${circuitBreaker.failures} failures`);
        circuitBreaker.state = 'OPEN';
    }
}

/**
 * Send a transaction via Kale Farm Relayer (Raw XDR)
 *
 * Implements enterprise-grade resilience patterns for blockchain transaction submission:
 * - **Circuit Breaker**: Protects relayer from cascading failures (CLOSED → OPEN → HALF_OPEN)
 * - **Exponential Backoff**: Progressively longer waits between retries (2s, 4s, 8s, 16s)
 * - **Jitter**: Random variance (±25%) prevents thundering herd problem
 * - **Timeout Protection**: 60s default with AbortController
 * - **Typed Errors**: SmolError with user-friendly messages and recovery suggestions
 *
 * **Relayer Integration:**
 * - Production: KaleFarm relayer with Turnstile verification (sponsored fees)
 * - Dev/Preview: OpenZeppelin Channels with API key authentication
 *
 * **Best Practices References:**
 * - https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
 * - https://docs.openzeppelin.com/relayer/stellar
 * - https://www.codecentric.de/en/knowledge-hub/blog/resilience-design-patterns-retry-fallback-timeout-circuit-breaker
 *
 * @param txn - AssembledTransaction, Tx, or raw XDR string to submit
 * @param turnstileToken - Cloudflare Turnstile token for Sybil resistance
 * @param options - Optional configuration for retries, timeout, and delay
 * @returns Promise resolving to relayer response (includes transaction hash)
 * @throws SmolError with categorized error types (NETWORK, RELAYER, TIMEOUT, etc.)
 */
export async function send<T>(
    txn: AssembledTransaction<T> | Tx | string,
    turnstileToken: string,
    options: {
        maxRetries?: number;
        timeoutMs?: number;
        retryDelayMs?: number;
    } = {}
) {
    // Check circuit breaker before attempting
    checkCircuitBreaker();

    const {
        maxRetries = circuitBreaker.state === 'HALF_OPEN' ? CIRCUIT_BREAKER_HALF_OPEN_MAX_RETRIES : 3,
        timeoutMs = 60000, // 60s default fetch timeout
        retryDelayMs = 2000, // Base delay for exponential backoff
    } = options;

    // Extract XDR from transaction
    let xdr: string;
    if (txn instanceof AssembledTransaction) {
        xdr = txn.built!.toXDR();
    } else if (typeof txn !== 'string') {
        xdr = txn.toXDR();
    } else {
        xdr = txn;
    }

    // Determine URL and Mode
    const envApiKey = import.meta.env.PUBLIC_RELAYER_API_KEY;
    const envUrl = import.meta.env.PUBLIC_RELAYER_URL;

    // Default to Channels if Key is present AND we are on a safe domain (localhost/pages.dev)
    let relayerUrl = envUrl;
    let useChannels = false;

    // Safety Check: Hostname verification
    const isPagesDev = typeof window !== 'undefined' && window.location.hostname.includes('pages.dev');
    const isLocalhost = typeof window !== 'undefined' && window.location.hostname.includes('localhost');
    const isSafeDevEnv = isPagesDev || isLocalhost;

    if (envApiKey && isSafeDevEnv) {
        // FORCE OZ Channels on safe dev environments (pages.dev, localhost)
        // This ignores PUBLIC_RELAYER_URL to ensure we bypass Turnstile
        relayerUrl = "https://channels.openzeppelin.com";
        useChannels = true;
        console.log("[Relayer] Dev Mode: Forcing OZ Channels bypass");
    } else {
        // Production: Use configured URL or fallback to proxy
        relayerUrl = relayerUrl || "https://api.kalefarm.xyz";
    }

    let lastError: Error | null = null;

    // Retry loop with exponential backoff + jitter
    // Jitter prevents "thundering herd" where many clients retry simultaneously
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const isRetry = attempt > 0;

        if (isRetry) {
            // Exponential backoff: 2s, 4s, 8s, 16s...
            const baseDelay = retryDelayMs * Math.pow(2, attempt - 1);
            // Add jitter: ±25% randomness to prevent synchronized retries
            const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
            const delay = Math.max(0, baseDelay + jitter);

            console.log(`[Relayer] Retry attempt ${attempt}/${maxRetries} after ${delay.toFixed(0)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const startTime = Date.now();

            // Prepare Request based on Mode
            let fetchUrl = relayerUrl;
            let headers: Record<string, string> = { 'Content-Type': 'application/json' };
            let body: any = {};

            if (envApiKey && isSafeDevEnv) {
                headers['Authorization'] = `Bearer ${envApiKey}`;

                if (useChannels) {
                    // OZ Channels Format: { func: "base64", auth: ["base64"] }
                    // We must extract these from the signed transaction XDR
                    try {
                        const { TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
                        // Parse XDR to inspect operations
                        let tx;
                        try {
                            tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
                        } catch (primaryError) {
                            console.warn(
                                "[Relayer] Networks.PUBLIC failed, falling back to string passphrase",
                                primaryError
                            );
                            try {
                                tx = TransactionBuilder.fromXDR(xdr, "Public Global Stellar Network ; September 2015");
                            } catch (fallbackError) {
                                const xdrError = createXDRParsingError(
                                    'Failed to parse transaction XDR',
                                    fallbackError as Error
                                );
                                logError(xdrError);
                                throw xdrError;
                            }
                        }

                        // Validate transaction structure
                        const operations = 'innerTransaction' in tx ? tx.innerTransaction.operations : tx.operations;

                        if (!operations || !Array.isArray(operations)) {
                            const xdrError = createXDRParsingError('Invalid transaction structure: no operations found');
                            logError(xdrError);
                            throw xdrError;
                        }

                        if (operations.length !== 1) {
                            const xdrError = createXDRParsingError(
                                `Channels requires exactly 1 operation, found ${operations.length}`
                            );
                            logError(xdrError);
                            throw xdrError;
                        }

                        // Validate operation structure (Decoded Object from stellar-sdk)
                        const op = operations[0];

                        // It is NOT a raw XDR object, so verify properties directly.
                        if (!op || typeof op !== 'object') {
                            const xdrError = createXDRParsingError('Invalid operation structure: not an object');
                            logError(xdrError);
                            throw xdrError;
                        }

                        // Check for InvokeHostFunction type
                        // stellar-sdk decodes this as type: 'invokeHostFunction'
                        // but the property containing the function might be 'func' or 'function' depending on SDK version
                        if (op.type !== 'invokeHostFunction') {
                            const xdrError = createXDRParsingError(
                                `Channels requires InvokeHostFunction operation, got ${op.type || 'unknown'}`
                            );
                            logError(xdrError);
                            throw xdrError;
                        }

                        // In stellar-sdk, InvokeHostFunction op has properties:
                        // func: HostFunction
                        // auth: SorobanAuthorizationEntry[]
                        const invokeOp = op as any;

                        if (!invokeOp.func || typeof invokeOp.func.toXDR !== 'function') {
                            // Fallback: Check if it's 'function' property (older SDKs)
                            // or if it's already encoded? No, fromXDR returns hydrated objects.
                            console.error("[Relayer] Missing 'func' in op:", invokeOp);
                            const xdrError = createXDRParsingError('Invalid InvokeHostFunction: missing func');
                            logError(xdrError);
                            throw xdrError;
                        }

                        const funcXdr = invokeOp.func.toXDR('base64');
                        const authEntries = invokeOp.auth || [];

                        // Validate auth entries
                        if (!Array.isArray(authEntries)) {
                            const xdrError = createXDRParsingError('Invalid auth entries structure');
                            logError(xdrError);
                            throw xdrError;
                        }


                        const { hash, Keypair, ByteBuffer } = await import("@stellar/stellar-sdk/minimal");
                        // Re-derive the PasskeyKit factory key (used for deployments)
                        // Source: passkey-kit/src/kit.ts
                        const factoryKeypair = Keypair.fromRawEd25519Seed(hash(Buffer.from('kalepail')));

                        // Filter and serialize auth entries
                        // CRITICAL: OZ Channels rejects SourceAccount credentials because it uses its own
                        // source account (channel account) for the transaction. We must FILTER OUT
                        // any SourceAccount auth entries - OZ handles source auth automatically.
                        const validAuthEntries: string[] = [];

                        for (const a of authEntries) {
                            if (!a || typeof a.toXDR !== 'function') {
                                throw createXDRParsingError('Invalid auth entry');
                            }

                            try {
                                const creds = a.credentials();
                                const switchName = creds.switch().name;

                                // Skip SourceAccount credentials - OZ Channels provides its own source auth
                                if (switchName === 'sorobanCredentialsSourceAccount' || switchName === 'sourceAccount') {
                                    console.log("[Relayer] Filtering out SourceAccount credential (OZ handles source auth)");
                                    continue; // Skip this entry entirely
                                }

                                // Keep Address credentials
                                validAuthEntries.push(a.toXDR('base64'));
                            } catch (credError) {
                                // If we can't inspect credentials, include it anyway
                                console.warn("[Relayer] Could not inspect auth entry, including as-is:", credError);
                                validAuthEntries.push(a.toXDR('base64'));
                            }
                        }

                        console.log(`[Relayer] Filtered auth: ${authEntries.length} -> ${validAuthEntries.length} entries`);
                        const authXdr = validAuthEntries;

                        body = {
                            func: funcXdr,
                            auth: authXdr
                        };

                        // Note: Channel URL usually requires a trailing slash or specific path
                        if (!fetchUrl.endsWith('/')) fetchUrl += '/';

                        console.log("[Relayer] Using OZ Channels format with", authXdr.length, "auth entries");

                    } catch (e: any) {
                        // If it's already a SmolError, re-throw
                        if (e.name === 'SmolError') {
                            throw e;
                        }

                        const xdrError = createXDRParsingError(
                            `Failed to prepare Channels payload: ${e.message}`,
                            e
                        );
                        logError(xdrError);
                        throw xdrError;
                    }
                } else {
                    // Fallback Direct Mode (if URL is not Channels, e.g. generic Relayer)
                    body = {
                        transaction_xdr: xdr,
                        fee_token: "native",
                        fee_bump: true
                    };
                }
            } else {
                // KaleFarm Proxy Mode (Default)
                if (!fetchUrl.endsWith('/')) fetchUrl += '/';
                headers['X-Turnstile-Response'] = turnstileToken;
                body = { xdr };
            }

            const response = await fetch(fetchUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const responseTime = Date.now() - startTime;

            // Log telemetry
            console.log(`[Relayer] Response in ${responseTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);

            if (!response.ok) {
                const errorText = await response.text();

                // Distinguish between different error types
                if (response.status >= 500 && attempt < maxRetries) {
                    // Server error - retry
                    const error = createRelayerError(
                        `Relayer server error: ${errorText}`,
                        response.status
                    );
                    lastError = error;
                    console.warn(`[Relayer] Server error, will retry: ${error.message}`);
                    continue;
                } else if (response.status === 429 && attempt < maxRetries) {
                    // Rate limit - retry with longer backoff + jitter
                    const error = createRelayerError(
                        'Relayer rate limit exceeded',
                        response.status
                    );
                    lastError = error;
                    console.warn(`[Relayer] Rate limited, will retry: ${error.message}`);

                    // Double the delay for rate limits + jitter
                    const baseDelay = retryDelayMs * 2;
                    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
                    const delay = Math.max(0, baseDelay + jitter);

                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    // Client error or final retry - don't retry
                    const error = createRelayerError(
                        `Relayer submission failed: ${errorText}`,
                        response.status
                    );
                    logError(error);
                    throw error;
                }
            }

            // Success - log and return
            if (isRetry) {
                console.log(`[Relayer] Success after ${attempt} retries`);
            }

            // Record circuit breaker success
            recordCircuitBreakerSuccess();

            return response.json();

        } catch (error: any) {
            clearTimeout(timeoutId);

            // If it's already a SmolError, re-throw it
            if (error.name === 'SmolError') {
                throw error;
            }

            // Distinguish between timeout and network errors
            if (error.name === 'AbortError') {
                const timeoutError = createTimeoutError('Relayer request', timeoutMs);
                lastError = timeoutError;
                console.error(`[Relayer] Timeout: ${timeoutError.message}`);

                if (attempt < maxRetries) {
                    console.log(`[Relayer] Will retry after timeout...`);
                    continue;
                }
            } else if (error.message?.includes('fetch')) {
                const networkError = createNetworkError(error.message, error);
                lastError = networkError;
                console.error(`[Relayer] Network error: ${networkError.message}`);

                if (attempt < maxRetries) {
                    console.log(`[Relayer] Will retry after network error...`);
                    continue;
                }
            } else {
                // Non-retryable error (e.g., validation error, XDR parsing error)
                throw error;
            }
        }
    }

    // All retries exhausted - record circuit breaker failure
    recordCircuitBreakerFailure();

    if (lastError && 'name' in lastError && lastError.name === 'SmolError') {
        logError(lastError as any as SmolError);
        throw lastError;
    }

    const finalError = createRelayerError(
        `Relayer submission failed after ${maxRetries + 1} attempts`
    );
    logError(finalError);
    throw finalError;
}
