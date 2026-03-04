<script lang="ts">
    import { account, sac, kale, xlm, usdc } from "../../utils/passkey-kit";
    import { onMount, tick } from "svelte";
    import confetti from "canvas-confetti";
    import { getSafeRpId } from "../../utils/domains";
    import { Buffer } from "buffer";
    import {
        getQuote,
        buildTransaction,
        sendTransaction,
        TOKENS,
        formatAmount,
        toStroops,
        type QuoteResponse,
    } from "../../utils/soroswap";
    import {
        buildSwapTransactionForCAddress,
        isCAddress,
    } from "../../utils/swap-builder";
    import { getLatestSequence } from "../../utils/base";
    import {
        userState,
        setUserAuth,
        ensureWalletConnected,
    } from "../../stores/user.svelte.ts";
    import {
        balanceState,
        updateAllBalances,
        getUsdcBalance,
    } from "../../stores/balance.svelte.ts";
    import {
        signSendAndVerify,
        isUserCancellation,
    } from "../../utils/transaction-helpers";
    import {
        bootstrapDiscombobulatorDebug,
        noopDiscombobulatorDebugger,
        type DiscombobulatorDebugger,
        type DiscombobulatorSnapshot,
    } from "../../utils/discombobulator-debug";
    import KaleEmoji from "../ui/KaleEmoji.svelte";
    import { Turnstile } from "svelte-turnstile";
    import { Transaction, Networks } from "@stellar/stellar-sdk/minimal";

    // --- DEBUG LOGIC ---
    // PROD FIX: If we have an OZ API key, use direct relayer regardless of hostname.
    // This allows noot.smol.xyz to use OZ Channels directly without Turnstile.
    const hasApiKey = !!import.meta.env.PUBLIC_RELAYER_API_KEY;
    const isDirectRelayer = hasApiKey;

    // --- TYPES ---
    type AppState = "intro" | "transition" | "main";
    type Mode = "swap" | "send";

    type SwapState =
        | "idle"
        | "quoting"
        | "simulated_ok"
        | "simulated_error"
        | "awaiting_passkey"
        | "submitting"
        | "confirmed"
        | "failed";
    type SwapDirection = "XLM_TO_KALE" | "KALE_TO_XLM";

    // --- STATE ---
    let appState = $state<AppState>("intro");
    let mode = $state<Mode>("swap");

    // Auth & Demo
    let isDemoMode = $state(false);
    let isAuthenticated = $derived(!!userState.contractId || isDemoMode);

    // Swap Logic
    let swapState = $state<SwapState>("idle");
    // Refactored from fixed direction to flexible tokens
    let swapInToken = $state<"XLM" | "KALE" | "USDC">("XLM");
    let swapOutToken = $state<"XLM" | "KALE" | "USDC">("KALE");

    // Bi-Directional Input State
    let swapAmount = $state(""); // Top Input (Sell)
    let swapOutputAmount = $state(""); // Bottom Input (Buy)
    let lastEdited = $state<"in" | "out">("in"); // Track which box user typed in

    let quote = $state<QuoteResponse | null>(null);
    let quoteError = $state("");
    let statusMessage = $state("");
    let txHash = $state<string | null>(null);
    let turnstileToken = $state("");
    let turnstileFailed = $state(false); // Fallback mode when Turnstile returns 401
    let discomboDebug: DiscombobulatorDebugger = noopDiscombobulatorDebugger;

    // Provider Logic

    // Send Logic
    let sendTo = $state("");
    let sendAmount = $state("");
    let sendToken = $state<"XLM" | "KALE" | "USDC">("XLM");

    // Balances
    let xlmBalance = $derived(balanceState.xlmBalance);
    let kaleBalance = $derived(balanceState.balance);
    let usdcBalance = $derived(balanceState.usdcBalance);

    // Derived Display
    let tokenInSymbol = $derived(mode === "swap" ? swapInToken : sendToken);
    let tokenOutSymbol = $derived(swapOutToken);
    let balanceIn = $derived(
        mode === "swap"
            ? swapInToken === "XLM"
                ? xlmBalance
                : swapInToken === "KALE"
                  ? kaleBalance
                  : usdcBalance
            : sendToken === "XLM"
              ? xlmBalance
              : sendToken === "KALE"
                ? kaleBalance
                : usdcBalance,
    );

    function maskIdentifier(value: string | null | undefined): string {
        if (!value) return "";
        if (value.length <= 12) return value;
        return `${value.slice(0, 6)}...${value.slice(-6)}`;
    }

    function getDebugSnapshot(): DiscombobulatorSnapshot {
        return {
            appState,
            mode,
            swapState,
            swapInToken,
            swapOutToken,
            swapAmount,
            swapOutputAmount,
            sendToken,
            sendAmount,
            sendToMasked: maskIdentifier(sendTo),
            hasQuote: !!quote,
            statusMessage,
            hasTurnstileToken: !!turnstileToken,
            turnstileFailed,
            isAuthenticated,
            contractIdMasked: maskIdentifier(userState.contractId),
            keyIdMasked: maskIdentifier(userState.keyId),
            walletConnected: userState.walletConnected,
            relayerMode: isDirectRelayer ? "DIRECT" : "PROXY",
        };
    }

    function setAppStateTracked(
        nextState: AppState,
        reason: string,
        context: Record<string, unknown> = {},
    ): void {
        const previousState = appState;
        appState = nextState;
        discomboDebug.transition("app_state", previousState, nextState, {
            reason,
            ...context,
        });
    }

    function setSwapStateTracked(
        nextState: SwapState,
        reason: string,
        context: Record<string, unknown> = {},
    ): void {
        const previousState = swapState;
        swapState = nextState;
        discomboDebug.transition("swap_state", previousState, nextState, {
            reason,
            ...context,
        });
    }

    function setStatusMessageTracked(
        nextStatus: string,
        reason: string,
        context: Record<string, unknown> = {},
    ): void {
        statusMessage = nextStatus;
        discomboDebug.debug("status_message_updated", {
            reason,
            nextStatus,
            ...context,
        });
    }

    function setModeTracked(
        nextMode: Mode,
        reason: string,
        context: Record<string, unknown> = {},
    ): void {
        const previousMode = mode;
        mode = nextMode;
        discomboDebug.transition("mode", previousMode, nextMode, {
            reason,
            ...context,
        });
    }

    // --- UTILS ---
    function formatBigInt(val: bigint | null, decimals = 7): string {
        if (val === null) return "...";
        const str = Number(val) / 10_000_000;
        return str.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    // Rate Calculation Helper
    function calculateRate(
        quote: QuoteResponse,
        amountIn: string,
        amountOut: string,
    ): string {
        try {
            const inVal = parseFloat(amountIn);
            const outVal = parseFloat(amountOut);

            if (!inVal || !outVal) return "--";

            // Rate: How much OUT for 1 IN?
            const rate = outVal / inVal;

            // Format nicely
            return rate.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
            });
        } catch (e) {
            return "--";
        }
    }

    function toggleDirection() {
        const previousIn = swapInToken;
        const previousOut = swapOutToken;
        const temp = swapInToken;
        swapInToken = swapOutToken;
        swapOutToken = temp;
        swapAmount = "";
        swapOutputAmount = "";
        lastEdited = "in";
        quote = null;
        quoteError = "";
        setSwapStateTracked("idle", "direction_toggled");
        discomboDebug.info("swap_direction_toggled", {
            previousIn,
            previousOut,
            nextIn: swapInToken,
            nextOut: swapOutToken,
        });
    }

    const TOKENS_LIST: ("XLM" | "KALE" | "USDC")[] = ["XLM", "KALE", "USDC"];

    function cycleTokenIn() {
        const previousToken = swapInToken;
        const idx = TOKENS_LIST.indexOf(swapInToken);
        let next = TOKENS_LIST[(idx + 1) % TOKENS_LIST.length];
        if (next === swapOutToken) {
            next = TOKENS_LIST[(idx + 2) % TOKENS_LIST.length];
        }
        swapInToken = next;
        quote = null;
        discomboDebug.debug("cycle_token_in", {
            previousToken,
            nextToken: swapInToken,
            swapOutToken,
        });
        if (swapAmount || swapOutputAmount) fetchQuote();
    }

    function cycleTokenOut() {
        const previousToken = swapOutToken;
        const idx = TOKENS_LIST.indexOf(swapOutToken);
        let next = TOKENS_LIST[(idx + 1) % TOKENS_LIST.length];
        if (next === swapInToken) {
            next = TOKENS_LIST[(idx + 2) % TOKENS_LIST.length];
        }
        swapOutToken = next;
        quote = null;
        discomboDebug.debug("cycle_token_out", {
            previousToken,
            nextToken: swapOutToken,
            swapInToken,
        });
        if (swapAmount || swapOutputAmount) fetchQuote();
    }

    function getImpactColor(pct: string | undefined): string {
        if (!pct) return "#4ade80"; // Default nice green
        const val = parseFloat(pct);
        if (isNaN(val)) return "#4ade80";
        if (val <= 5) return "#4ade80"; // Green
        if (val <= 10) return "#facc15"; // Yellow
        return "#ef4444"; // Red
    }

    function triggerSuccessConfetti() {
        const btn = document.querySelector(".action-btn");
        const rect = btn?.getBoundingClientRect();

        if (rect) {
            // Normalized coordinates (0-1)
            const x = (rect.left + rect.width / 2) / window.innerWidth;
            const y = (rect.top + rect.height / 2) / window.innerHeight;

            confetti({
                particleCount: 150,
                spread: 70,
                origin: { x, y },
                colors: ["#94db03", "#ffffff", "#fdda24"],
                zIndex: 10000,
            });
        }
    }

    // --- LIFECYCLE ---
    onMount(async () => {
        discomboDebug = bootstrapDiscombobulatorDebug({
            getSnapshot: getDebugSnapshot,
            hostname: window.location.hostname,
            relayerMode: isDirectRelayer ? "DIRECT" : "PROXY",
            forceTrace: true,
        });

        discomboDebug.info("component_mounted", {
            hasApiKey,
            isDirectRelayer,
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
            relayerUrl: import.meta.env.PUBLIC_RELAYER_URL || "N/A",
            turnstileSiteKeyConfigured: !!import.meta.env
                .PUBLIC_TURNSTILE_SITE_KEY,
        });

        const params = new URLSearchParams(window.location.search);
        if (params.get("demo") === "true") {
            isDemoMode = true;
            discomboDebug.warn("demo_mode_enabled");
            if (!userState.contractId) {
                setUserAuth(
                    "CBNORBI4DCE7LIC42FWMCIWQRULWAUGF2MH2Z7X2RNTFAYNXIACJ33IM",
                    "DEMO-KEY-12345678",
                );
                discomboDebug.info("demo_auth_seeded");
            }
        }
        if (
            userState.contractId &&
            localStorage.getItem("smol:skip_intro") === "true"
        ) {
            setAppStateTracked("main", "skip_intro_from_local_storage");
            await refreshBalances();
        }
    });

    async function handleEnter() {
        try {
            discomboDebug.info("handle_enter_start", {
                isAuthenticated,
                contractId: maskIdentifier(userState.contractId),
                keyIdPresent: !!userState.keyId,
                walletConnected: userState.walletConnected,
            });

            if (!isAuthenticated) {
                const rpId = getSafeRpId(window.location.hostname);
                const kit = await account.get();
                discomboDebug.info("passkey_connect_requested", {
                    rpId,
                });
                const result = await kit.connectWallet({ rpId });
                setUserAuth(result.contractId, result.keyIdBase64);
                discomboDebug.info("passkey_connect_success", {
                    contractId: maskIdentifier(result.contractId),
                    keyId: maskIdentifier(result.keyIdBase64),
                });
            } else {
                discomboDebug.info("wallet_reconnect_requested");
                await ensureWalletConnected();
                discomboDebug.info("wallet_reconnect_completed", {
                    walletConnected: userState.walletConnected,
                });
            }

            setAppStateTracked("transition", "enter_flow_started");
            setTimeout(() => {
                setAppStateTracked("main", "enter_flow_complete");
                refreshBalances();
                localStorage.setItem("smol:skip_intro", "true");
                discomboDebug.info("skip_intro_persisted");
            }, 1000);
        } catch (e) {
            discomboDebug.error("handle_enter_failed", {
                error: e instanceof Error ? e.message : String(e),
            });
            console.error(e);
            alert(
                `Entry failed: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    async function refreshBalances() {
        if (!userState.contractId) {
            discomboDebug.debug("refresh_balances_skipped", {
                reason: "missing_contract_id",
            });
            return;
        }

        discomboDebug.trace("refresh_balances_start", {
            contractId: maskIdentifier(userState.contractId),
        });
        await updateAllBalances(userState.contractId);
        discomboDebug.trace("refresh_balances_done", {
            xlmBalance: xlmBalance?.toString(),
            kaleBalance: kaleBalance?.toString(),
            usdcBalance: usdcBalance?.toString(),
        });
    }

    // --- SWAP QUOTING ---
    let quoteTimeout: ReturnType<typeof setTimeout>;

    function handleInputChange(type: "in" | "out") {
        lastEdited = type;
        discomboDebug.trace("input_changed", {
            type,
            swapAmount,
            swapOutputAmount,
        });
        if (type === "in" && !swapAmount) {
            swapOutputAmount = "";
            quote = null;
            setSwapStateTracked("idle", "input_cleared_in");
            return;
        }
        if (type === "out" && !swapOutputAmount) {
            swapAmount = "";
            quote = null;
            setSwapStateTracked("idle", "input_cleared_out");
            return;
        }
        fetchQuote();
    }

    async function fetchQuote() {
        clearTimeout(quoteTimeout);
        quoteTimeout = setTimeout(async () => {
            const amountStr =
                lastEdited === "in" ? swapAmount : swapOutputAmount;
            if (!amountStr || parseFloat(amountStr) <= 0) {
                quote = null;
                setSwapStateTracked("idle", "quote_not_requested_invalid_amount");
                return;
            }

            setSwapStateTracked("quoting", "quote_requested", {
                amountStr,
                lastEdited,
                swapInToken,
                swapOutToken,
            });
            turnstileFailed = false; // Reset to allow Turnstile retry on new quote

            try {
                const stroops = toStroops(amountStr);
                const assetIn = TOKENS[swapInToken];
                const assetOut = TOKENS[swapOutToken];
                const tradeType =
                    lastEdited === "in" ? "EXACT_IN" : "EXACT_OUT";

                let result;
                if (userState.contractId && isCAddress(userState.contractId)) {
                    // Logic for C-Address if needed, or identical
                }

                result = await getQuote({
                    tokenIn: assetIn,
                    tokenOut: assetOut,
                    amountIn: Number(stroops),
                    tradeType,
                    slippageBps: 500, // 5% (matches Tyler's ohloss implementation)
                });

                quote = result;
                discomboDebug.info("quote_received", {
                    amountIn: result.amountIn,
                    amountOut: result.amountOut,
                    routeHops: result.routePlan?.length ?? 0,
                    priceImpactPct: result.priceImpactPct ?? "0.00",
                });

                if (lastEdited === "in") {
                    swapOutputAmount = formatAmount(quote!.amountOut);
                } else {
                    swapAmount = formatAmount(quote!.amountIn);
                }

                setSwapStateTracked("simulated_ok", "quote_simulation_succeeded");
            } catch (e) {
                console.error("Quote error:", e);
                discomboDebug.error("quote_failed", {
                    error: e instanceof Error ? e.message : String(e),
                    swapInToken,
                    swapOutToken,
                    swapAmount,
                    swapOutputAmount,
                });
                setSwapStateTracked("simulated_error", "quote_simulation_failed");
                setStatusMessageTracked("Route Unavailable", "quote_error");
            }
        }, 500);
    }

    // --- ACTIONS ---
    async function handleAction() {
        if (!userState.contractId || !userState.keyId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "missing_wallet_credentials",
            );
            return;
        }

        discomboDebug.info("action_requested", {
            mode,
            contractId: maskIdentifier(userState.contractId),
            keyId: maskIdentifier(userState.keyId),
            hasQuote: !!quote,
            hasTurnstileToken: !!turnstileToken,
            turnstileFailed,
        });

        if (mode === "swap") {
            await executeSwap();
        } else {
            await executeSend();
        }
    }

    async function executeSwap() {
        if (!quote || !userState.contractId || !userState.keyId) {
            setStatusMessageTracked("No quote available", "missing_quote_or_auth");
            return;
        }

        const useFallback = turnstileFailed && !turnstileToken;
        if (!turnstileToken && !useFallback && !isDirectRelayer) {
            setStatusMessageTracked(
                "Complete verification first",
                "turnstile_required",
            );
            return;
        }

        setSwapStateTracked("awaiting_passkey", "swap_building_started");
        setStatusMessageTracked("Building swap...", "swap_building_started");
        discomboDebug.info("swap_flow_started", {
            contractId: maskIdentifier(userState.contractId),
            keyId: maskIdentifier(userState.keyId),
            swapInToken,
            swapOutToken,
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            useFallback,
            hasTurnstileToken: !!turnstileToken,
        });

        try {
            let tx;

            if (isCAddress(userState.contractId)) {
                discomboDebug.debug("swap_build_for_c_address");
                tx = await buildSwapTransactionForCAddress(
                    quote,
                    userState.contractId,
                );
            } else {
                // Update buildTransaction to use flexible tokens
                discomboDebug.debug("swap_build_for_classic_address");
                const result = await buildTransaction(
                    quote,
                    userState.contractId,
                    userState.contractId,
                );
                tx = new Transaction(
                    result.xdr,
                    import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
                );
            }

            setSwapStateTracked("submitting", "swap_sign_and_submit");
            setStatusMessageTracked("Submitting swap...", "swap_sign_and_submit");

            const sendResult = await signSendAndVerify(tx, {
                keyId: userState.keyId,
                turnstileToken,
                updateBalance: true,
                contractId: userState.contractId,
            });

            if (!sendResult.success) {
                throw new Error(sendResult.error || "Swap submission failed");
            }

            txHash = sendResult.transactionHash ?? null;
            setSwapStateTracked("confirmed", "swap_submission_succeeded");
            setStatusMessageTracked("Swap complete!", "swap_submission_succeeded");
            triggerSuccessConfetti();
            discomboDebug.info("swap_flow_succeeded", {
                txHash,
            });

            // Reset
            swapAmount = "";
            swapOutputAmount = "";
            quote = null;
            turnstileToken = "";
            refreshBalances();
        } catch (e) {
            console.error("Swap error:", e);
            const errorMessage = isUserCancellation(e)
                ? "Swap cancelled"
                : e instanceof Error
                  ? e.message
                  : "Swap failed";
            discomboDebug.error("swap_flow_failed", {
                error: e instanceof Error ? e.message : String(e),
                userCancelled: isUserCancellation(e),
            });
            setStatusMessageTracked(errorMessage, "swap_submission_failed");
            setSwapStateTracked("failed", "swap_submission_failed");
            turnstileToken = "";
        }
    }

    async function executeSend() {
        if (!userState.contractId || !userState.keyId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "missing_wallet_credentials",
            );
            return;
        }

        const recipient = sendTo.trim();
        const amountNum = parseFloat(sendAmount);
        if (!recipient || isNaN(amountNum) || amountNum <= 0) {
            setStatusMessageTracked(
                "Invalid recipient or amount",
                "send_input_invalid",
            );
            return;
        }

        const amountInStroops = BigInt(Math.floor(amountNum * 10_000_000));
        const useFallback = turnstileFailed && !turnstileToken;
        if (!turnstileToken && !useFallback && !isDirectRelayer) {
            setStatusMessageTracked(
                "Complete verification first",
                "turnstile_required",
            );
            return;
        }

        setSwapStateTracked("awaiting_passkey", "send_building_started");
        setStatusMessageTracked(
            `Sending ${sendToken}...`,
            "send_building_started",
        );
        discomboDebug.info("send_flow_started", {
            token: sendToken,
            amount: sendAmount,
            recipient: maskIdentifier(recipient),
            useFallback,
            hasTurnstileToken: !!turnstileToken,
        });

        try {
            let client;
            if (sendToken === "KALE") client = await kale.get();
            else if (sendToken === "USDC") client = await usdc.get();
            else client = await xlm.get();

            const tx = await client.transfer({
                from: userState.contractId,
                to: recipient,
                amount: amountInStroops,
            });

            setSwapStateTracked("submitting", "send_sign_and_submit");
            setStatusMessageTracked(
                "Submitting transfer...",
                "send_sign_and_submit",
            );

            const sendResult = await signSendAndVerify(tx, {
                keyId: userState.keyId,
                turnstileToken,
                updateBalance: true,
                contractId: userState.contractId,
            });

            if (!sendResult.success) {
                throw new Error(sendResult.error || "Transfer failed");
            }

            txHash = sendResult.transactionHash ?? null;
            setSwapStateTracked("confirmed", "send_submission_succeeded");
            setStatusMessageTracked(
                `Sent ${amountNum} ${sendToken}!`,
                "send_submission_succeeded",
            );
            triggerSuccessConfetti();
            discomboDebug.info("send_flow_succeeded", {
                txHash,
                token: sendToken,
                amount: amountNum,
            });

            // Reset
            sendTo = "";
            sendAmount = "";
            turnstileToken = "";
            refreshBalances();
        } catch (e) {
            console.error("Send error:", e);
            const errorMessage = isUserCancellation(e)
                ? "Send cancelled"
                : e instanceof Error
                  ? e.message
                  : "Send failed";
            discomboDebug.error("send_flow_failed", {
                error: e instanceof Error ? e.message : String(e),
                userCancelled: isUserCancellation(e),
            });
            setStatusMessageTracked(errorMessage, "send_submission_failed");
            setSwapStateTracked("failed", "send_submission_failed");
            turnstileToken = "";
        }
    }
</script>

<!-- MOONLIGHT UI -->
<div class="w-full relative flex flex-col items-center justify-center p-2">
    {#if appState === "main"}
        <div class="w-full animate-in slide-in-from-bottom-4 duration-700">
            <!-- HEADER (Balances) -->
            <div class="flex justify-between items-center mb-4 px-2">
                <div class="flex gap-4 text-[10px]">
                    <div
                        class="bg-[#0f172a]/60 px-3 py-2 rounded-lg border border-[#1e293b] flex items-center gap-2 shadow-sm backdrop-blur-sm"
                    >
                        <img
                            src="https://cryptologos.cc/logos/stellar-xlm-logo.png"
                            alt="XLM"
                            class="w-3 h-3 object-contain invert opacity-70"
                        />
                        <span class="text-[#fdda24] uppercase tracking-wider"
                            >XLM</span
                        >
                        <span class="text-[#e2e8f0] drop-shadow-sm"
                            >{formatBigInt(xlmBalance, 2)}</span
                        >
                    </div>
                    <div
                        class="bg-[#0f172a]/60 px-3 py-2 rounded-lg border border-[#1e293b] flex items-center gap-2 shadow-sm backdrop-blur-sm"
                    >
                        <KaleEmoji size="w-3 h-3" />
                        <span class="text-[#94db03] uppercase tracking-wider"
                            >KALE</span
                        >
                        <span class="text-[#e2e8f0] drop-shadow-sm"
                            >{formatBigInt(kaleBalance, 2)}</span
                        >
                    </div>
                    <div
                        class="bg-[#0f172a]/60 px-3 py-2 rounded-lg border border-[#1e293b] flex items-center gap-2 shadow-sm backdrop-blur-sm"
                    >
                        <img
                            src="https://cryptologos.cc/logos/usd-coin-usdc-logo.png"
                            alt="USDC"
                            class="w-3 h-3 object-contain opacity-90"
                        />
                        <span class="text-[#2775ca] uppercase tracking-wider"
                            >USDC</span
                        >
                        <span class="text-[#e2e8f0] drop-shadow-sm"
                            >{formatBigInt(usdcBalance, 2)}</span
                        >
                    </div>
                </div>
                <button
                    onclick={() => {
                        discomboDebug.debug("manual_refresh_requested");
                        refreshBalances();
                    }}
                    class="bg-[#0f172a]/60 w-8 h-8 flex items-center justify-center rounded-lg border border-[#1e293b] text-[#64748b] hover:text-[#7dd3fc] hover:border-[#7dd3fc]/50 hover:bg-[#1e293b] transition-all text-xs backdrop-blur-sm"
                    >↻</button
                >
            </div>

            <!-- DEBUG: Relayer Mode Indicator -->
            <div
                class="fixed bottom-0 right-0 p-2 text-[10px] bg-black/90 backdrop-blur border-t border-l border-lime-400/20 text-lime-400 font-mono z-[10000] text-right pointer-events-none opacity-80 hover:opacity-100 transition-opacity"
            >
                <div>DISCOMBOBULATOR RELAYER MODE</div>
                <div>
                    MODE: {isDirectRelayer
                        ? "DIRECT (BYPASS)"
                        : "PROXY (TURNSTILE)"}
                </div>
                <div>
                    HOST: {typeof window !== "undefined"
                        ? window.location.hostname
                        : "SERVER"}
                </div>
                <div>KEY: {hasApiKey ? "PRESENT" : "MISSING"}</div>
                <div>
                    CFG_URL: {import.meta.env.PUBLIC_RELAYER_URL || "N/A"}
                </div>
                <div>
                    TARGET: {isDirectRelayer
                        ? "channels.openzeppelin.com"
                        : "api.kalefarm.xyz"}
                </div>
                <div>CONSOLE: window.discomboDebug.help()</div>
            </div>

            <!-- GLASS CARD (Moonlight) -->
            <div class="glass-panel flex flex-col relative overflow-hidden">
                <!-- TABS (Top Bar) -->
                <div class="flex border-b border-[#1e293b] bg-[#0f172a]/20">
                    <button
                        class="tab-btn"
                        class:active={mode === "swap"}
                        onclick={() =>
                            setModeTracked("swap", "tab_click_swap")}
                        >SWAP</button
                    >
                    <button
                        class="tab-btn"
                        class:active={mode === "send"}
                        onclick={() =>
                            setModeTracked("send", "tab_click_send")}
                        >SEND</button
                    >
                </div>

                <div class="p-6 md:p-8 flex flex-col gap-6">
                    {#if mode === "swap"}
                        <!-- SWAP MODE -->
                        <div class="flex flex-col gap-2">
                            <!-- INPUT (TOP) -->
                            <div class="input-box group">
                                <input
                                    type="number"
                                    bind:value={swapAmount}
                                    oninput={() => handleInputChange("in")}
                                    placeholder="0.0"
                                    class="w-full bg-transparent text-[#f1f5f9] text-2xl focus:outline-none font-[inherit] placeholder-[#334155]"
                                />

                                <button
                                    class="text-xs text-[#94a3b8] ml-2 tracking-wider hover:text-white hover:bg-white/10 px-2 py-1 rounded transition-colors flex items-center gap-1"
                                    onclick={cycleTokenIn}
                                >
                                    {tokenInSymbol}
                                    <span class="text-[10px] opacity-50">▼</span
                                    >
                                </button>
                            </div>

                            <!-- FLIPPER BRIDGE (Compact) -->
                            <div class="flipper-bridge">
                                <button
                                    class="flipper-btn"
                                    onclick={toggleDirection}
                                    title="Flip Trade"
                                >
                                    ⇅
                                </button>
                            </div>

                            <!-- OUTPUT (BOTTOM - NOW EDITABLE) -->
                            <div class="input-box">
                                {#if swapState === "quoting" && lastEdited === "out"}
                                    <span
                                        class="text-sm text-[#7dd3fc] animate-pulse"
                                        >Calculating...</span
                                    >
                                {:else}
                                    <input
                                        type="number"
                                        bind:value={swapOutputAmount}
                                        oninput={() => handleInputChange("out")}
                                        placeholder="0.0"
                                        class="w-full bg-transparent text-[#f1f5f9] text-2xl focus:outline-none font-[inherit] placeholder-[#334155]"
                                    />
                                {/if}

                                <button
                                    class="text-xs text-[#94a3b8] ml-2 tracking-wider hover:text-white hover:bg-white/10 px-2 py-1 rounded transition-colors flex items-center gap-1"
                                    onclick={cycleTokenOut}
                                >
                                    {tokenOutSymbol}
                                    <span class="text-[10px] opacity-50">▼</span
                                    >
                                </button>
                            </div>
                        </div>
                    {:else}
                        <!-- SEND MODE -->
                        <div class="flex flex-col gap-4">
                            <!-- TOKEN SELECT -->
                            <div
                                class="flex bg-[#0f172a]/40 p-1.5 rounded-xl border border-[#1e293b]"
                            >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {sendToken ===
                                    'XLM'
                                        ? 'bg-[#334155] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (sendToken = "XLM")}
                                    >XLM</button
                                >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {sendToken ===
                                    'KALE'
                                        ? 'bg-[#0284c7] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (sendToken = "KALE")}
                                    >KALE</button
                                >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {sendToken ===
                                    'USDC'
                                        ? 'bg-[#2775ca] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (sendToken = "USDC")}
                                    >USDC</button
                                >
                            </div>

                            <div
                                class="bg-[#0f172a]/40 p-4 rounded-xl border border-[#1e293b]"
                            >
                                <label
                                    class="text-[9px] uppercase text-[#64748b] mb-2 block tracking-widest"
                                    >Address</label
                                >
                                <input
                                    type="text"
                                    bind:value={sendTo}
                                    placeholder="G..."
                                    class="w-full bg-transparent text-xs text-[#f1f5f9] focus:outline-none font-[inherit] placeholder-[#334155]"
                                />
                            </div>

                            <div
                                class="bg-[#0f172a]/40 p-4 rounded-xl border border-[#1e293b] flex items-center"
                            >
                                <input
                                    type="number"
                                    bind:value={sendAmount}
                                    placeholder="0.0"
                                    class="w-full bg-transparent text-[#f1f5f9] text-xl focus:outline-none font-[inherit] placeholder-[#334155]"
                                />
                                <span class="text-xs text-[#94a3b8]"
                                    >{sendToken}</span
                                >
                            </div>
                        </div>
                    {/if}

                    <!-- DATA TUCKED AWAY (Bottom of stack, subtle) -->
                    {#if mode === "swap"}
                        <div
                            class="flex justify-between px-2 opacity-60 text-[8px] tracking-widest text-[#64748b] hover:opacity-100 transition-opacity cursor-default"
                        >
                            <div class="flex gap-3">
                                <span
                                    >Via: <span class="text-[#94a3b8]"
                                        >{quote
                                            ? quote.routePlan?.length > 1
                                                ? "Multi-Hop"
                                                : quote.routePlan?.[0]?.swapInfo?.protocol?.toUpperCase() ||
                                                  (quote.routePlan?.length === 1
                                                      ? "Direct"
                                                      : "--")
                                            : "--"}</span
                                    ></span
                                >
                                <span
                                    >Impact: <span
                                        style="color: {getImpactColor(
                                            quote?.priceImpactPct,
                                        )}"
                                        >{quote?.priceImpactPct ??
                                            "0.00"}%</span
                                    ></span
                                >
                            </div>
                            {#if quote}
                                <span class="text-[#7dd3fc]"
                                    >Rate: 1 {tokenInSymbol} ≈ {calculateRate(
                                        quote,
                                        swapAmount,
                                        swapOutputAmount,
                                    )}
                                    {tokenOutSymbol}</span
                                >
                            {/if}
                        </div>
                    {/if}

                    <!-- Turnstile Verification (for swap mode) -->
                    {#if mode === "swap" && quote && !turnstileToken && !turnstileFailed && !isDirectRelayer}
                        <div
                            class="flex justify-center -mb-2 scale-90 origin-center"
                        >
                            <Turnstile
                                siteKey={import.meta.env
                                    .PUBLIC_TURNSTILE_SITE_KEY}
                                on:callback={(e) => {
                                    turnstileToken = e.detail.token;
                                    turnstileFailed = false;
                                    discomboDebug.info("turnstile_callback_success", {
                                        tokenLength: e.detail.token?.length ?? 0,
                                    });
                                }}
                                on:expired={() => {
                                    turnstileToken = "";
                                    discomboDebug.warn("turnstile_token_expired");
                                }}
                                on:error={() => {
                                    discomboDebug.warn(
                                        "turnstile_failed_enabling_fallback",
                                    );
                                    turnstileFailed = true;
                                }}
                                on:timeout={() => {
                                    discomboDebug.warn(
                                        "turnstile_timeout_enabling_fallback",
                                    );
                                    turnstileFailed = true;
                                }}
                                theme="dark"
                                appearance="interaction-only"
                            />
                        </div>
                    {/if}

                    <!-- Fallback Notice (when Turnstile fails) -->
                    {#if mode === "swap" && quote && turnstileFailed && !turnstileToken}
                        <div
                            class="text-center text-[9px] text-[#fbbf24] bg-[#fbbf24]/10 px-3 py-2 rounded-lg border border-[#fbbf24]/30"
                        >
                            ⚠️ Verification unavailable. You'll pay ~0.0001 XLM
                            fee.
                        </div>
                    {/if}

                    <!-- ACTION BUTTON -->
                    <button
                        onclick={handleAction}
                        class="action-btn w-full py-5 text-sm font-bold shadow-lg"
                        disabled={swapState === "submitting" ||
                            (mode === "swap" &&
                                quote &&
                                !turnstileToken &&
                                !turnstileFailed &&
                                !isDirectRelayer)}
                    >
                        {#if swapState === "submitting"}
                            {mode === "swap" ? "Swapping..." : "Sending..."}
                        {:else if mode === "swap" && turnstileFailed && !turnstileToken}
                            Swap (pay fee)
                        {:else}
                            {mode === "swap" ? "Swap" : "Send"}
                        {/if}
                    </button>
                </div>
            </div>

            <!-- FEEDBACK text -->
            {#if statusMessage}
                <div
                    class="text-center mt-6 text-[10px] text-[#7dd3fc] tracking-widest drop-shadow-[0_0_10px_rgba(125,211,252,0.5)]"
                >
                    {statusMessage}
                </div>
            {/if}
        </div>
    {:else}
        <!-- INTRO (Moonlight) -->
        <div class="text-center">
            <h1
                class="text-4xl text-[#e0f2fe] mb-8 drop-shadow-[0_0_15px_rgba(56,189,248,0.5)]"
                style="-webkit-text-stroke: 1px #0ea5e9;"
            >
                Kale Forest
            </h1>
            <button
                onclick={handleEnter}
                class="action-btn px-10 py-5 text-sm rounded-xl">Enter</button
            >
        </div>
    {/if}
</div>

<style>
    /* MOONLIGHT GLASS CARD */
    .glass-panel {
        /* Translucent Slate Blue */
        background: rgba(29, 41, 61, 0.4);
        border: 1px solid rgba(130, 200, 255, 0.15);
        backdrop-filter: blur(24px);
        box-shadow:
            0 20px 50px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.15),
            inset 0 0 20px rgba(29, 41, 61, 0.2);
        border-radius: 24px;
        transition: all 0.3s ease;
    }

    /* TABS */
    .tab-btn {
        background: transparent;
        border: none;
        color: #64748b;
        font-family: "Press Start 2P", cursive;
        font-size: 10px;
        padding: 16px;
        flex: 1;
        transition: all 0.2s;
        border-bottom: 2px solid transparent;
        letter-spacing: 0.2em;
        /* Removed uppercase */
    }
    .tab-btn.active {
        color: #bae6fd;
        border-bottom-color: #7dd3fc;
        background: linear-gradient(
            to bottom,
            transparent,
            rgba(186, 230, 253, 0.05)
        );
        text-shadow: 0 0 10px rgba(186, 230, 253, 0.5);
    }
    .tab-btn:hover:not(.active) {
        color: #94a3b8;
        background: rgba(255, 255, 255, 0.02);
    }

    /* INPUT GROUP */
    .input-box {
        background: rgba(10, 15, 25, 0.3);
        border: 1px solid rgba(130, 200, 255, 0.1);
        transition: all 0.2s;
        padding: 0 24px;
        height: 72px;
        display: flex;
        align-items: center;
        border-radius: 16px;
    }
    .input-box:focus-within {
        background: rgba(10, 15, 25, 0.5);
        border-color: #7dd3fc;
        box-shadow: 0 0 20px rgba(125, 211, 252, 0.1);
    }

    /* FLIPPER BRIDGE */
    .flipper-bridge {
        height: 12px;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        z-index: 10;
        margin: -6px 0;
    }
    .flipper-btn {
        width: 32px;
        height: 32px;
        background: rgba(29, 41, 61, 0.8);
        border: 1px solid #3c4b64;
        border-radius: 8px;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        cursor: pointer;
        backdrop-filter: blur(4px);
        transition: all 0.2s;
    }
    .flipper-btn:hover {
        background: #0f172a;
        border-color: #7dd3fc;
        color: #7dd3fc;
        box-shadow: 0 0 10px rgba(125, 211, 252, 0.2);
    }

    /* ACTION BUTTON */
    .action-btn {
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        color: #94db03; /* Lime Green Requested */
        border: 1px solid #334155;
        border-bottom: 4px solid #020617;
        font-family: "Press Start 2P", cursive;
        letter-spacing: 0.2em;
        transition: all 0.1s;
        border-radius: 12px;
        text-shadow: 0 0 5px rgba(148, 219, 3, 0.5); /* Glowing Lime Text */
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.4);
        /* Removed uppercase */
    }
    .action-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.5);
        border-color: #94db03;
    }
    .action-btn:active:not(:disabled) {
        transform: translateY(2px);
        border-bottom-width: 2px;
    }
    .action-btn:disabled {
        background: #020617;
        border-color: #1e293b;
        color: #1e293b;
        cursor: not-allowed;
        box-shadow: none;
        text-shadow: none;
    }
</style>

