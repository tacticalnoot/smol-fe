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
    } from "../../utils/discombobulator-transaction-helpers";
    import { validateAddress } from "../../utils/transaction-validation";
    import {
        bootstrapDiscombobulatorDebug,
        noopDiscombobulatorDebugger,
        type DiscombobulatorDebugger,
        type DiscombobulatorSnapshot,
    } from "../../utils/discombobulator-debug";
    import {
        appendSppStageReceipt,
        createSppIntentTrace,
        exportSppTraceJson,
        finalizeSppIntentTrace,
        type SppIntentTrace,
        type SppPhase,
        type SppPolicyDescriptor,
        type SppTraceStage,
        type SppTraceStageStatus,
    } from "../../utils/discombobulator-spp";
    import {
        evaluateAspPolicy,
        executePrivacyStage,
        exportPrivacyExecutionJson,
        updatePrivacySettlementBinding,
        type AspPolicyReceipt,
        type PrivacyExecutionArtifact,
        type PrivacyEnvelopeStage as ExecutorPrivacyEnvelopeStage,
        type PrivacyWrapperMode as ExecutorPrivacyWrapperMode,
    } from "../../utils/discombobulator-privacy-executor";
    import {
        getPrivateSendQuote,
        buildPrivateSendTransaction,
        parsePrivateSendXdr,
        getPrivateRouteLabel,
        getPrivateRouteOut,
        generatePoolEntryId,
        maskPoolAmount,
        maskPoolRecipient,
        getPoolDepthLabel,
        isPoolReadyToSubmit,
        type PrivateSendQuote,
        type PrivatePoolEntry,
        type PrivateRouteTokenSymbol,
    } from "../../utils/discombobulator-private-paths";
    import {
        generateZkEligibilityProof,
        summarizeZkEligibility,
        type ZkEligibilityAttachment,
    } from "../../utils/discombobulator-zk-eligibility";
    import {
        generateCommitmentKey,
        serializeCommitmentKey,
        deserializeCommitmentKey,
        verifyCommitmentKeyIntegrity,
        generateWithdrawalProof,
        summarizeWithdrawalProof,
        type CommitmentKeyNote,
        type WithdrawalProofArtifact,
    } from "../../utils/discombobulator-commitment-key";
    import { getSppResearchModel } from "../../utils/discombobulator-spp-research";
    import DiscombobulatorSppResearchPanel from "./DiscombobulatorSppResearchPanel.svelte";
    import KaleEmoji from "../ui/KaleEmoji.svelte";
    import { Turnstile } from "svelte-turnstile";
    import { Transaction, Networks } from "@stellar/stellar-sdk/minimal";

    // --- DEBUG LOGIC ---
    // PROD FIX: If we have an OZ API key, use direct relayer regardless of hostname.
    // This allows noot.smol.xyz to use OZ Channels directly without Turnstile.
    const hasApiKey = !!import.meta.env.PUBLIC_RELAYER_API_KEY;
    const isDirectRelayer = hasApiKey;
    const PRIVACY_WRAPPER_MODE_STORAGE_KEY =
        "smol:discombo:privacy_wrapper_mode";

    // --- TYPES ---
    type AppState = "intro" | "transition" | "main";
    type Mode = "swap" | "send" | "receive" | "pool";
    type TokenSymbol = "XLM" | "KALE" | "USDC";

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
    type PrivacyWrapperMode = ExecutorPrivacyWrapperMode;
    type PrivacyPhase = SppPhase;
    type PrivacyEnvelopeStage = ExecutorPrivacyEnvelopeStage;
    type PrivacyPolicy = {
        descriptor: SppPolicyDescriptor;
        preEnabled: boolean;
        postEnabled: boolean;
    };
    type ReceiveActionOperation =
        | "copy_address"
        | "copy_request"
        | "share_request";
    type ReceiveRequestVisibility = "standard" | "protected";

    // --- STATE ---
    let appState = $state<AppState>("intro");
    let mode = $state<Mode>("swap");

    // Auth & Demo
    let isDemoMode = $state(false);
    let isAuthenticated = $derived(!!userState.contractId || isDemoMode);

    // Swap Logic
    let swapState = $state<SwapState>("idle");
    // Refactored from fixed direction to flexible tokens
    let swapInToken = $state<TokenSymbol>("XLM");
    let swapOutToken = $state<TokenSymbol>("KALE");

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
    let debugQueryEnabled = $state(false);
    let lowGpuMode = $state(false);
    let privacyWrapperMode = $state<PrivacyWrapperMode>("public");
    let discomboDebug: DiscombobulatorDebugger = noopDiscombobulatorDebugger;
    let sppTraceHistory = $state<SppIntentTrace[]>([]);
    let activeSppIntentId = $state<string | null>(null);
    let privacyExecutionHistory = $state<PrivacyExecutionArtifact[]>([]);
    let aspPolicyHistory = $state<AspPolicyReceipt[]>([]);
    let showPrivacyHistory = $state(false);
    let showDisclosurePreview = $state(false);
    let showSppPanel = $state(false);
    let showPhaseReceiptPanel = $state(false);
    let showResultArtifact = $state(false);

    // Pool Mode State
    let poolEntries = $state<PrivatePoolEntry[]>([]);
    let poolSubmitting = $state(false);
    let poolStatusMessage = $state("");
    let poolSendToken = $state<TokenSymbol>("XLM");
    let poolSendAmount = $state("");
    let poolSendTo = $state("");
    let poolSendQuote = $state<PrivateSendQuote | null>(null);
    let poolSendQuoting = $state(false);
    let poolSendQuoteError = $state("");
    // Commitment ticket mode state
    let poolMode = $state<"addressed" | "commitment_ticket">("addressed");
    let lastCommitmentTicket = $state<string | null>(null);
    let poolTicketCopied = $state(false);
    // Redemption panel state
    let redeemTicketInput = $state("");
    let redeemRecipientInput = $state("");
    let redeemProofResult = $state<object | null>(null);
    let redeemWorking = $state(false);
    let redeemError = $state("");
    let privacyHistoryPhaseFilter = $state<
        "all" | PrivacyPhase
    >("all");
    let privacyHistoryDecisionFilter = $state<
        "all" | "allow" | "allow_with_audit"
    >("all");
    let latestPrivacyArtifact = $derived(
        privacyExecutionHistory.length > 0
            ? privacyExecutionHistory[privacyExecutionHistory.length - 1]
            : null,
    );
    let latestAspPolicyReceipt = $derived(
        aspPolicyHistory.length > 0
            ? aspPolicyHistory[aspPolicyHistory.length - 1]
            : null,
    );
    let recentPrivacyArtifacts = $derived(
        [...privacyExecutionHistory].slice(-8).reverse(),
    );
    let filteredPrivacyArtifacts = $derived(
        recentPrivacyArtifacts.filter((artifact) => {
            if (
                privacyHistoryPhaseFilter !== "all" &&
                artifact.commitment.phase !== privacyHistoryPhaseFilter
            ) {
                return false;
            }
            if (
                privacyHistoryDecisionFilter !== "all" &&
                artifact.policyReceipt.decision !== privacyHistoryDecisionFilter
            ) {
                return false;
            }
            return true;
        }),
    );
    let activeReceiptPhase = $derived<PrivacyPhase>(
        mode === "swap" ? "swap" : mode === "send" ? "send" : mode === "pool" ? "send" : "receive",
    );
    let activePhaseArtifact = $derived(
        getLatestPrivacyArtifactForContext({ phase: activeReceiptPhase }),
    );
    let activePhasePolicyReceipt = $derived(
        activePhaseArtifact?.policyReceipt ??
            getLatestAspPolicyReceiptForPhase(activeReceiptPhase),
    );
    let latestCompletedActiveArtifact = $derived(
        activeSppIntentId === null ? activePhaseArtifact : null,
    );

    // Provider Logic

    // Send Logic
    let sendTo = $state("");
    let sendAmount = $state("");
    let sendToken = $state<TokenSymbol>("XLM");

    // Receive Logic
    let receiveToken = $state<TokenSymbol>("XLM");
    let receiveAmount = $state("");
    let receiveRequestVisibility = $state<ReceiveRequestVisibility>("protected");
    let receiveProtectedRequestEnabled = $derived(
        receiveRequestVisibility === "protected" && privacyWrapperMode !== "public",
    );
    let receiveWatchActive = $state(false);
    let receiveWatchFulfilled = $state(false);
    let receiveWatchToken = $state<TokenSymbol>("XLM");
    let receiveWatchTargetStroops = $state<bigint | null>(null);
    let receiveWatchBaselineStroops = $state<bigint | null>(null);
    let receiveWatchDeltaStroops = $state<bigint | null>(null);

    // Balances
    let xlmBalance = $derived(balanceState.xlmBalance);
    let kaleBalance = $derived(balanceState.balance);
    let usdcBalance = $derived(balanceState.usdcBalance);

    // Derived Display
    let tokenInSymbol = $derived(
        mode === "swap" ? swapInToken : mode === "send" ? sendToken : receiveToken,
    );
    let tokenOutSymbol = $derived(swapOutToken);
    let balanceIn = $derived(
        mode === "swap"
            ? swapInToken === "XLM"
                ? xlmBalance
                : swapInToken === "KALE"
                  ? kaleBalance
                  : usdcBalance
            : mode === "send"
              ? sendToken === "XLM"
                  ? xlmBalance
                  : sendToken === "KALE"
                    ? kaleBalance
                    : usdcBalance
              : receiveToken === "XLM"
                ? xlmBalance
                : receiveToken === "KALE"
                  ? kaleBalance
                  : usdcBalance,
    );

    function maskIdentifier(value: string | null | undefined): string {
        if (!value) return "";
        if (value.length <= 12) return value;
        return `${value.slice(0, 6)}...${value.slice(-6)}`;
    }

    function parsePrivacyWrapperMode(
        raw: string | null | undefined,
    ): PrivacyWrapperMode | null {
        const normalized = (raw ?? "").trim().toLowerCase();
        if (!normalized) return null;
        if (
            normalized === "public" ||
            normalized === "shield_before_swap" ||
            normalized === "before"
        ) {
            return normalized === "before"
                ? "shield_before_swap"
                : (normalized as PrivacyWrapperMode);
        }
        if (normalized === "shield_after_swap" || normalized === "after") {
            return normalized === "after"
                ? "shield_after_swap"
                : (normalized as PrivacyWrapperMode);
        }
        if (normalized === "wrap_around_swap" || normalized === "wrapper") {
            return normalized === "wrapper"
                ? "wrap_around_swap"
                : (normalized as PrivacyWrapperMode);
        }
        return null;
    }

    function getPrivacyWrapperLabel(modeValue: PrivacyWrapperMode): string {
        if (modeValue === "shield_before_swap") return "BEFORE";
        if (modeValue === "shield_after_swap") return "AFTER";
        if (modeValue === "wrap_around_swap") return "WRAP";
        return "PUBLIC";
    }

    function getPrivacyWrapperSummary(
        modeValue: PrivacyWrapperMode,
        phase: PrivacyPhase,
    ): string {
        if (phase === "swap") {
            if (modeValue === "shield_before_swap") {
                return "Pre-swap commitment and ASP receipts execute before the public swap.";
            }
            if (modeValue === "shield_after_swap") {
                return "Post-swap commitment and ASP receipts execute after the public swap.";
            }
            if (modeValue === "wrap_around_swap") {
                return "Pre/post commitments and ASP receipts execute around the public swap.";
            }
            return "Current flow is fully public swap semantics.";
        }

        if (phase === "send") {
            if (modeValue === "shield_before_swap") {
                return "Pre-send commitment and ASP receipts execute before the public send.";
            }
            if (modeValue === "shield_after_swap") {
                return "Post-send commitment and ASP receipts execute after the public send.";
            }
            if (modeValue === "wrap_around_swap") {
                return "Pre/post commitments and ASP receipts execute around the send lifecycle.";
            }
            return "Current flow is fully public send semantics.";
        }

        if (modeValue === "shield_before_swap") {
            return "Pre-receive commitment and ASP receipts execute before funds are sent to you.";
        }
        if (modeValue === "shield_after_swap") {
            return "Post-receive commitment and ASP receipts execute after funds arrive.";
        }
        if (modeValue === "wrap_around_swap") {
            return "Pre/post commitments and ASP receipts execute around the receive lifecycle.";
        }
        return "Current flow is fully public receive-request semantics.";
    }

    function getPrivacyPolicy(modeValue: PrivacyWrapperMode): PrivacyPolicy {
        if (modeValue === "shield_before_swap") {
            return {
                descriptor: "pre_envelope_research",
                preEnabled: true,
                postEnabled: false,
            };
        }

        if (modeValue === "shield_after_swap") {
            return {
                descriptor: "post_envelope_research",
                preEnabled: false,
                postEnabled: true,
            };
        }

        if (modeValue === "wrap_around_swap") {
            return {
                descriptor: "pre_and_post_envelope_research",
                preEnabled: true,
                postEnabled: true,
            };
        }

        return {
            descriptor: "public_only",
            preEnabled: false,
            postEnabled: false,
        };
    }

    function getPrivacyPolicyDisplayName(modeValue: PrivacyWrapperMode): string {
        const policy = getPrivacyPolicy(modeValue);
        if (policy.descriptor === "pre_envelope_research") {
            return "pre-settlement commitment";
        }
        if (policy.descriptor === "post_envelope_research") {
            return "post-settlement commitment";
        }
        if (policy.descriptor === "pre_and_post_envelope_research") {
            return "pre+post settlement commitments";
        }
        return "public settlement (no envelopes)";
    }

    function getPrivacyPolicyLabel(modeValue: PrivacyWrapperMode): string {
        return `SPP policy: ${getPrivacyPolicyDisplayName(modeValue)}`;
    }

    function getPrivacyStageMessage(
        phase: PrivacyPhase,
        stage: PrivacyEnvelopeStage,
    ): string {
        if (phase === "swap") {
            return stage === "pre"
                ? "SPP executor: creating pre-swap commitment..."
                : "SPP executor: creating post-swap commitment...";
        }
        if (phase === "send") {
            return stage === "pre"
                ? "SPP executor: creating pre-send commitment..."
                : "SPP executor: creating post-send commitment...";
        }
        return stage === "pre"
            ? "SPP executor: creating pre-receive commitment..."
            : "SPP executor: creating post-receive commitment...";
    }

    function getSwapStatusMessage(
        modeValue: PrivacyWrapperMode,
        phase: "building" | "submitting" | "success",
    ): string {
        if (modeValue === "public") {
            if (phase === "building") return "Building swap...";
            if (phase === "submitting") return "Submitting swap...";
            return "Swap complete!";
        }

        const label = getPrivacyWrapperLabel(modeValue);
        if (phase === "building") return `Building swap (${label} SPP)...`;
        if (phase === "submitting") return `Submitting swap (${label} SPP)...`;
        return `Swap complete (${label} SPP)!`;
    }

    function withPrivacyModeSuffix(base: string): string {
        if (privacyWrapperMode === "public") return base;
        return `${base} (${getPrivacyWrapperLabel(privacyWrapperMode)} SPP)`;
    }

    function toSppStage(stage: PrivacyEnvelopeStage): SppTraceStage {
        return stage === "pre" ? "pre_envelope" : "post_envelope";
    }

    function summarizeIntentPayload(
        phase: PrivacyPhase,
        payload: Record<string, unknown>,
    ): string {
        if (phase === "swap") {
            return `Swap ${String(payload.swapInToken ?? "?")} -> ${String(payload.swapOutToken ?? "?")}`;
        }
        if (phase === "send") {
            return `Send ${String(payload.sendToken ?? "?")}`;
        }
        return `Receive ${String(payload.receiveToken ?? "?")}`;
    }

    function updateSppTraceById(
        intentId: string,
        updater: (trace: SppIntentTrace) => SppIntentTrace,
    ): void {
        const index = sppTraceHistory.findIndex((trace) => trace.intentId === intentId);
        if (index === -1) return;

        const next = [...sppTraceHistory];
        next[index] = updater(next[index]);
        sppTraceHistory = next.slice(-40);
    }

    function addSppStageReceipt(
        intentId: string,
        stage: SppTraceStage,
        status: SppTraceStageStatus,
        details: Record<string, unknown> = {},
        durationMs?: number,
    ): void {
        const receipt = {
            stage,
            status,
            at: new Date().toISOString(),
            durationMs,
            details,
        };
        updateSppTraceById(intentId, (trace) => appendSppStageReceipt(trace, receipt));
    }

    async function startSppIntent(
        phase: PrivacyPhase,
        payload: Record<string, unknown>,
    ): Promise<{ trace: SppIntentTrace; aspPolicyReceipt: AspPolicyReceipt }> {
        const policy = getPrivacyPolicy(privacyWrapperMode);
        const summary = summarizeIntentPayload(phase, payload);
        const aspPolicyReceipt = await evaluateAspPolicy({
            phase,
            mode: privacyWrapperMode,
            payload,
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
            relayerMode: isDirectRelayer ? "DIRECT" : "PROXY",
        });
        aspPolicyHistory = [...aspPolicyHistory, aspPolicyReceipt].slice(-60);
        const trace = await createSppIntentTrace({
            phase,
            mode: privacyWrapperMode,
            policy: policy.descriptor,
            summary,
            payload: {
                ...payload,
                aspPolicyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
                aspAuditLevel: aspPolicyReceipt.auditLevel,
            },
        });
        sppTraceHistory = [...sppTraceHistory, trace].slice(-40);
        activeSppIntentId = trace.intentId;
        discomboDebug.info("privacy_policy_evaluated", {
            intentId: trace.intentId,
            phase,
            mode: privacyWrapperMode,
            policyReceiptId: aspPolicyReceipt.receiptId,
            policyId: aspPolicyReceipt.policyId,
            decision: aspPolicyReceipt.decision,
            auditLevel: aspPolicyReceipt.auditLevel,
            riskScore: aspPolicyReceipt.riskScore,
            settlementMode: aspPolicyReceipt.settlementMode,
        });
        discomboDebug.info("spp_intent_started", {
            intentId: trace.intentId,
            intentHash: trace.intentHash,
            phase,
            mode: privacyWrapperMode,
            policy: policy.descriptor,
            summary,
        });
        return {
            trace,
            aspPolicyReceipt,
        };
    }

    function completeSppIntent(
        intentId: string,
        status: "succeeded" | "failed",
        patch: { txHash?: string | null; error?: string | null } = {},
    ): void {
        updateSppTraceById(intentId, (trace) =>
            finalizeSppIntentTrace(trace, status, {
                txHash: patch.txHash ?? trace.txHash,
                error: patch.error ?? trace.error,
            }),
        );

        if (activeSppIntentId === intentId) {
            activeSppIntentId = null;
        }

        discomboDebug.info("spp_intent_completed", {
            intentId,
            status,
            txHash: patch.txHash ?? null,
            error: patch.error ?? null,
        });
    }

    function getSppTrace(limit = 50): SppIntentTrace[] {
        const safeLimit = Math.max(1, Math.floor(limit));
        return [...sppTraceHistory].slice(-safeLimit);
    }

    function clearSppTrace(): void {
        sppTraceHistory = [];
        activeSppIntentId = null;
    }

    function exportSppTrace(): string {
        return exportSppTraceJson(sppTraceHistory);
    }

    function getPrivacyArtifacts(limit = 25): PrivacyExecutionArtifact[] {
        const safeLimit = Math.max(1, Math.floor(limit));
        return [...privacyExecutionHistory].slice(-safeLimit);
    }

    function clearPrivacyArtifacts(): void {
        privacyExecutionHistory = [];
        aspPolicyHistory = [];
    }

    function exportPrivacyArtifacts(): string {
        return exportPrivacyExecutionJson(aspPolicyHistory, privacyExecutionHistory);
    }

    function bindPrivacySettlementForIntent(
        intentId: string,
        patch: {
            txHash?: string | null;
            confirmedAt?: string | null;
            softSuccessReason?: "duplicate_nonce" | null;
            note?: string | null;
        } = {},
    ): void {
        let updatedCount = 0;
        privacyExecutionHistory = privacyExecutionHistory.map((artifact) => {
            if (artifact.commitment.intentId !== intentId) {
                return artifact;
            }
            updatedCount += 1;
            return updatePrivacySettlementBinding({
                artifact,
                ...patch,
            });
        });

        if (updatedCount > 0) {
            discomboDebug.info("privacy_settlement_bound", {
                intentId,
                updatedArtifacts: updatedCount,
                txHash: patch.txHash ?? null,
                softSuccessReason: patch.softSuccessReason ?? null,
            });
        }
    }

    async function runPrivacyEnvelopeStageIfEnabled(
        phase: PrivacyPhase,
        stage: PrivacyEnvelopeStage,
        payload: Record<string, unknown>,
        aspPolicyReceipt: AspPolicyReceipt,
        intentId?: string,
    ): Promise<void> {
        const policy = getPrivacyPolicy(privacyWrapperMode);
        const enabled = stage === "pre" ? policy.preEnabled : policy.postEnabled;
        const stageLabel = toSppStage(stage);

        if (!enabled) {
            discomboDebug.trace("privacy_stage_skipped", {
                phase,
                stage,
                privacyWrapperMode,
                policy: policy.descriptor,
            });
            if (intentId) {
                addSppStageReceipt(intentId, stageLabel, "skipped", {
                    phase,
                    mode: privacyWrapperMode,
                    policy: policy.descriptor,
                    policyReceiptId: aspPolicyReceipt.receiptId,
                    aspDecision: aspPolicyReceipt.decision,
                });
            }
            return;
        }

        const message = withPrivacyModeSuffix(getPrivacyStageMessage(phase, stage));
        setStatusMessageTracked(message, "privacy_stage_status", {
            phase,
            stage,
            privacyWrapperMode,
            policy: policy.descriptor,
        });
        discomboDebug.info("privacy_stage_started", {
            phase,
            stage,
            privacyWrapperMode,
            policy: policy.descriptor,
        });
        if (intentId) {
            addSppStageReceipt(intentId, stageLabel, "started", {
                phase,
                mode: privacyWrapperMode,
                policy: policy.descriptor,
                policyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
                aspAuditLevel: aspPolicyReceipt.auditLevel,
            });
        }

        const startedAt = Date.now();
        await tick();
        const artifact = intentId
            ? await executePrivacyStage({
                  phase,
                  stage,
                  mode: privacyWrapperMode,
                  intentId,
                  payload,
                  policyReceipt: aspPolicyReceipt,
              })
            : null;

        // Generate ZK balance eligibility proof during pre-envelope stage.
        // Proves balance >= operation amount without revealing actual balance.
        if (artifact && stage === "pre" && (phase === "swap" || phase === "send")) {
            try {
                const operationToken = phase === "swap"
                    ? String(payload.swapInToken ?? "XLM")
                    : String(payload.sendToken ?? "XLM");
                const operationAmountRaw =
                    payload.amountIn ?? payload.amountInStroops ?? payload.amount;
                const operationStroops = operationAmountRaw
                    ? BigInt(String(operationAmountRaw).replace(/[^0-9]/g, "") || "0")
                    : 0n;
                const currentBalance = getTokenBalance(operationToken as TokenSymbol);

                if (currentBalance !== null && operationStroops > 0n && userState.contractId) {
                    setStatusMessageTracked(
                        withPrivacyModeSuffix("Generating ZK eligibility proof..."),
                        "zk_eligibility_started",
                        { phase, tokenSymbol: operationToken },
                    );
                    const zkProof = await generateZkEligibilityProof(
                        currentBalance,
                        operationStroops,
                        operationToken,
                        userState.contractId,
                    );
                    artifact.zkEligibility = zkProof;
                    discomboDebug.info("zk_eligibility_completed", summarizeZkEligibility(zkProof));
                }
            } catch (zkErr) {
                discomboDebug.warn("zk_eligibility_failed", {
                    error: zkErr instanceof Error ? zkErr.message : String(zkErr),
                    phase,
                    stage,
                });
                // Non-fatal: ZK proof is an enhancement, not a gate
            }
        }

        if (artifact) {
            privacyExecutionHistory = [...privacyExecutionHistory, artifact].slice(-80);
            discomboDebug.info("privacy_commitment_created", {
                intentId,
                phase,
                stage,
                commitmentId: artifact.commitment.commitmentId,
                policyReceiptId: artifact.policyReceipt.receiptId,
                decision: artifact.policyReceipt.decision,
                disclosureHandle: artifact.disclosure.disclosureHandle,
                algorithm: artifact.disclosure.algorithm,
                zkEligibility: artifact.zkEligibility?.available ? "proven" : artifact.zkEligibility ? "skipped" : "n/a",
            });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 180));
        const durationMs = Date.now() - startedAt;

        discomboDebug.info("privacy_stage_completed", {
            phase,
            stage,
            privacyWrapperMode,
            policy: policy.descriptor,
            durationMs,
            commitmentId: artifact?.commitment.commitmentId ?? null,
        });
        if (intentId) {
            addSppStageReceipt(
                intentId,
                stageLabel,
                "completed",
                {
                    phase,
                    mode: privacyWrapperMode,
                    policy: policy.descriptor,
                    policyReceiptId: aspPolicyReceipt.receiptId,
                    aspDecision: aspPolicyReceipt.decision,
                    aspAuditLevel: aspPolicyReceipt.auditLevel,
                    commitmentId: artifact?.commitment.commitmentId ?? null,
                    disclosureHandle: artifact?.disclosure.disclosureHandle ?? null,
                    disclosureAlgorithm: artifact?.disclosure.algorithm ?? null,
                },
                durationMs,
            );
        }
    }

    function persistPrivacyWrapperMode(
        nextMode: PrivacyWrapperMode,
        source: string,
    ): void {
        try {
            localStorage.setItem(PRIVACY_WRAPPER_MODE_STORAGE_KEY, nextMode);
            discomboDebug.debug("privacy_wrapper_mode_persisted", {
                nextMode,
                source,
            });
        } catch (e) {
            discomboDebug.warn("privacy_wrapper_mode_persist_failed", {
                nextMode,
                source,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    function setPrivacyWrapperModeTracked(
        nextMode: PrivacyWrapperMode,
        reason: string,
        context: Record<string, unknown> = {},
    ): void {
        const previousMode = privacyWrapperMode;
        privacyWrapperMode = nextMode;
        discomboDebug.transition(
            "privacy_wrapper_mode",
            previousMode,
            nextMode,
            {
                reason,
                ...context,
            },
        );
        persistPrivacyWrapperMode(nextMode, reason);
    }

    function logPrivacyEnvelopeContext(phase: PrivacyPhase): void {
        const policy = getPrivacyPolicy(privacyWrapperMode);
        discomboDebug.info("privacy_wrapper_context", {
            phase,
            privacyWrapperMode,
            summary: getPrivacyWrapperSummary(privacyWrapperMode, phase),
            policy: policy.descriptor,
            preEnabled: policy.preEnabled,
            postEnabled: policy.postEnabled,
            settlementMode: "public",
            executor: "mainnet_safe_commitment_executor",
        });
    }

    function getDebugSnapshot(): DiscombobulatorSnapshot {
        const privacyPolicy = getPrivacyPolicy(privacyWrapperMode);
        const lastSppTrace =
            sppTraceHistory.length > 0
                ? sppTraceHistory[sppTraceHistory.length - 1]
                : null;
        const lastPrivacyArtifact =
            privacyExecutionHistory.length > 0
                ? privacyExecutionHistory[privacyExecutionHistory.length - 1]
                : null;
        const lastPolicyReceipt =
            aspPolicyHistory.length > 0
                ? aspPolicyHistory[aspPolicyHistory.length - 1]
                : null;
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
            receiveToken,
            receiveAmount,
            receiveRequestVisibility,
            receiveWatchActive,
            receiveWatchFulfilled,
            receiveWatchToken,
            receiveWatchTarget: formatTokenAmount(receiveWatchTargetStroops),
            receiveWatchReceived: formatTokenAmount(receiveWatchDeltaStroops),
            hasQuote: !!quote,
            statusMessage,
            hasTurnstileToken: !!turnstileToken,
            turnstileFailed,
            isAuthenticated,
            privacyWrapperMode,
            privacyPolicyDescriptor: privacyPolicy.descriptor,
            privacyPolicyPreEnabled: privacyPolicy.preEnabled,
            privacyPolicyPostEnabled: privacyPolicy.postEnabled,
            sppTraceCount: sppTraceHistory.length,
            sppActiveIntentId: activeSppIntentId ?? "",
            sppLastIntentId: lastSppTrace?.intentId ?? "",
            sppLastIntentStatus: lastSppTrace?.status ?? "",
            privacyArtifactCount: privacyExecutionHistory.length,
            privacyLastCommitmentId:
                lastPrivacyArtifact?.commitment.commitmentId ?? "",
            privacyLastPolicyDecision: lastPolicyReceipt?.decision ?? "",
            privacyLastDisclosureHandle:
                lastPrivacyArtifact?.disclosure.disclosureHandle ?? "",
            privacyLastSettlementState:
                lastPrivacyArtifact?.settlement.settlementState ?? "",
            privacyLastSettlementTxHash:
                lastPrivacyArtifact?.settlement.txHash ?? "",
            zkEligibilityStatus: lastPrivacyArtifact?.zkEligibility?.available === true
                ? "proven"
                : lastPrivacyArtifact?.zkEligibility?.available === false
                  ? "skipped"
                  : "n/a",
            zkEligibilityLocallyVerified: lastPrivacyArtifact?.zkEligibility?.available === true
                ? lastPrivacyArtifact.zkEligibility.locallyVerified
                : null,
            zkEligibilityThreshold: lastPrivacyArtifact?.zkEligibility?.threshold ?? "",
            zkEligibilityDurationMs: lastPrivacyArtifact?.zkEligibility?.durationMs ?? null,
            lowGpuMode,
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

    function getQuoteFailureStatus(error: unknown): string {
        const message = String(error instanceof Error ? error.message : error)
            .toLowerCase();

        if (message.includes("no path found") || message.includes("quote failed")) {
            if (lastEdited === "out") {
                return "No exact-out route. Try top input or a larger amount.";
            }
            return "No route for this pair/amount. Try another amount.";
        }

        if (message.includes("missing required parameters")) {
            return "Quote request invalid. Please retry.";
        }

        return "Route Unavailable";
    }

    function isDebugQueryEnabled(search: string): boolean {
        const params = new URLSearchParams(search);
        if (!params.has("debug")) return false;
        const raw = (params.get("debug") ?? "").trim().toLowerCase();
        if (!raw) return true;
        return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
    }

    // --- UTILS ---
    function formatBigInt(val: bigint | null, decimals = 7): string {
        if (val === null) return "...";
        const str = Number(val) / 10_000_000;
        return str.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function getTokenBalance(token: TokenSymbol): bigint | null {
        if (token === "XLM") return xlmBalance;
        if (token === "KALE") return kaleBalance;
        return usdcBalance;
    }

    function formatTokenAmount(stroops: bigint | null): string {
        if (stroops === null) return "0";
        const human = formatAmount(stroops);
        return human.replace(/\.?0+$/, "");
    }

    function normalizeOptionalTrimmed(
        value: string | null | undefined,
    ): string | null {
        const trimmed = (value ?? "").trim();
        return trimmed ? trimmed : null;
    }

    function bucketizeAmountForTelemetry(
        value: string | null | undefined,
    ): string | null {
        const trimmed = normalizeOptionalTrimmed(value);
        if (!trimmed) return null;

        const amount = Number.parseFloat(trimmed);
        if (!Number.isFinite(amount) || amount <= 0) return "invalid";
        if (amount < 0.01) return "<0.01";
        if (amount < 0.1) return "0.01-0.1";
        if (amount < 1) return "0.1-1";
        if (amount < 10) return "1-10";
        if (amount < 100) return "10-100";
        return "100+";
    }

    function getTelemetryAmountMeta(
        value: string | null | undefined,
        protect: boolean,
    ): {
        rawAmount: string | null;
        amountBucket: string | null;
        redacted: boolean;
    } {
        const trimmed = normalizeOptionalTrimmed(value);
        if (!trimmed) {
            return {
                rawAmount: null,
                amountBucket: null,
                redacted: false,
            };
        }

        return {
            rawAmount: protect ? null : trimmed,
            amountBucket: bucketizeAmountForTelemetry(trimmed),
            redacted: protect,
        };
    }

    function buildStandardReceiveRequestText(intentId?: string): string {
        const destination = userState.contractId ?? "";
        const amount = normalizeOptionalTrimmed(receiveAmount);
        const amountLabel = amount ? `${amount} ${receiveToken}` : receiveToken;
        const privacyLabel = getPrivacyWrapperLabel(privacyWrapperMode);
        const effectiveIntentId = intentId ?? activeSppIntentId ?? "none";
        const receiveArtifact = getLatestPrivacyArtifactForContext({
            phase: "receive",
            intentId,
        });
        const receivePolicyReceipt =
            receiveArtifact?.policyReceipt ??
            getLatestAspPolicyReceiptForPhase("receive");

        const lines = [
            "The Discombobulator receive request",
            `Destination: ${destination}`,
            `Requested: ${amountLabel}`,
            `SPP Mode (Labs): ${privacyLabel}`,
            `SPP Policy: ${getPrivacyPolicyDisplayName(privacyWrapperMode)}`,
            `SPP Intent: ${effectiveIntentId}`,
            "Settlement: public on-chain in the current Labs build.",
            "Note: Requested amount is advisory (sender can send any amount).",
        ];

        if (receivePolicyReceipt) {
            lines.push(`SPP Decision: ${receivePolicyReceipt.decision}`);
            lines.push(`SPP Audit: ${receivePolicyReceipt.auditLevel}`);
        }

        if (receiveArtifact) {
            lines.push(`SPP Commitment: ${receiveArtifact.commitment.commitmentId}`);
            lines.push(`SPP Disclosure: ${receiveArtifact.disclosure.disclosureHandle}`);
        }

        return lines.join("\n");
    }

    function buildProtectedReceiveRequestText(intentId?: string): string | null {
        const destination = userState.contractId ?? "";
        const amount = normalizeOptionalTrimmed(receiveAmount);
        const privacyLabel = getPrivacyWrapperLabel(privacyWrapperMode);
        const effectiveIntentId = intentId ?? activeSppIntentId ?? "none";
        const receiveArtifact = getLatestPrivacyArtifactForContext({
            phase: "receive",
            intentId,
        });
        const receivePolicyReceipt =
            receiveArtifact?.policyReceipt ??
            getLatestAspPolicyReceiptForPhase("receive");

        if (
            !receiveArtifact ||
            receiveArtifact.disclosure.algorithm !== "AES-GCM-256" ||
            !receiveArtifact.disclosure.ciphertext ||
            !receiveArtifact.disclosure.iv
        ) {
            return null;
        }

        const protectedPackage = {
            version: 1,
            kind: "discombobulator_receive_request",
            createdAt: new Date().toISOString(),
            public: {
                destination,
                token: receiveToken,
                requestedAmount: amount ? "protected" : null,
                settlement: "public_on_chain",
                advisoryOnly: true,
            },
            spp: {
                mode: privacyLabel,
                policy: getPrivacyPolicyDisplayName(privacyWrapperMode),
                intentId: effectiveIntentId,
                decision: receivePolicyReceipt?.decision ?? null,
                auditLevel: receivePolicyReceipt?.auditLevel ?? null,
                commitmentId: receiveArtifact.commitment.commitmentId,
                disclosureHandle: receiveArtifact.disclosure.disclosureHandle,
            },
            protected: {
                algorithm: receiveArtifact.disclosure.algorithm,
                ciphertext: receiveArtifact.disclosure.ciphertext,
                iv: receiveArtifact.disclosure.iv,
                keyFingerprint: receiveArtifact.disclosure.keyFingerprint,
                fullPayloadDigest: receiveArtifact.disclosure.fullPayloadDigest,
                createdAt: receiveArtifact.disclosure.createdAt,
            },
            guidance: {
                plaintextVisible: ["destination", "token", "spp references"],
                plaintextHidden: amount ? ["requestedAmount"] : [],
            },
        };

        return [
            "DISCOMBO_RECEIVE_REQUEST_V1",
            formatPrivacyJson(protectedPackage),
        ].join("\n");
    }

    function buildReceiveRequestText(intentId?: string): string {
        if (receiveProtectedRequestEnabled) {
            const protectedText = buildProtectedReceiveRequestText(intentId);
            if (protectedText) return protectedText;
        }

        return buildStandardReceiveRequestText(intentId);
    }

    async function copyTextToClipboard(value: string): Promise<boolean> {
        if (!value) return false;
        if (!navigator?.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(value);
        return true;
    }

    function formatPrivacyTimestamp(value: string | null | undefined): string {
        if (!value) return "--";
        try {
            return new Date(value).toLocaleString();
        } catch {
            return value;
        }
    }

    function getPhaseLabel(phase: PrivacyPhase): string {
        return phase.charAt(0).toUpperCase() + phase.slice(1);
    }

    function formatPrivacyJson(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return "{}";
        }
    }

    function getLatestPrivacyArtifactForContext({
        phase,
        intentId,
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
    } = {}): PrivacyExecutionArtifact | null {
        for (let index = privacyExecutionHistory.length - 1; index >= 0; index -= 1) {
            const artifact = privacyExecutionHistory[index];
            if (intentId && artifact.commitment.intentId !== intentId) continue;
            if (phase && artifact.commitment.phase !== phase) continue;
            return artifact;
        }
        return null;
    }

    function getLatestAspPolicyReceiptForPhase(
        phase?: PrivacyPhase,
    ): AspPolicyReceipt | null {
        for (let index = aspPolicyHistory.length - 1; index >= 0; index -= 1) {
            const receipt = aspPolicyHistory[index];
            if (phase && receipt.phase !== phase) continue;
            return receipt;
        }
        return null;
    }

    function getPrivacyReceiptSummaryForContext(
        phase?: PrivacyPhase,
    ): Record<string, unknown> | null {
        const artifact = getLatestPrivacyArtifactForContext({ phase });
        const policyReceipt =
            artifact?.policyReceipt ?? getLatestAspPolicyReceiptForPhase(phase);

        if (!artifact && !policyReceipt) {
            return null;
        }

        return {
            phase: artifact?.commitment.phase ?? policyReceipt?.phase ?? phase ?? null,
            stage: artifact?.commitment.stage ?? null,
            mode: artifact?.commitment.mode ?? policyReceipt?.mode ?? privacyWrapperMode,
            settlementMode: policyReceipt?.settlementMode ?? "public",
            policyId: policyReceipt?.policyId ?? null,
            receiptId: policyReceipt?.receiptId ?? null,
            decision: policyReceipt?.decision ?? null,
            auditLevel: policyReceipt?.auditLevel ?? null,
            riskScore: policyReceipt?.riskScore ?? null,
            reasons: policyReceipt?.reasons ?? [],
            commitmentId: artifact?.commitment.commitmentId ?? null,
            intentId: artifact?.commitment.intentId ?? null,
            disclosureHandle: artifact?.disclosure.disclosureHandle ?? null,
            algorithm: artifact?.disclosure.algorithm ?? null,
            keyFingerprint: artifact?.disclosure.keyFingerprint ?? null,
            summary: artifact?.disclosure.summary ?? null,
            settlementKind: artifact?.settlement.settlementKind ?? null,
            settlementState: artifact?.settlement.settlementState ?? null,
            settlementOperation: artifact?.settlement.operation ?? null,
            settlementTxHash: artifact?.settlement.txHash ?? null,
            settlementConfirmedAt: artifact?.settlement.confirmedAt ?? null,
            settlementNote: artifact?.settlement.note ?? null,
            settlementSoftSuccessReason:
                artifact?.settlement.softSuccessReason ?? null,
            checkedAt: policyReceipt?.checkedAt ?? null,
            createdAt:
                artifact?.commitment.createdAt ??
                artifact?.disclosure.createdAt ??
                null,
            receiptText: buildPrivacyReceiptTextForContext({ phase }),
        };
    }

    function buildPrivacyReceiptJsonForContext({
        phase,
        intentId,
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
    } = {}): string {
        const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
        const policyReceipt =
            artifact?.policyReceipt ?? getLatestAspPolicyReceiptForPhase(phase);

        return JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                privacyWrapperMode,
                settlementMode: policyReceipt?.settlementMode ?? "public",
                receipt: {
                    phase: artifact?.commitment.phase ?? policyReceipt?.phase ?? phase ?? null,
                    stage: artifact?.commitment.stage ?? null,
                    policyId: policyReceipt?.policyId ?? null,
                    receiptId: policyReceipt?.receiptId ?? null,
                    decision: policyReceipt?.decision ?? null,
                    auditLevel: policyReceipt?.auditLevel ?? null,
                    riskScore: policyReceipt?.riskScore ?? null,
                    reasons: policyReceipt?.reasons ?? [],
                    checkedAt: policyReceipt?.checkedAt ?? null,
                },
                settlement: artifact?.settlement ?? null,
                artifact,
            },
            null,
            2,
        );
    }

    function exportPrivacyReceiptForPhase(phase?: PrivacyPhase): string {
        return buildPrivacyReceiptTextForContext({ phase });
    }

    function findPrivacyArtifactForDebug(
        query:
            | string
            | {
                  phase?: PrivacyPhase;
                  stage?: ExecutorPrivacyEnvelopeStage;
                  decision?: "allow" | "allow_with_audit";
                  intentId?: string | null;
                  commitmentId?: string;
                  disclosureHandle?: string;
              },
    ):
        | {
              artifact: PrivacyExecutionArtifact;
              receipt: Record<string, unknown> | null;
          }
        | null {
        const matchString =
            typeof query === "string" ? query.trim().toLowerCase() : null;

        for (let index = privacyExecutionHistory.length - 1; index >= 0; index -= 1) {
            const artifact = privacyExecutionHistory[index];
            if (matchString) {
                const haystacks = [
                    artifact.commitment.commitmentId,
                    artifact.commitment.intentId,
                    artifact.disclosure.disclosureHandle,
                    artifact.policyReceipt.receiptId,
                    artifact.policyReceipt.policyId,
                ]
                    .filter(Boolean)
                    .map((value) => String(value).toLowerCase());
                if (
                    !haystacks.some(
                        (value) => value === matchString || value.includes(matchString),
                    )
                ) {
                    continue;
                }
            } else {
                if (query.phase && artifact.commitment.phase !== query.phase) continue;
                if (query.stage && artifact.commitment.stage !== query.stage) continue;
                if (query.decision && artifact.policyReceipt.decision !== query.decision)
                    continue;
                if (query.intentId && artifact.commitment.intentId !== query.intentId)
                    continue;
                if (
                    query.commitmentId &&
                    artifact.commitment.commitmentId !== query.commitmentId
                )
                    continue;
                if (
                    query.disclosureHandle &&
                    artifact.disclosure.disclosureHandle !== query.disclosureHandle
                )
                    continue;
            }

            return {
                artifact,
                receipt: getPrivacyReceiptSummaryForContext(artifact.commitment.phase),
            };
        }

        return null;
    }

    function buildPrivacyReceiptTextForContext({
        phase,
        intentId,
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
    } = {}): string {
        const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
        const policyReceipt =
            artifact?.policyReceipt ?? getLatestAspPolicyReceiptForPhase(phase);

        if (!policyReceipt && !artifact) {
            return "No SPP receipt generated yet.";
        }

        const lines = [
            "Discombobulator SPP receipt",
            `Mode: ${getPrivacyWrapperLabel(privacyWrapperMode)}`,
            `Settlement: ${policyReceipt?.settlementMode ?? "public"}`,
            `Settlement kind: ${artifact?.settlement.settlementKind ?? "n/a"}`,
            `Settlement state: ${artifact?.settlement.settlementState ?? "n/a"}`,
            `Settlement operation: ${artifact?.settlement.operation ?? "n/a"}`,
            `Settlement tx hash: ${artifact?.settlement.txHash ?? "n/a"}`,
            `Settlement network: ${artifact?.settlement.networkPassphrase ?? "n/a"}`,
            `Settlement relayer: ${artifact?.settlement.relayerMode ?? "n/a"}`,
            `Policy ID: ${policyReceipt?.policyId ?? "n/a"}`,
            `Decision: ${policyReceipt?.decision ?? "n/a"}`,
            `Audit: ${policyReceipt?.auditLevel ?? "n/a"}`,
            `Risk score: ${policyReceipt?.riskScore ?? "n/a"}`,
            `Phase: ${artifact?.commitment.phase ?? policyReceipt?.phase ?? "n/a"}`,
            `Stage: ${artifact?.commitment.stage ?? "n/a"}`,
            `Commitment: ${artifact?.commitment.commitmentId ?? "n/a"}`,
            `Disclosure: ${artifact?.disclosure.disclosureHandle ?? "n/a"}`,
            `Summary: ${artifact?.disclosure.summary ?? "n/a"}`,
            `Checked: ${formatPrivacyTimestamp(policyReceipt?.checkedAt)}`,
            `Created: ${formatPrivacyTimestamp(artifact?.commitment.createdAt)}`,
            `Confirmed: ${formatPrivacyTimestamp(artifact?.settlement.confirmedAt)}`,
        ];

        if (policyReceipt?.reasons?.length) {
            lines.push(
                `Reasons: ${policyReceipt.reasons.join("; ")}`,
            );
        }

        if (artifact?.settlement.note) {
            lines.push(`Settlement note: ${artifact.settlement.note}`);
        }

        return lines.join("\n");
    }

    function buildPrivacyReceiptText(): string {
        return buildPrivacyReceiptTextForContext();
    }

    function buildSettlementEvidenceJsonForContext({
        phase,
        intentId,
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
    } = {}): string {
        const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
        if (!artifact) {
            return JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    error: "No settlement evidence available yet.",
                },
                null,
                2,
            );
        }

        return JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                privacyWrapperMode,
                phase: artifact.commitment.phase,
                stage: artifact.commitment.stage,
                receiptId: artifact.policyReceipt.receiptId,
                policyId: artifact.policyReceipt.policyId,
                decision: artifact.policyReceipt.decision,
                auditLevel: artifact.policyReceipt.auditLevel,
                commitmentId: artifact.commitment.commitmentId,
                intentId: artifact.commitment.intentId,
                disclosureHandle: artifact.disclosure.disclosureHandle,
                settlement: artifact.settlement,
            },
            null,
            2,
        );
    }

    async function copySettlementTxHashForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("Settlement tx hash copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
            const txHash = artifact?.settlement.txHash?.trim();
            if (!txHash) throw new Error("No confirmed tx hash available");
            const copied = await copyTextToClipboard(txHash);
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_settlement_tx_hash_copied",
                { privacyWrapperMode, phase: phase ?? null, txHash },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_settlement_tx_hash_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy settlement tx hash",
                "privacy_settlement_tx_hash_copy_failed",
            );
        }
    }

    async function copySettlementEvidenceJsonForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("Settlement evidence copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const copied = await copyTextToClipboard(
                buildSettlementEvidenceJsonForContext({ phase, intentId }),
            );
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_settlement_evidence_copied",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_settlement_evidence_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy settlement evidence",
                "privacy_settlement_evidence_copy_failed",
            );
        }
    }

    function downloadSettlementEvidenceJsonForContext({
        phase,
        intentId,
        filenamePrefix = "discombo-settlement-evidence",
        successMessage = withPrivacyModeSuffix("Settlement evidence downloaded"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        filenamePrefix?: string;
        successMessage?: string;
    } = {}): void {
        try {
            const evidenceJson = buildSettlementEvidenceJsonForContext({ phase, intentId });
            const blob = new Blob([evidenceJson], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${filenamePrefix}-${Date.now()}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatusMessageTracked(
                successMessage,
                "privacy_settlement_evidence_downloaded",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_settlement_evidence_download_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not download settlement evidence",
                "privacy_settlement_evidence_download_failed",
            );
        }
    }

    async function copyPrivacyReceiptForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("SPP receipt copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const copied = await copyTextToClipboard(
                buildPrivacyReceiptTextForContext({ phase, intentId }),
            );
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_receipt_copied",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_receipt_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy SPP receipt",
                "privacy_receipt_copy_failed",
            );
        }
    }

    async function copyLatestPrivacyReceipt(): Promise<void> {
        await copyPrivacyReceiptForContext();
    }

    async function copyPrivacyExport(): Promise<void> {
        try {
            const copied = await copyTextToClipboard(exportPrivacyArtifacts());
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                withPrivacyModeSuffix("SPP export copied"),
                "privacy_export_copied",
                { privacyWrapperMode },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_export_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy SPP export",
                "privacy_export_copy_failed",
            );
        }
    }

    async function copyDisclosurePreviewForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("Disclosure preview copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
            if (!artifact) throw new Error("No disclosure artifact available");
            const copied = await copyTextToClipboard(
                formatPrivacyJson(artifact.disclosure.redactedPayload),
            );
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_disclosure_preview_copied",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_disclosure_preview_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy disclosure preview",
                "privacy_disclosure_preview_copy_failed",
            );
        }
    }

    async function copyDisclosureDigestForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("Disclosure digest copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const artifact = getLatestPrivacyArtifactForContext({ phase, intentId });
            if (!artifact) throw new Error("No disclosure artifact available");
            const copied = await copyTextToClipboard(
                artifact.disclosure.fullPayloadDigest,
            );
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_disclosure_digest_copied",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_disclosure_digest_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy disclosure digest",
                "privacy_disclosure_digest_copy_failed",
            );
        }
    }

    async function copyPrivacyReceiptJsonForContext({
        phase,
        intentId,
        successMessage = withPrivacyModeSuffix("SPP receipt JSON copied"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        successMessage?: string;
    } = {}): Promise<void> {
        try {
            const copied = await copyTextToClipboard(
                buildPrivacyReceiptJsonForContext({ phase, intentId }),
            );
            if (!copied) throw new Error("Clipboard unavailable");
            setStatusMessageTracked(
                successMessage,
                "privacy_receipt_json_copied",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_receipt_json_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy SPP receipt JSON",
                "privacy_receipt_json_copy_failed",
            );
        }
    }

    function downloadPrivacyReceiptForContext({
        phase,
        intentId,
        filenamePrefix = "discombo-spp-receipt",
        successMessage = withPrivacyModeSuffix("SPP receipt downloaded"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        filenamePrefix?: string;
        successMessage?: string;
    } = {}): void {
        try {
            const receipt = buildPrivacyReceiptTextForContext({ phase, intentId });
            const blob = new Blob([receipt], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${filenamePrefix}-${Date.now()}.txt`;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatusMessageTracked(
                successMessage,
                "privacy_receipt_downloaded",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_receipt_download_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not download SPP receipt",
                "privacy_receipt_download_failed",
            );
        }
    }

    function downloadLatestPrivacyReceipt(): void {
        downloadPrivacyReceiptForContext();
    }

    function downloadPrivacyReceiptJsonForContext({
        phase,
        intentId,
        filenamePrefix = "discombo-spp-receipt",
        successMessage = withPrivacyModeSuffix("SPP receipt JSON downloaded"),
    }: {
        phase?: PrivacyPhase;
        intentId?: string | null;
        filenamePrefix?: string;
        successMessage?: string;
    } = {}): void {
        try {
            const receiptJson = buildPrivacyReceiptJsonForContext({ phase, intentId });
            const blob = new Blob([receiptJson], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${filenamePrefix}-${Date.now()}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatusMessageTracked(
                successMessage,
                "privacy_receipt_json_downloaded",
                { privacyWrapperMode, phase: phase ?? null },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_receipt_json_download_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not download SPP receipt JSON",
                "privacy_receipt_json_download_failed",
            );
        }
    }

    function downloadPrivacyExport(): void {
        try {
            const json = exportPrivacyArtifacts();
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `discombo-spp-${Date.now()}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatusMessageTracked(
                withPrivacyModeSuffix("SPP export downloaded"),
                "privacy_export_downloaded",
                { privacyWrapperMode },
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("privacy_export_download_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not download SPP export",
                "privacy_export_download_failed",
            );
        }
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
        if (lowGpuMode) {
            discomboDebug.debug("confetti_skipped", { reason: "low_gpu_mode" });
            return;
        }
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
        const params = new URLSearchParams(window.location.search);
        debugQueryEnabled = isDebugQueryEnabled(window.location.search);
        const gpuParam = (params.get("gpu") ?? "").trim().toLowerCase();
        lowGpuMode =
            debugQueryEnabled || gpuParam === "lite" || gpuParam === "safe";

        const requestedPrivacyMode = params.get("privacy");
        const parsedPrivacyMode = parsePrivacyWrapperMode(requestedPrivacyMode);
        let persistedPrivacyModeRaw: string | null = null;
        let persistedPrivacyMode: PrivacyWrapperMode | null = null;

        try {
            persistedPrivacyModeRaw = localStorage.getItem(
                PRIVACY_WRAPPER_MODE_STORAGE_KEY,
            );
            persistedPrivacyMode = parsePrivacyWrapperMode(
                persistedPrivacyModeRaw,
            );
        } catch {
            persistedPrivacyModeRaw = null;
            persistedPrivacyMode = null;
        }

        if (parsedPrivacyMode) {
            privacyWrapperMode = parsedPrivacyMode;
        } else if (persistedPrivacyMode) {
            privacyWrapperMode = persistedPrivacyMode;
        }

        discomboDebug = bootstrapDiscombobulatorDebug({
            getSnapshot: getDebugSnapshot,
            hostname: window.location.hostname,
            relayerMode: isDirectRelayer ? "DIRECT" : "PROXY",
            forceTrace: debugQueryEnabled,
            debugQueryEnabled,
            getSppTrace: getSppTrace,
            exportSppTrace: exportSppTrace,
            clearSppTrace: clearSppTrace,
            getPrivacyArtifacts: getPrivacyArtifacts,
            exportPrivacyArtifacts: exportPrivacyArtifacts,
            clearPrivacyArtifacts: clearPrivacyArtifacts,
            getPrivacyReceipt: getPrivacyReceiptSummaryForContext,
            exportPrivacyReceipt: exportPrivacyReceiptForPhase,
            findPrivacyArtifact: findPrivacyArtifactForDebug,
            getSppResearchModel: getSppResearchModel,
        });

        discomboDebug.info("component_mounted", {
            hasApiKey,
            isDirectRelayer,
            debugQueryEnabled,
            lowGpuMode,
            privacyWrapperMode,
            networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
            relayerUrl: import.meta.env.PUBLIC_RELAYER_URL || "N/A",
            turnstileSiteKeyConfigured: !!import.meta.env
                .PUBLIC_TURNSTILE_SITE_KEY,
        });

        if (requestedPrivacyMode && !parsedPrivacyMode) {
            discomboDebug.warn("privacy_wrapper_url_param_ignored", {
                requestedPrivacyMode,
            });
        } else if (parsedPrivacyMode) {
            persistPrivacyWrapperMode(parsedPrivacyMode, "url_param");
            discomboDebug.info("privacy_wrapper_seeded_from_url", {
                requestedPrivacyMode,
                parsedPrivacyMode,
            });
        } else if (persistedPrivacyModeRaw && !persistedPrivacyMode) {
            discomboDebug.warn("privacy_wrapper_storage_value_ignored", {
                persistedPrivacyModeRaw,
            });
        } else if (persistedPrivacyMode) {
            discomboDebug.info("privacy_wrapper_seeded_from_storage", {
                persistedPrivacyModeRaw,
                persistedPrivacyMode,
            });
        }

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
        evaluateReceiveWatchProgress();
    }

    function startReceiveWatch(): void {
        if (!userState.contractId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "receive_watch_missing_wallet",
            );
            return;
        }

        const amountRaw = receiveAmount.trim();
        if (!amountRaw || parseFloat(amountRaw) <= 0) {
            setStatusMessageTracked(
                "Enter requested amount first",
                "receive_watch_invalid_amount",
            );
            return;
        }

        const baseline = getTokenBalance(receiveToken);
        if (baseline === null) {
            setStatusMessageTracked(
                "Balance unavailable. Refresh and retry.",
                "receive_watch_missing_balance",
            );
            return;
        }

        const targetStroops = BigInt(toStroops(amountRaw));
        if (targetStroops <= 0n) {
            setStatusMessageTracked(
                "Requested amount must be greater than zero",
                "receive_watch_non_positive_amount",
            );
            return;
        }

        receiveWatchActive = true;
        receiveWatchFulfilled = false;
        receiveWatchToken = receiveToken;
        receiveWatchBaselineStroops = baseline;
        receiveWatchTargetStroops = targetStroops;
        receiveWatchDeltaStroops = 0n;

        discomboDebug.info("receive_watch_started", {
            token: receiveWatchToken,
            requestedAmount: amountRaw,
            baseline: baseline.toString(),
            targetStroops: targetStroops.toString(),
        });
        setStatusMessageTracked(
            `Watching for +${amountRaw} ${receiveToken}...`,
            "receive_watch_started",
        );
    }

    function stopReceiveWatch(reason = "receive_watch_stopped"): void {
        receiveWatchActive = false;
        receiveWatchFulfilled = false;
        receiveWatchBaselineStroops = null;
        receiveWatchTargetStroops = null;
        receiveWatchDeltaStroops = null;
        discomboDebug.debug(reason, { token: receiveWatchToken });
    }

    function evaluateReceiveWatchProgress(): void {
        if (
            !receiveWatchActive ||
            receiveWatchFulfilled ||
            receiveWatchBaselineStroops === null ||
            receiveWatchTargetStroops === null
        ) {
            return;
        }

        const current = getTokenBalance(receiveWatchToken);
        if (current === null) return;

        const delta = current - receiveWatchBaselineStroops;
        receiveWatchDeltaStroops = delta > 0n ? delta : 0n;

        if (delta >= receiveWatchTargetStroops) {
            receiveWatchFulfilled = true;
            discomboDebug.info("receive_watch_fulfilled", {
                token: receiveWatchToken,
                targetStroops: receiveWatchTargetStroops.toString(),
                deltaStroops: (delta > 0n ? delta : 0n).toString(),
            });
            setStatusMessageTracked(
                `Requested amount received for ${receiveWatchToken}`,
                "receive_watch_fulfilled",
            );
        } else {
            discomboDebug.trace("receive_watch_progress", {
                token: receiveWatchToken,
                targetStroops: receiveWatchTargetStroops.toString(),
                deltaStroops: (delta > 0n ? delta : 0n).toString(),
            });
        }
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
                const quoteFailureStatus = getQuoteFailureStatus(e);
                discomboDebug.error("quote_failed", {
                    error: e instanceof Error ? e.message : String(e),
                    swapInToken,
                    swapOutToken,
                    swapAmount,
                    swapOutputAmount,
                    quoteFailureStatus,
                });
                setSwapStateTracked("simulated_error", "quote_simulation_failed");
                setStatusMessageTracked(quoteFailureStatus, "quote_error");
            }
        }, 500);
    }

    // --- ACTIONS ---
    async function handleAction() {
        if (!userState.contractId || (mode !== "receive" && !userState.keyId)) {
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
            privacyWrapperMode,
            lowGpuMode,
        });

        if (mode === "swap") {
            await executeSwap();
        } else if (mode === "send") {
            await executeSend();
        } else if (mode === "receive") {
            await executeReceive();
        }
        // pool mode has its own controls (poolAddEntry / poolSubmitAll)
    }

    async function executeSwap() {
        if (!quote || !userState.contractId || !userState.keyId) {
            setStatusMessageTracked("No quote available", "missing_quote_or_auth");
            return;
        }

        logPrivacyEnvelopeContext("swap");

        const useFallback = turnstileFailed && !turnstileToken;
        if (!turnstileToken && !useFallback && !isDirectRelayer) {
            setStatusMessageTracked(
                "Complete verification first",
                "turnstile_required",
            );
            return;
        }

        let intentId: string | null = null;
        let aspPolicyReceipt: AspPolicyReceipt | null = null;
        const swapIntentPayload = {
            swapInToken,
            swapOutToken,
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            tradeType: quote.tradeType,
            routeHops: quote.routePlan?.length ?? 0,
        };
        const swapIntent = await startSppIntent("swap", {
            ...swapIntentPayload,
        });
        intentId = swapIntent.trace.intentId;
        aspPolicyReceipt = swapIntent.aspPolicyReceipt;

        setSwapStateTracked("awaiting_passkey", "swap_building_started");
        await runPrivacyEnvelopeStageIfEnabled(
            "swap",
            "pre",
            swapIntentPayload,
            aspPolicyReceipt,
            intentId,
        );
        addSppStageReceipt(intentId, "action", "started", {
            phase: "swap",
            operation: "swap_transaction",
            policyReceiptId: aspPolicyReceipt.receiptId,
            aspDecision: aspPolicyReceipt.decision,
        });
        setStatusMessageTracked(
            getSwapStatusMessage(privacyWrapperMode, "building"),
            "swap_building_started",
            { privacyWrapperMode },
        );
        discomboDebug.info("swap_flow_started", {
            contractId: maskIdentifier(userState.contractId),
            keyId: maskIdentifier(userState.keyId),
            swapInToken,
            swapOutToken,
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            useFallback,
            hasTurnstileToken: !!turnstileToken,
            privacyWrapperMode,
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
            setStatusMessageTracked(
                getSwapStatusMessage(privacyWrapperMode, "submitting"),
                "swap_sign_and_submit",
                { privacyWrapperMode },
            );

            const sendResult = await signSendAndVerify(tx, {
                keyId: userState.keyId,
                turnstileToken,
                // Keep one refresh path to avoid duplicate balance spam.
                updateBalance: false,
                contractId: userState.contractId,
                onProgress: (message, meta) => {
                    setStatusMessageTracked(message, "swap_progress_update", {
                        stage: meta?.stage ?? "unknown",
                    });
                    discomboDebug.debug("swap_progress_update", {
                        message,
                        ...(meta ?? {}),
                    });
                },
            });

            if (!sendResult.success) {
                throw new Error(sendResult.error || "Swap submission failed");
            }

            txHash = sendResult.transactionHash ?? null;
            await runPrivacyEnvelopeStageIfEnabled(
                "swap",
                "post",
                swapIntentPayload,
                aspPolicyReceipt,
                intentId,
            );
            bindPrivacySettlementForIntent(intentId, {
                txHash: txHash ?? null,
                confirmedAt: txHash ? new Date().toISOString() : null,
                softSuccessReason: sendResult.softSuccessReason ?? null,
                note: txHash
                    ? "Bound to confirmed public mainnet swap transaction."
                    : sendResult.softSuccessReason === "duplicate_nonce"
                      ? "Duplicate nonce replay prevented; swap completion was treated as soft success without a confirmed tx hash."
                      : null,
            });
            addSppStageReceipt(intentId, "action", "completed", {
                phase: "swap",
                operation: "swap_transaction",
                txHash: txHash ?? null,
                softSuccessReason: sendResult.softSuccessReason ?? null,
                policyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
            });
            completeSppIntent(intentId, "succeeded", {
                txHash: txHash ?? null,
            });
            setSwapStateTracked("confirmed", "swap_submission_succeeded");
            if (sendResult.softSuccessReason === "duplicate_nonce") {
                setStatusMessageTracked(
                    withPrivacyModeSuffix(
                        "Swap likely complete (duplicate nonce replay guarded).",
                    ),
                    "swap_submission_soft_success",
                    { privacyWrapperMode },
                );
                discomboDebug.warn("swap_flow_soft_success", {
                    reason: sendResult.softSuccessReason,
                });
            } else {
                setStatusMessageTracked(
                    getSwapStatusMessage(privacyWrapperMode, "success"),
                    "swap_submission_succeeded",
                    { privacyWrapperMode },
                );
            }
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
            if (intentId) {
                const finalError = e instanceof Error ? e.message : String(e);
                addSppStageReceipt(intentId, "action", "failed", {
                    phase: "swap",
                    operation: "swap_transaction",
                    error: finalError,
                    userCancelled: isUserCancellation(e),
                    policyReceiptId: aspPolicyReceipt?.receiptId ?? null,
                });
                completeSppIntent(intentId, "failed", { error: finalError });
            }
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

        logPrivacyEnvelopeContext("send");

        const recipient = sendTo.trim();
        const amountNum = parseFloat(sendAmount);
        if (!recipient || isNaN(amountNum) || amountNum <= 0) {
            setStatusMessageTracked(
                "Invalid recipient or amount",
                "send_input_invalid",
            );
            return;
        }

        try {
            validateAddress(recipient, "Recipient");
        } catch {
            setStatusMessageTracked(
                "Invalid recipient address (must be a valid G… or C… Stellar address)",
                "send_recipient_invalid",
            );
            return;
        }

        const amountInStroops = BigInt(toStroops(sendAmount));
        const useFallback = turnstileFailed && !turnstileToken;
        if (!turnstileToken && !useFallback && !isDirectRelayer) {
            setStatusMessageTracked(
                "Complete verification first",
                "turnstile_required",
            );
            return;
        }

        let intentId: string | null = null;
        let aspPolicyReceipt: AspPolicyReceipt | null = null;
        const sendTelemetryAmount = getTelemetryAmountMeta(
            sendAmount,
            privacyWrapperMode !== "public",
        );
        const sendIntentPayload = {
            sendToken,
            amount: sendAmount,
            recipientMasked: maskIdentifier(recipient),
            amountInStroops: amountInStroops.toString(),
            amountVisibility:
                privacyWrapperMode === "public" ? "plaintext" : "redacted",
        };
        const sendIntent = await startSppIntent("send", {
            ...sendIntentPayload,
        });
        intentId = sendIntent.trace.intentId;
        aspPolicyReceipt = sendIntent.aspPolicyReceipt;

        setSwapStateTracked("awaiting_passkey", "send_building_started");
        await runPrivacyEnvelopeStageIfEnabled(
            "send",
            "pre",
            sendIntentPayload,
            aspPolicyReceipt,
            intentId,
        );
        addSppStageReceipt(intentId, "action", "started", {
            phase: "send",
            operation: "token_transfer",
            token: sendToken,
            amount: sendAmount,
            policyReceiptId: aspPolicyReceipt.receiptId,
            aspDecision: aspPolicyReceipt.decision,
        });
        setStatusMessageTracked(
            withPrivacyModeSuffix(`Sending ${sendToken}...`),
            "send_building_started",
            { privacyWrapperMode },
        );
        discomboDebug.info("send_flow_started", {
            token: sendToken,
            amount: sendTelemetryAmount.rawAmount,
            amountBucket: sendTelemetryAmount.amountBucket,
            amountRedacted: sendTelemetryAmount.redacted,
            recipient: maskIdentifier(recipient),
            useFallback,
            hasTurnstileToken: !!turnstileToken,
            privacyWrapperMode,
        });

        try {
            let tx: any;
            const usePrivateRoute =
                privacyWrapperMode !== "public" &&
                isCAddress(userState.contractId);

            if (privacyWrapperMode !== "public" && !isCAddress(userState.contractId)) {
                // G-address wallets cannot use DEX-routed private send — warn the user.
                setStatusMessageTracked(
                    "Private send requires a smart wallet (C… address). Your G… address will send publicly.",
                    "send_g_address_private_warn",
                );
                // Still fall through to direct transfer below (usePrivateRoute = false).
            }

            if (usePrivateRoute) {
                // --- Private Send: route through DEX so output goes to recipient ---
                // sender loses sendToken, DEX pool mediates, recipient gets intermediary
                // (e.g. KALE→XLM: sender's KALE decreases, recipient's XLM increases)
                // No direct P2P token transfer appears on-chain.
                const routeLabel = getPrivateRouteLabel(sendToken as PrivateRouteTokenSymbol);
                setStatusMessageTracked(
                    `Private route: fetching ${routeLabel} quote...`,
                    "private_send_quoting",
                    { sendToken, privacyWrapperMode },
                );
                discomboDebug.info("private_send_route_started", {
                    sendToken,
                    routeLabel,
                    privacyWrapperMode,
                });

                const privateSendQuote = await getPrivateSendQuote({
                    sendToken: sendToken as PrivateRouteTokenSymbol,
                    amountStroops: amountInStroops,
                    recipientAddress: recipient,
                    fromAddress: userState.contractId,
                });

                setStatusMessageTracked(
                    `Private route: building ${routeLabel} tx...`,
                    "private_send_building",
                    { routeLabel, amountOut: privateSendQuote.amountOut },
                );

                const privateXdr = await buildPrivateSendTransaction(
                    privateSendQuote,
                    userState.contractId,
                    recipient,
                );
                tx = parsePrivateSendXdr(
                    privateXdr,
                    import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
                );

                discomboDebug.info("private_send_route_built", {
                    routeLabel,
                    amountIn: privateSendQuote.amountIn,
                    amountOut: privateSendQuote.amountOut,
                    tokenOut: privateSendQuote.tokenOutSymbol,
                    priceImpactPct: privateSendQuote.priceImpactPct,
                });
            } else {
                // --- Direct Transfer (public mode) ---
                let client;
                if (sendToken === "KALE") client = await kale.get();
                else if (sendToken === "USDC") client = await usdc.get();
                else client = await xlm.get();

                tx = await client.transfer({
                    from: userState.contractId,
                    to: recipient,
                    amount: amountInStroops,
                });
            }

            setSwapStateTracked("submitting", "send_sign_and_submit");
            setStatusMessageTracked(
                withPrivacyModeSuffix("Submitting transfer..."),
                "send_sign_and_submit",
                { privacyWrapperMode },
            );

            const sendResult = await signSendAndVerify(tx, {
                keyId: userState.keyId,
                turnstileToken,
                // Keep one refresh path to avoid duplicate balance spam.
                updateBalance: false,
                contractId: userState.contractId,
                onProgress: (message, meta) => {
                    setStatusMessageTracked(message, "send_progress_update", {
                        stage: meta?.stage ?? "unknown",
                    });
                    discomboDebug.debug("send_progress_update", {
                        message,
                        ...(meta ?? {}),
                    });
                },
            });

            if (!sendResult.success) {
                throw new Error(sendResult.error || "Transfer failed");
            }

            txHash = sendResult.transactionHash ?? null;
            await runPrivacyEnvelopeStageIfEnabled(
                "send",
                "post",
                sendIntentPayload,
                aspPolicyReceipt,
                intentId,
            );
            bindPrivacySettlementForIntent(intentId, {
                txHash: txHash ?? null,
                confirmedAt: txHash ? new Date().toISOString() : null,
                softSuccessReason: sendResult.softSuccessReason ?? null,
                note: txHash
                    ? "Bound to confirmed public mainnet token transfer."
                    : sendResult.softSuccessReason === "duplicate_nonce"
                      ? "Duplicate nonce replay prevented; transfer completion was treated as soft success without a confirmed tx hash."
                      : null,
            });
            addSppStageReceipt(intentId, "action", "completed", {
                phase: "send",
                operation: "token_transfer",
                txHash: txHash ?? null,
                token: sendToken,
                amount: sendAmount,
                softSuccessReason: sendResult.softSuccessReason ?? null,
                policyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
            });
            completeSppIntent(intentId, "succeeded", {
                txHash: txHash ?? null,
            });
            setSwapStateTracked("confirmed", "send_submission_succeeded");
            if (sendResult.softSuccessReason === "duplicate_nonce") {
                setStatusMessageTracked(
                    withPrivacyModeSuffix(
                        `${sendToken} transfer likely complete (duplicate nonce replay guarded).`,
                    ),
                    "send_submission_soft_success",
                    { privacyWrapperMode },
                );
                discomboDebug.warn("send_flow_soft_success", {
                    reason: sendResult.softSuccessReason,
                });
            } else {
                setStatusMessageTracked(
                    withPrivacyModeSuffix(`Sent ${amountNum} ${sendToken}!`),
                    "send_submission_succeeded",
                    { privacyWrapperMode },
                );
            }
            triggerSuccessConfetti();
            discomboDebug.info("send_flow_succeeded", {
                txHash,
                token: sendToken,
                amount: sendTelemetryAmount.rawAmount,
                amountBucket: sendTelemetryAmount.amountBucket,
                amountRedacted: sendTelemetryAmount.redacted,
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
            if (intentId) {
                const finalError = e instanceof Error ? e.message : String(e);
                addSppStageReceipt(intentId, "action", "failed", {
                    phase: "send",
                    operation: "token_transfer",
                    token: sendToken,
                    amount: sendAmount,
                    error: finalError,
                    userCancelled: isUserCancellation(e),
                    policyReceiptId: aspPolicyReceipt?.receiptId ?? null,
                });
                completeSppIntent(intentId, "failed", { error: finalError });
            }
            discomboDebug.error("send_flow_failed", {
                error: e instanceof Error ? e.message : String(e),
                userCancelled: isUserCancellation(e),
            });
            setStatusMessageTracked(errorMessage, "send_submission_failed");
            setSwapStateTracked("failed", "send_submission_failed");
            turnstileToken = "";
        }
    }

    type ReceiveActionResult = {
        success: boolean;
        error?: string;
    };

    async function runReceiveIntentAction(
        operation: ReceiveActionOperation,
        runner: (intentId: string) => Promise<ReceiveActionResult>,
    ): Promise<boolean> {
        logPrivacyEnvelopeContext("receive");

        let intentId: string | null = null;
        let aspPolicyReceipt: AspPolicyReceipt | null = null;
        try {
            const receiveIntentPayload = {
                receiveToken,
                requestedAmount: normalizeOptionalTrimmed(receiveAmount),
                requestVisibility: receiveProtectedRequestEnabled
                    ? "protected"
                    : "standard",
                destinationMasked: maskIdentifier(userState.contractId),
                operation,
            };
            const receiveIntent = await startSppIntent("receive", {
                ...receiveIntentPayload,
            });
            intentId = receiveIntent.trace.intentId;
            aspPolicyReceipt = receiveIntent.aspPolicyReceipt;

            discomboDebug.info("receive_flow_started", {
                operation,
                receiveToken,
                requestedAmount: receiveProtectedRequestEnabled
                    ? null
                    : normalizeOptionalTrimmed(receiveAmount),
                requestedAmountBucket: bucketizeAmountForTelemetry(receiveAmount),
                requestedAmountRedacted: receiveProtectedRequestEnabled,
                privacyWrapperMode,
            });

            await runPrivacyEnvelopeStageIfEnabled(
                "receive",
                "pre",
                receiveIntentPayload,
                aspPolicyReceipt,
                intentId,
            );
            addSppStageReceipt(intentId, "action", "started", {
                phase: "receive",
                operation,
                policyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
            });

            const result = await runner(intentId);
            if (!result.success) {
                throw new Error(result.error || `${operation} failed`);
            }

            addSppStageReceipt(intentId, "action", "completed", {
                phase: "receive",
                operation,
                policyReceiptId: aspPolicyReceipt.receiptId,
                aspDecision: aspPolicyReceipt.decision,
            });
            await runPrivacyEnvelopeStageIfEnabled(
                "receive",
                "post",
                receiveIntentPayload,
                aspPolicyReceipt,
                intentId,
            );
            completeSppIntent(intentId, "succeeded");

            discomboDebug.info("receive_flow_succeeded", {
                operation,
                intentId,
            });
            return true;
        } catch (e) {
            const finalError = e instanceof Error ? e.message : String(e);
            if (intentId) {
                addSppStageReceipt(intentId, "action", "failed", {
                    phase: "receive",
                    operation,
                    error: finalError,
                    policyReceiptId: aspPolicyReceipt?.receiptId ?? null,
                });
                completeSppIntent(intentId, "failed", { error: finalError });
            }
            discomboDebug.error("receive_flow_failed", {
                operation,
                error: finalError,
            });
            return false;
        }
    }

    async function copyReceiveAddressDirect(): Promise<ReceiveActionResult> {
        if (!userState.contractId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "receive_address_missing_wallet",
            );
            return { success: false, error: "Connect wallet first" };
        }

        try {
            const copied = await copyTextToClipboard(userState.contractId);
            if (!copied) throw new Error("Clipboard unavailable");
            discomboDebug.info("receive_address_copied", {
                contractId: maskIdentifier(userState.contractId),
            });
            setStatusMessageTracked(
                withPrivacyModeSuffix("Receive address copied"),
                "receive_address_copied",
                { privacyWrapperMode },
            );
            return { success: true };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("receive_address_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy address",
                "receive_address_copy_failed",
            );
            return { success: false, error: errorMessage };
        }
    }

    async function copyReceiveAddress(): Promise<void> {
        await runReceiveIntentAction("copy_address", async () =>
            copyReceiveAddressDirect(),
        );
    }

    async function copyReceiveRequestDirect(
        intentId?: string,
    ): Promise<ReceiveActionResult> {
        if (!userState.contractId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "receive_request_missing_wallet",
            );
            return { success: false, error: "Connect wallet first" };
        }

        try {
            const requestText = buildReceiveRequestText(intentId);
            const copied = await copyTextToClipboard(requestText);
            if (!copied) throw new Error("Clipboard unavailable");
            const requestAmountMeta = getTelemetryAmountMeta(
                receiveAmount,
                receiveProtectedRequestEnabled || privacyWrapperMode !== "public",
            );

            discomboDebug.info("receive_request_copied", {
                token: receiveToken,
                requestedAmount: requestAmountMeta.rawAmount,
                requestedAmountBucket: requestAmountMeta.amountBucket,
                requestedAmountRedacted: requestAmountMeta.redacted,
                hasRequestedAmount: !!normalizeOptionalTrimmed(receiveAmount),
                requestVisibility: receiveProtectedRequestEnabled
                    ? "protected"
                    : "standard",
                requestLength: requestText.length,
            });
            setStatusMessageTracked(
                withPrivacyModeSuffix("Receive request copied"),
                "receive_request_copied",
                { privacyWrapperMode },
            );
            return { success: true };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("receive_request_copy_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Could not copy request",
                "receive_request_copy_failed",
            );
            return { success: false, error: errorMessage };
        }
    }

    async function copyReceiveRequest(): Promise<void> {
        await runReceiveIntentAction("copy_request", async (intentId) =>
            copyReceiveRequestDirect(intentId),
        );
    }

    async function shareReceiveRequestDirect(
        intentId?: string,
    ): Promise<ReceiveActionResult> {
        if (!userState.contractId) {
            setStatusMessageTracked(
                "Connect wallet first",
                "receive_share_missing_wallet",
            );
            return { success: false, error: "Connect wallet first" };
        }
        if (typeof navigator === "undefined" || !navigator.share) {
            setStatusMessageTracked(
                "Share unavailable on this device",
                "receive_share_unavailable",
            );
            return { success: false, error: "Share unavailable on this device" };
        }

        try {
            const text = buildReceiveRequestText(intentId);
            const requestAmountMeta = getTelemetryAmountMeta(
                receiveAmount,
                receiveProtectedRequestEnabled || privacyWrapperMode !== "public",
            );
            await navigator.share({
                title: "Discombobulator Receive Request",
                text,
            });
            discomboDebug.info("receive_request_shared", {
                token: receiveToken,
                requestedAmount: requestAmountMeta.rawAmount,
                requestedAmountBucket: requestAmountMeta.amountBucket,
                requestedAmountRedacted: requestAmountMeta.redacted,
                requestVisibility: receiveProtectedRequestEnabled
                    ? "protected"
                    : "standard",
            });
            setStatusMessageTracked(
                withPrivacyModeSuffix("Request shared"),
                "receive_request_shared",
                { privacyWrapperMode },
            );
            return { success: true };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            discomboDebug.warn("receive_request_share_failed", {
                error: errorMessage,
            });
            setStatusMessageTracked(
                "Share cancelled or failed",
                "receive_request_share_failed",
            );
            return { success: false, error: errorMessage };
        }
    }

    async function shareReceiveRequest(): Promise<void> {
        await runReceiveIntentAction("share_request", async (intentId) =>
            shareReceiveRequestDirect(intentId),
        );
    }

    async function executeReceive(): Promise<void> {
        const succeeded = await runReceiveIntentAction("copy_request", async (intentId) =>
            copyReceiveRequestDirect(intentId),
        );
        if (!succeeded) return;
        setStatusMessageTracked(
            withPrivacyModeSuffix("Receive request ready"),
            "receive_request_ready",
            { privacyWrapperMode },
        );
    }

    // --- POOL MODE ---

    async function poolFetchQuote(): Promise<void> {
        const amount = parseFloat(poolSendAmount);
        const recipient = poolSendTo.trim();
        if (!recipient || !isFinite(amount) || amount <= 0) {
            poolSendQuote = null;
            poolSendQuoteError = "";
            return;
        }
        poolSendQuoting = true;
        poolSendQuoteError = "";
        try {
            const amountInStroops = BigInt(Math.floor(amount * 10_000_000));
            const q = await getPrivateSendQuote({
                sendToken: poolSendToken as PrivateRouteTokenSymbol,
                amountStroops: amountInStroops,
                recipientAddress: recipient,
                fromAddress: userState.contractId ?? "",
            });
            poolSendQuote = q;
        } catch (e) {
            poolSendQuoteError = e instanceof Error ? e.message : "Quote failed";
            poolSendQuote = null;
        } finally {
            poolSendQuoting = false;
        }
    }

    async function poolAddEntry(): Promise<void> {
        if (!userState.contractId) {
            poolStatusMessage = "Connect wallet first";
            return;
        }
        const amount = parseFloat(poolSendAmount);
        if (!isFinite(amount) || amount <= 0) {
            poolStatusMessage = "Enter an amount first";
            return;
        }

        // In addressed mode, recipient is required; in ticket mode, it's not.
        const recipient = poolSendTo.trim();
        if (poolMode === "addressed") {
            if (!recipient) {
                poolStatusMessage = "Fill in recipient and amount first";
                return;
            }
            try {
                validateAddress(recipient, "Recipient");
            } catch {
                poolStatusMessage = "Invalid recipient address (must be a valid G… or C… Stellar address)";
                return;
            }
        }

        poolStatusMessage = "Creating pool commitment...";
        lastCommitmentTicket = null;
        const addedAt = new Date().toISOString();

        // Create SPP intent and commitment receipt (pre-committed before settlement)
        const amountInStroops = BigInt(toStroops(poolSendAmount));
        const payload = {
            sendToken: poolSendToken,
            amount: poolSendAmount,
            recipientFull: poolMode === "addressed" ? recipient : null,
            recipientMasked: poolMode === "addressed" ? maskPoolRecipient(recipient) : "🎟 ticket",
            amountMasked: maskPoolAmount(String(amount), poolSendToken),
            poolOperation: poolMode === "addressed" ? "private_send" : "commitment_ticket",
        };
        const { trace: poolTrace, aspPolicyReceipt: poolAsp } = await startSppIntent("send", payload);
        await runPrivacyEnvelopeStageIfEnabled("send", "pre", payload, poolAsp, poolTrace.intentId);

        const entryId = await generatePoolEntryId("send", addedAt, null);
        const lastArtifact = getLatestPrivacyArtifactForContext({ phase: "send", intentId: poolTrace.intentId });

        // In ticket mode, generate the commitment key (ZK cash note)
        let ticketString: string | null = null;
        if (poolMode === "commitment_ticket") {
            try {
                poolStatusMessage = "Generating ZK commitment key...";
                const note = await generateCommitmentKey(
                    amountInStroops,
                    poolSendToken,
                    entryId,
                );
                ticketString = await serializeCommitmentKey(note);
                lastCommitmentTicket = ticketString;
                poolTicketCopied = false;
                discomboDebug.info("commitment_key_generated", {
                    entryId,
                    commitment: note.commitment.slice(0, 20) + "...",
                    tokenSymbol: note.tokenSymbol,
                    amountStroops: note.amountStroops,
                });
            } catch (e) {
                poolStatusMessage = `Commitment key generation failed: ${e instanceof Error ? e.message : String(e)}`;
                return;
            }
        }

        const entry: PrivatePoolEntry = {
            entryId,
            phase: "send",
            poolMode,
            sendToken: poolSendToken,
            recipientMasked: poolMode === "addressed" ? maskPoolRecipient(recipient) : "🎟 ticket",
            amountMasked: maskPoolAmount(String(amount), poolSendToken),
            routeLabel: getPrivateRouteLabel(poolSendToken as PrivateRouteTokenSymbol),
            commitmentId: lastArtifact?.commitment.commitmentId ?? null,
            intentId: poolTrace.intentId,
            commitmentKey: ticketString,
            status: "queued",
            addedAt,
            settledAt: null,
            txHash: null,
        };

        poolEntries = [...poolEntries, entry];
        poolSendAmount = "";
        poolSendTo = "";
        poolSendQuote = null;
        poolStatusMessage = poolMode === "commitment_ticket"
            ? `🎟 Commitment ticket ready — save it now!`
            : `Entry added (${getPoolDepthLabel(poolEntries)})`;
        discomboDebug.info("pool_entry_added", { entryId, phase: "send", commitmentId: entry.commitmentId, poolMode });
    }

    async function poolCopyTicket(): Promise<void> {
        if (!lastCommitmentTicket) return;
        try {
            await navigator.clipboard.writeText(lastCommitmentTicket);
            poolTicketCopied = true;
            setTimeout(() => { poolTicketCopied = false; }, 2000);
        } catch {
            poolStatusMessage = "Copy failed — please select and copy manually.";
        }
    }

    async function poolRedeemTicket(): Promise<void> {
        redeemError = "";
        redeemProofResult = null;
        const ticketRaw = redeemTicketInput.trim();
        const recipientRaw = redeemRecipientInput.trim();

        if (!ticketRaw) { redeemError = "Paste your commitment ticket first."; return; }
        if (!recipientRaw) { redeemError = "Enter a recipient Stellar address."; return; }

        try {
            validateAddress(recipientRaw, "Recipient");
        } catch {
            redeemError = "Invalid recipient address (must be a G… or C… Stellar address).";
            return;
        }

        redeemWorking = true;
        try {
            const note = await deserializeCommitmentKey(ticketRaw);
            const integrity = await verifyCommitmentKeyIntegrity(note);
            if (!integrity.valid) {
                redeemError = `Ticket integrity check failed: ${integrity.reason}`;
                redeemWorking = false;
                return;
            }
            const artifact = await generateWithdrawalProof(note, recipientRaw);
            redeemProofResult = summarizeWithdrawalProof(artifact);
            discomboDebug.info("withdrawal_proof_generated", {
                proofMode: artifact.proofMode,
                locallyVerified: artifact.locallyVerified,
                recipient: recipientRaw.slice(0, 8) + "...",
            });
        } catch (e) {
            redeemError = e instanceof Error ? e.message : String(e);
        } finally {
            redeemWorking = false;
        }
    }

    async function poolSubmitAll(): Promise<void> {
        if (!userState.contractId || !userState.keyId) {
            poolStatusMessage = "Connect wallet first";
            return;
        }
        const queued = poolEntries.filter((e) => e.status === "queued");
        if (queued.length === 0) {
            poolStatusMessage = "No queued entries to submit";
            return;
        }

        const useFallbackPool = turnstileFailed && !turnstileToken;
        if (!turnstileToken && !useFallbackPool && !isDirectRelayer) {
            poolStatusMessage = "Complete the verification check before submitting";
            return;
        }

        poolSubmitting = true;
        let submitted = 0;
        let failed = 0;

        for (const entry of queued) {
            poolStatusMessage = `Submitting entry ${submitted + failed + 1}/${queued.length}...`;
            try {
                // Re-build the private send transaction for this entry
                // We need the original details — since they're masked in the entry, we
                // look up from sppTraceHistory for the payload
                const trace = sppTraceHistory.find((t) => t.intentId === entry.intentId);
                if (!trace) throw new Error("Pool intent trace not found");

                const sendToken = String(trace.payload.sendToken) as PrivateRouteTokenSymbol;
                const amount = String(trace.payload.amount || "0");
                const amountInStroops = BigInt(Math.floor(parseFloat(amount) * 10_000_000));
                // Recipient is masked — we need it from the trace payload
                const recipientRaw = String(trace.payload.recipientMasked ?? "");

                // Since recipient is masked, we can't re-derive the full address.
                // Pool submission requires the user to have kept the recipient or
                // we need a secondary lookup. For this implementation we store the
                // recipient hash in the trace. If not available, skip with note.
                const recipientFull = String(trace.payload.recipientFull ?? "");
                if (!recipientFull) {
                    // Commitment-ticket mode: no recipient address at deposit time.
                    // This entry must be settled via the CommitmentPool Soroban contract's
                    // deposit() function using the commitment bytes in the ticket — NOT
                    // through the DEX private-send path which requires a recipient.
                    //
                    // The ticket string is in entry.commitmentKey. When the contract is
                    // deployed, the UI "Redeem Ticket" section drives the withdrawal flow
                    // (generateWithdrawalProof → submit withdraw() to CommitmentPool).
                    //
                    // Mark as "submitted" with a note so the user knows it's pending
                    // on-chain deposit via the commitment pool contract.
                    poolStatusMessage = `Entry ${entry.entryId.slice(-8)}: commitment ticket — deposit via contract when available`;
                    poolEntries = poolEntries.map((e) =>
                        e.entryId === entry.entryId
                            ? { ...e, status: "submitted" as const }
                            : e,
                    );
                    submitted++;
                    continue;
                }

                const q = await getPrivateSendQuote({
                    sendToken,
                    amountStroops: amountInStroops,
                    recipientAddress: recipientFull,
                    fromAddress: userState.contractId,
                });

                const privateXdr = await buildPrivateSendTransaction(
                    q,
                    userState.contractId,
                    recipientFull,
                );
                const privateTx = parsePrivateSendXdr(
                    privateXdr,
                    import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
                );

                const sendResult = await signSendAndVerify(privateTx, {
                    keyId: userState.keyId,
                    turnstileToken,
                    updateBalance: false,
                    contractId: userState.contractId,
                    onProgress: (message) => {
                        poolStatusMessage = message;
                    },
                });

                if (!sendResult.success) throw new Error(sendResult.error || "Pool submit failed");

                // Bind settlement
                if (entry.intentId) {
                    bindPrivacySettlementForIntent(entry.intentId, {
                        txHash: sendResult.transactionHash ?? null,
                        confirmedAt: sendResult.transactionHash ? new Date().toISOString() : null,
                        softSuccessReason: sendResult.softSuccessReason ?? null,
                    });
                    // Look up the correct ASP policy receipt for this entry's intent
                    // (not the latest one, which may belong to a different entry).
                    const entryReceiptId = String(trace.payload.aspPolicyReceiptId ?? "");
                    const entryPolicyReceipt =
                        aspPolicyHistory.find((r) => r.receiptId === entryReceiptId) ??
                        getLatestPrivacyArtifactForContext({ phase: "send", intentId: entry.intentId })?.policyReceipt ??
                        aspPolicyHistory[aspPolicyHistory.length - 1]!;
                    await runPrivacyEnvelopeStageIfEnabled(
                        "send",
                        "post",
                        trace.payload as Record<string, unknown>,
                        entryPolicyReceipt,
                        entry.intentId,
                    );
                    completeSppIntent(entry.intentId, "succeeded", {
                        txHash: sendResult.transactionHash ?? null,
                    });
                }

                poolEntries = poolEntries.map((e) =>
                    e.entryId === entry.entryId
                        ? {
                              ...e,
                              status: "confirmed" as const,
                              txHash: sendResult.transactionHash ?? null,
                              settledAt: new Date().toISOString(),
                          }
                        : e,
                );
                submitted++;
                discomboDebug.info("pool_entry_submitted", {
                    entryId: entry.entryId,
                    txHash: sendResult.transactionHash,
                });
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                poolEntries = poolEntries.map((en) =>
                    en.entryId === entry.entryId
                        ? { ...en, status: "failed" as const }
                        : en,
                );
                failed++;
                discomboDebug.error("pool_entry_failed", {
                    entryId: entry.entryId,
                    error: errMsg,
                });
            }
        }

        poolSubmitting = false;
        poolStatusMessage = `Pool submitted: ${submitted} confirmed, ${failed} failed`;
        refreshBalances();
        if (submitted > 0) triggerSuccessConfetti();
    }

    function poolClear(): void {
        poolEntries = [];
        poolSendAmount = "";
        poolSendTo = "";
        poolSendQuote = null;
        poolStatusMessage = "";
        discomboDebug.info("pool_cleared");
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

            <!-- DEBUG: Relayer Mode Indicator (subtle, debug mode only) -->
            {#if debugQueryEnabled}
            <div
                class="fixed bottom-0 right-0 p-2 text-[8px] bg-black/80 backdrop-blur border-t border-l border-lime-400/10 text-lime-400/50 font-mono z-[10000] text-right pointer-events-none opacity-40 hover:opacity-90 transition-opacity"
            >
                <div class="text-lime-400/30">RELAYER: {isDirectRelayer ? "DIRECT" : "PROXY"} · SPP: {getPrivacyWrapperLabel(privacyWrapperMode)}</div>
                <div class="text-lime-400/20">KEY: {hasApiKey ? "✓" : "✗"} · GPU: {lowGpuMode ? "LITE" : "FULL"} · window.discomboDebug.help()</div>
            </div>
            {/if}

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
                    <button
                        class="tab-btn"
                        class:active={mode === "receive"}
                        onclick={() =>
                            setModeTracked("receive", "tab_click_receive")}
                        >RECEIVE</button
                    >
                    <button
                        class="tab-btn relative"
                        class:active={mode === "pool"}
                        onclick={() =>
                            setModeTracked("pool", "tab_click_pool")}
                        >POOL{#if poolEntries.filter(e => e.status === "queued").length > 0}<span class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#7dd3fc]"></span>{/if}</button
                    >
                </div>

                <!-- SPP Collapsible Panel -->
                <div class="mx-6 mt-3">
                    <button
                        onclick={() => (showSppPanel = !showSppPanel)}
                        class="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.18em] text-[#334155] hover:text-[#4a6a8a] transition-colors py-1 w-full text-left"
                    >
                        <span class="text-[10px] leading-none">{showSppPanel ? '▾' : '▸'}</span>
                        <span>SPP Mainnet Mode</span>
                        {#if privacyWrapperMode !== "public"}
                            <span class="ml-1 rounded-full border border-[#7dd3fc]/25 px-1.5 py-0.5 text-[7px] text-[#7dd3fc]/60 font-normal normal-case tracking-normal">{getPrivacyWrapperLabel(privacyWrapperMode)}</span>
                        {/if}
                    </button>
                {#if showSppPanel}
                <div
                    class="rounded-xl border border-[#1e293b] bg-[#020617]/50 p-3 mt-1"
                >
                    <div
                        class="text-[8px] uppercase tracking-[0.2em] text-[#7dd3fc]"
                    >
                        SPP Mainnet Mode (Labs)
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2">
                        <button
                            class={`privacy-chip ${privacyWrapperMode === "public" ? "active" : ""}`}
                            onclick={() =>
                                setPrivacyWrapperModeTracked(
                                    "public",
                                    "privacy_chip_click",
                                )}
                        >
                            PUBLIC
                        </button>
                        <button
                            class={`privacy-chip ${privacyWrapperMode === "shield_before_swap" ? "active" : ""}`}
                            onclick={() =>
                                setPrivacyWrapperModeTracked(
                                    "shield_before_swap",
                                    "privacy_chip_click",
                                )}
                        >
                            BEFORE
                        </button>
                        <button
                            class={`privacy-chip ${privacyWrapperMode === "shield_after_swap" ? "active" : ""}`}
                            onclick={() =>
                                setPrivacyWrapperModeTracked(
                                    "shield_after_swap",
                                    "privacy_chip_click",
                                )}
                        >
                            AFTER
                        </button>
                        <button
                            class={`privacy-chip ${privacyWrapperMode === "wrap_around_swap" ? "active" : ""}`}
                            onclick={() =>
                                setPrivacyWrapperModeTracked(
                                    "wrap_around_swap",
                                    "privacy_chip_click",
                                )}
                        >
                            WRAP
                        </button>
                    </div>
                    <div class="mt-2 text-[9px] text-[#94a3b8]">
                        {getPrivacyWrapperSummary(privacyWrapperMode, mode)}
                    </div>
                    <div class="mt-1 text-[8px] text-[#7dd3fc]">
                        {getPrivacyPolicyLabel(privacyWrapperMode)}
                    </div>
                    <div
                        class="mt-2 rounded-lg border border-[#fbbf24]/30 bg-[#1f1300]/35 p-2"
                    >
                        <div
                            class="text-[8px] uppercase tracking-[0.18em] text-[#fbbf24]"
                        >
                            SPP Scope
                        </div>
                        <div class="mt-1 text-[8px] text-[#fde68a]">
                            {#if privacyWrapperMode === "public"}
                                Public mainnet settlement. No SPP envelopes.
                            {:else if privacyWrapperMode === "shield_before_swap"}
                                Pre-payment: ASP policy check → AES-GCM-256 commitment sealed → mainnet settlement.
                            {:else if privacyWrapperMode === "shield_after_swap"}
                                Post-payment: mainnet settlement → ASP policy check → AES-GCM-256 commitment sealed.
                            {:else}
                                Wrap: ASP policy → pre-commitment → mainnet settlement → post-commitment. Full envelope path.
                            {/if}
                        </div>
                        <div class="mt-1 text-[8px] text-[#94a3b8]">
                            Settlement tx hash is bound to each commitment receipt on mainnet.
                        </div>
                    </div>

                    <div
                        class="mt-2 rounded-lg border border-[#1e293b] bg-[#0b1120]/70 p-3"
                    >
                        <div
                            class="flex items-center justify-between gap-3 text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                        >
                            <span>Latest SPP Receipt</span>
                            <div class="flex items-center gap-2">
                                <span class="text-[#64748b]"
                                    >{privacyExecutionHistory.length} artifacts / {aspPolicyHistory.length}
                                    policies</span
                                >
                                <button
                                    class="rounded-md border border-[#1e293b] bg-[#0f172a]/50 px-2 py-1 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={() => (showPrivacyHistory = !showPrivacyHistory)}
                                >
                                    {showPrivacyHistory ? "Hide History" : "Show History"}
                                </button>
                            </div>
                        </div>

                        {#if latestAspPolicyReceipt || latestPrivacyArtifact}
                            <div class="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[#cbd5e1]">
                                <div>
                                    <span class="text-[#64748b]">Decision</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestAspPolicyReceipt?.decision ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Audit</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestAspPolicyReceipt?.auditLevel ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Commitment</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {maskIdentifier(
                                            latestPrivacyArtifact?.commitment.commitmentId,
                                        ) || "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Disclosure</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {maskIdentifier(
                                            latestPrivacyArtifact?.disclosure
                                                .disclosureHandle,
                                        ) || "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Phase</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestPrivacyArtifact?.commitment.phase ??
                                            latestAspPolicyReceipt?.phase ??
                                            "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Settlement</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestAspPolicyReceipt?.settlementMode ?? "public"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Settlement State</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestPrivacyArtifact?.settlement.settlementState ??
                                            "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Relayer</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {latestPrivacyArtifact?.settlement.relayerMode ??
                                            "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Tx Hash</span>
                                    <div class="mt-1 text-[#e2e8f0] break-all">
                                        {maskIdentifier(
                                            latestPrivacyArtifact?.settlement.txHash,
                                        ) || "n/a"}
                                    </div>
                                </div>
                            </div>

                            {#if latestPrivacyArtifact?.disclosure.summary}
                                <div class="mt-2 text-[8px] text-[#94a3b8]">
                                    {latestPrivacyArtifact.disclosure.summary}
                                </div>
                            {/if}

                            {#if latestAspPolicyReceipt?.reasons?.length}
                                <div class="mt-2 flex flex-wrap gap-1">
                                    {#each latestAspPolicyReceipt.reasons.slice(0, 3) as reason}
                                        <span
                                            class="rounded-md border border-[#1e293b] bg-[#0f172a]/70 px-2 py-1 text-[8px] text-[#94a3b8]"
                                        >
                                            {reason}
                                        </span>
                                    {/each}
                                </div>
                            {/if}

                            <div class="mt-3 grid grid-cols-3 gap-2">
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={copyLatestPrivacyReceipt}
                                >
                                    Copy Receipt
                                </button>
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={downloadLatestPrivacyReceipt}
                                >
                                    Download Receipt
                                </button>
                            </div>

                            <div class="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={copyPrivacyExport}
                                >
                                    Copy Export
                                </button>
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={downloadPrivacyExport}
                                >
                                    Download JSON
                                </button>
                            </div>
                            {#if latestPrivacyArtifact?.settlement.txHash}
                                <div class="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#0f172a]/80"
                                        onclick={() => copySettlementTxHashForContext()}
                                    >
                                        Copy Tx Hash
                                    </button>
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            downloadSettlementEvidenceJsonForContext({
                                                filenamePrefix:
                                                    "discombo-latest-settlement-evidence",
                                            })}
                                    >
                                        Download Settlement JSON
                                    </button>
                                </div>
                            {/if}
                        {:else}
                            <div class="mt-2 text-[8px] text-[#94a3b8]">
                                No SPP artifacts yet. Run a swap, send, or receive action to
                                generate mainnet-safe policy and commitment receipts.
                            </div>
                        {/if}

                        {#if showPrivacyHistory}
                            <div class="mt-3 border-t border-[#1e293b] pt-3">
                                <div
                                    class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                                >
                                    Recent SPP Audit Trail
                                </div>

                                <div class="mt-2 flex flex-wrap gap-2">
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryPhaseFilter === "all" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                                        onclick={() => (privacyHistoryPhaseFilter = "all")}
                                    >
                                        ALL PHASES
                                    </button>
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryPhaseFilter === "swap" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                                        onclick={() => (privacyHistoryPhaseFilter = "swap")}
                                    >
                                        SWAP
                                    </button>
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryPhaseFilter === "send" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                                        onclick={() => (privacyHistoryPhaseFilter = "send")}
                                    >
                                        SEND
                                    </button>
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryPhaseFilter === "receive" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                                        onclick={() => (privacyHistoryPhaseFilter = "receive")}
                                    >
                                        RECEIVE
                                    </button>
                                </div>

                                <div class="mt-2 flex flex-wrap gap-2">
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryDecisionFilter === "all" ? "border-[#fbbf24]/40 bg-[#1f1300]/70 text-[#fbbf24]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#fbbf24]/30 hover:text-[#fbbf24]"}`}
                                        onclick={() => (privacyHistoryDecisionFilter = "all")}
                                    >
                                        ALL DECISIONS
                                    </button>
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryDecisionFilter === "allow" ? "border-[#fbbf24]/40 bg-[#1f1300]/70 text-[#fbbf24]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#fbbf24]/30 hover:text-[#fbbf24]"}`}
                                        onclick={() => (privacyHistoryDecisionFilter = "allow")}
                                    >
                                        ALLOW
                                    </button>
                                    <button
                                        class={`rounded-md border px-2 py-1 text-[8px] transition-all ${privacyHistoryDecisionFilter === "allow_with_audit" ? "border-[#fbbf24]/40 bg-[#1f1300]/70 text-[#fbbf24]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#fbbf24]/30 hover:text-[#fbbf24]"}`}
                                        onclick={() =>
                                            (privacyHistoryDecisionFilter =
                                                "allow_with_audit")}
                                    >
                                        ALLOW_WITH_AUDIT
                                    </button>
                                </div>

                                {#if filteredPrivacyArtifacts.length > 0}
                                    <div class="mt-2 flex flex-col gap-2">
                                        {#each filteredPrivacyArtifacts as artifact}
                                            <div
                                                class="rounded-lg border border-[#1e293b] bg-[#0f172a]/40 p-2"
                                            >
                                                <div class="flex items-center justify-between gap-2">
                                                    <div class="text-[8px] text-[#e2e8f0]">
                                                        {getPhaseLabel(artifact.commitment.phase)}
                                                        · {artifact.commitment.stage}
                                                        · {artifact.policyReceipt.decision}
                                                    </div>
                                                    <button
                                                        class="rounded-md border border-[#1e293b] bg-[#020617]/60 px-2 py-1 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                                        onclick={() =>
                                                            copyPrivacyReceiptForContext({
                                                                phase: artifact.commitment.phase,
                                                                intentId:
                                                                    artifact.commitment.intentId,
                                                                successMessage:
                                                                    withPrivacyModeSuffix(
                                                                        `${getPhaseLabel(
                                                                            artifact.commitment.phase,
                                                                        )} receipt copied`,
                                                                    ),
                                                            })}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <div
                                                    class="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[#94a3b8]"
                                                >
                                                    <div>
                                                        Commitment:
                                                        {maskIdentifier(
                                                            artifact.commitment.commitmentId,
                                                        )}
                                                    </div>
                                                    <div>
                                                        Disclosure:
                                                        {maskIdentifier(
                                                            artifact.disclosure
                                                                .disclosureHandle,
                                                        )}
                                                    </div>
                                                    <div>
                                                        Audit: {artifact.policyReceipt.auditLevel}
                                                    </div>
                                                    <div>
                                                        Created:
                                                        {formatPrivacyTimestamp(
                                                            artifact.commitment.createdAt,
                                                        )}
                                                    </div>
                                                    <div>
                                                        State:
                                                        {artifact.settlement.settlementState}
                                                    </div>
                                                    <div>
                                                        Tx:
                                                        {maskIdentifier(
                                                            artifact.settlement.txHash,
                                                        ) || "n/a"}
                                                    </div>
                                                    <div>
                                                        ZK:
                                                        {#if artifact.zkEligibility?.available === true}
                                                            <span class="text-[#5eead4]">proven</span>
                                                        {:else if artifact.zkEligibility?.available === false}
                                                            <span class="text-[#fbbf24]">skipped</span>
                                                        {:else}
                                                            n/a
                                                        {/if}
                                                    </div>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <div class="mt-2 text-[8px] text-[#94a3b8]">
                                        No audit history matches the current filter.
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <DiscombobulatorSppResearchPanel />
                </div>
                {/if}
                </div>

                <div class="p-6 md:p-8 flex flex-col gap-6">
                    <!-- Phase Receipt Collapsible -->
                    <div class="border border-[#1e293b]/50 rounded-xl bg-[#0f172a]/20">
                        <button
                            onclick={() => (showPhaseReceiptPanel = !showPhaseReceiptPanel)}
                            class="flex items-center justify-between w-full px-3 py-2 text-[8px] uppercase tracking-[0.18em] text-[#2a3a4a] hover:text-[#3d5a70] transition-colors text-left"
                        >
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] leading-none">{showPhaseReceiptPanel ? '▾' : '▸'}</span>
                                <span>Latest {getPhaseLabel(activeReceiptPhase)} Receipt</span>
                            </div>
                            {#if activePhaseArtifact}
                                <span class="text-[7px] text-[#334155] normal-case tracking-normal font-normal border border-[#1e293b] rounded-full px-1.5 py-0.5">{activePhaseArtifact.settlement.settlementState}</span>
                            {/if}
                        </button>
                    {#if showPhaseReceiptPanel}
                    <div
                        class="rounded-b-xl border-t border-[#1e293b] bg-[#0f172a]/35 p-3"
                    >
                        <div
                            class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                        >
                            Latest {getPhaseLabel(activeReceiptPhase)} Receipt
                        </div>
                        {#if activePhaseArtifact || activePhasePolicyReceipt}
                            <div class="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[#cbd5e1]">
                                <div>
                                    <span class="text-[#64748b]">Decision</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhasePolicyReceipt?.decision ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Audit</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhasePolicyReceipt?.auditLevel ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Commitment</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {maskIdentifier(
                                            activePhaseArtifact?.commitment.commitmentId,
                                        ) || "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Disclosure</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {maskIdentifier(
                                            activePhaseArtifact?.disclosure
                                                .disclosureHandle,
                                        ) || "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Algorithm</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhaseArtifact?.disclosure.algorithm ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Key Fingerprint</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhaseArtifact?.disclosure.keyFingerprint ??
                                            "digest-only"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Settlement State</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhaseArtifact?.settlement.settlementState ??
                                            "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Tx Hash</span>
                                    <div class="mt-1 break-all text-[#e2e8f0]">
                                        {maskIdentifier(
                                            activePhaseArtifact?.settlement.txHash,
                                        ) || "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Relayer</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhaseArtifact?.settlement.relayerMode ?? "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">Network</span>
                                    <div class="mt-1 text-[#e2e8f0] break-all">
                                        {activePhaseArtifact?.settlement.networkPassphrase ??
                                            "n/a"}
                                    </div>
                                </div>
                                <div>
                                    <span class="text-[#64748b]">ZK Eligibility</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {#if activePhaseArtifact?.zkEligibility?.available === true}
                                            <span class="text-[#5eead4]">proven</span>
                                            {#if activePhaseArtifact.zkEligibility.locallyVerified}
                                                <span class="text-[#22c55e]">(verified)</span>
                                            {/if}
                                        {:else if activePhaseArtifact?.zkEligibility?.available === false}
                                            <span class="text-[#fbbf24]">skipped</span>
                                        {:else}
                                            n/a
                                        {/if}
                                    </div>
                                </div>
                                {#if activePhaseArtifact?.zkEligibility}
                                <div>
                                    <span class="text-[#64748b]">ZK Threshold</span>
                                    <div class="mt-1 text-[#e2e8f0]">
                                        {activePhaseArtifact.zkEligibility.threshold} stroops
                                    </div>
                                </div>
                                {/if}
                            </div>
                            <div class="mt-2 text-[8px] text-[#94a3b8]">
                                {activePhaseArtifact?.disclosure.summary ??
                                    `No ${activeReceiptPhase} artifact summary yet.`}
                            </div>
                            {#if activePhaseArtifact?.settlement.note}
                                <div class="mt-1 text-[8px] text-[#94a3b8]">
                                    {activePhaseArtifact.settlement.note}
                                </div>
                            {/if}
                            {#if activePhaseArtifact}
                                <div class="mt-2">
                                    <button
                                        class="rounded-md border border-[#1e293b] bg-[#0f172a]/50 px-2 py-1 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            (showDisclosurePreview =
                                                !showDisclosurePreview)}
                                    >
                                        {showDisclosurePreview
                                            ? "Hide Redacted Preview"
                                            : "Show Redacted Preview"}
                                    </button>
                                </div>
                            {/if}
                            {#if showDisclosurePreview && activePhaseArtifact}
                                <div class="mt-2 rounded-lg border border-[#1e293b] bg-[#020617]/80 p-2">
                                    <div class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]">
                                        Redacted Disclosure Payload
                                    </div>
                                    <div class="mt-1 text-[8px] text-[#94a3b8]">
                                        Full payload digest:
                                        {activePhaseArtifact.disclosure.fullPayloadDigest}
                                    </div>
                                    <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/20 p-2 text-[8px] leading-relaxed text-[#cbd5e1]">{formatPrivacyJson(
                                        activePhaseArtifact.disclosure.redactedPayload,
                                    )}</pre>
                                </div>
                            {/if}
                            <div class="mt-3 grid grid-cols-2 gap-2">
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={() =>
                                        copyPrivacyReceiptForContext({
                                            phase: activeReceiptPhase,
                                            successMessage: withPrivacyModeSuffix(
                                                `${getPhaseLabel(activeReceiptPhase)} receipt copied`,
                                            ),
                                        })}
                                >
                                    Copy {getPhaseLabel(activeReceiptPhase)}
                                </button>
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={() =>
                                        downloadPrivacyReceiptForContext({
                                            phase: activeReceiptPhase,
                                            filenamePrefix: `discombo-${activeReceiptPhase}-receipt`,
                                            successMessage: withPrivacyModeSuffix(
                                                `${getPhaseLabel(activeReceiptPhase)} receipt downloaded`,
                                            ),
                                        })}
                                >
                                    Download {getPhaseLabel(activeReceiptPhase)}
                                </button>
                            </div>
                            <div class="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={() =>
                                        copyPrivacyReceiptJsonForContext({
                                            phase: activeReceiptPhase,
                                            successMessage: withPrivacyModeSuffix(
                                                `${getPhaseLabel(activeReceiptPhase)} receipt JSON copied`,
                                            ),
                                        })}
                                >
                                    Copy Receipt JSON
                                </button>
                                <button
                                    class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                    onclick={() =>
                                        downloadPrivacyReceiptJsonForContext({
                                            phase: activeReceiptPhase,
                                            filenamePrefix: `discombo-${activeReceiptPhase}-receipt`,
                                            successMessage: withPrivacyModeSuffix(
                                                `${getPhaseLabel(activeReceiptPhase)} receipt JSON downloaded`,
                                            ),
                                        })}
                                >
                                    Download Receipt JSON
                                </button>
                            </div>
                            {#if activePhaseArtifact?.settlement.txHash}
                                <div class="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            copySettlementTxHashForContext({
                                                phase: activeReceiptPhase,
                                                successMessage: withPrivacyModeSuffix(
                                                    `${getPhaseLabel(activeReceiptPhase)} tx hash copied`,
                                                ),
                                            })}
                                    >
                                        Copy Tx Hash
                                    </button>
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            copySettlementEvidenceJsonForContext({
                                                phase: activeReceiptPhase,
                                                successMessage: withPrivacyModeSuffix(
                                                    `${getPhaseLabel(activeReceiptPhase)} settlement evidence copied`,
                                                ),
                                            })}
                                    >
                                        Copy Settlement JSON
                                    </button>
                                </div>
                            {/if}
                            {#if activePhaseArtifact}
                                <div class="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            copyDisclosurePreviewForContext({
                                                phase: activeReceiptPhase,
                                                successMessage: withPrivacyModeSuffix(
                                                    `${getPhaseLabel(activeReceiptPhase)} disclosure copied`,
                                                ),
                                            })}
                                    >
                                        Copy Redacted JSON
                                    </button>
                                    <button
                                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/50 px-2 py-2 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
                                        onclick={() =>
                                            copyDisclosureDigestForContext({
                                                phase: activeReceiptPhase,
                                                successMessage: withPrivacyModeSuffix(
                                                    `${getPhaseLabel(activeReceiptPhase)} digest copied`,
                                                ),
                                            })}
                                    >
                                        Copy Full Digest
                                    </button>
                                </div>
                            {/if}
                        {:else}
                            <div class="mt-2 text-[8px] text-[#94a3b8]">
                                No {activeReceiptPhase} receipt yet. Run the current flow to generate
                                one.
                            </div>
                        {/if}
                    </div>
                    {/if}
                    </div>

                    {#if latestCompletedActiveArtifact}
                        <!-- Result Artifact Collapsible -->
                        <div class="border border-[#0f766e]/30 rounded-xl bg-[#042f2e]/15">
                            <button
                                onclick={() => (showResultArtifact = !showResultArtifact)}
                                class="flex items-center justify-between w-full px-3 py-2 text-[8px] uppercase tracking-[0.18em] text-[#1a3a35] hover:text-[#2a5a50] transition-colors text-left"
                            >
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[10px] leading-none">{showResultArtifact ? '▾' : '▸'}</span>
                                    <span>Latest Result Artifact</span>
                                </div>
                                <span class="text-[7px] text-[#1e4a42] normal-case tracking-normal font-normal border border-[#0f766e]/30 rounded-full px-1.5 py-0.5">{latestCompletedActiveArtifact.settlement.settlementState}</span>
                            </button>
                        {#if showResultArtifact}
                        <div
                            class="rounded-b-xl border-t border-[#0f766e]/30 bg-[#042f2e]/35 p-3"
                        >
                            <div
                                class="text-[8px] uppercase tracking-[0.18em] text-[#5eead4]"
                            >
                                Latest Result Artifact
                            </div>
                            <div class="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[#ccfbf1]">
                                <div>
                                    Commitment:
                                    {maskIdentifier(
                                        latestCompletedActiveArtifact.commitment.commitmentId,
                                    )}
                                </div>
                                <div>
                                    Disclosure:
                                    {maskIdentifier(
                                        latestCompletedActiveArtifact.disclosure
                                            .disclosureHandle,
                                    )}
                                </div>
                                <div>
                                    Policy:
                                    {latestCompletedActiveArtifact.policyReceipt.policyId}
                                </div>
                                <div>
                                    Checked:
                                    {formatPrivacyTimestamp(
                                        latestCompletedActiveArtifact.policyReceipt.checkedAt,
                                    )}
                                </div>
                                <div>
                                    State:
                                    {latestCompletedActiveArtifact.settlement.settlementState}
                                </div>
                                <div>
                                    Tx:
                                    {maskIdentifier(
                                        latestCompletedActiveArtifact.settlement.txHash,
                                    ) || "n/a"}
                                </div>
                                <div>
                                    Relayer:
                                    {latestCompletedActiveArtifact.settlement.relayerMode}
                                </div>
                                <div>
                                    Network:
                                    {latestCompletedActiveArtifact.settlement.networkPassphrase}
                                </div>
                            </div>
                            {#if latestCompletedActiveArtifact.settlement.note}
                                <div class="mt-2 text-[8px] text-[#99f6e4]">
                                    {latestCompletedActiveArtifact.settlement.note}
                                </div>
                            {/if}
                            <div class="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    class="rounded-lg border border-[#134e4a] bg-[#022c22]/60 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#022c22]/90"
                                    onclick={() =>
                                        copyPrivacyReceiptJsonForContext({
                                            phase:
                                                latestCompletedActiveArtifact.commitment.phase,
                                            intentId:
                                                latestCompletedActiveArtifact.commitment.intentId,
                                            successMessage: withPrivacyModeSuffix(
                                                "Result artifact JSON copied",
                                            ),
                                        })}
                                >
                                    Copy Result JSON
                                </button>
                                <button
                                    class="rounded-lg border border-[#134e4a] bg-[#022c22]/60 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#022c22]/90"
                                    onclick={() =>
                                        downloadPrivacyReceiptJsonForContext({
                                            phase:
                                                latestCompletedActiveArtifact.commitment.phase,
                                            intentId:
                                                latestCompletedActiveArtifact.commitment.intentId,
                                            filenamePrefix: `discombo-${latestCompletedActiveArtifact.commitment.phase}-result`,
                                            successMessage: withPrivacyModeSuffix(
                                                "Result artifact JSON downloaded",
                                            ),
                                        })}
                                >
                                    Download Result JSON
                                </button>
                            </div>
                            {#if latestCompletedActiveArtifact.settlement.txHash}
                                <div class="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        class="rounded-lg border border-[#134e4a] bg-[#022c22]/60 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#022c22]/90"
                                        onclick={() =>
                                            copySettlementTxHashForContext({
                                                phase:
                                                    latestCompletedActiveArtifact.commitment.phase,
                                                intentId:
                                                    latestCompletedActiveArtifact.commitment.intentId,
                                                successMessage: withPrivacyModeSuffix(
                                                    "Result tx hash copied",
                                                ),
                                            })}
                                    >
                                        Copy Result Tx
                                    </button>
                                    <button
                                        class="rounded-lg border border-[#134e4a] bg-[#022c22]/60 px-2 py-2 text-[8px] text-[#5eead4] transition-all hover:border-[#5eead4]/40 hover:bg-[#022c22]/90"
                                        onclick={() =>
                                            downloadSettlementEvidenceJsonForContext({
                                                phase:
                                                    latestCompletedActiveArtifact.commitment.phase,
                                                intentId:
                                                    latestCompletedActiveArtifact.commitment.intentId,
                                                filenamePrefix: `discombo-${latestCompletedActiveArtifact.commitment.phase}-settlement`,
                                                successMessage: withPrivacyModeSuffix(
                                                    "Result settlement evidence downloaded",
                                                ),
                                            })}
                                    >
                                        Download Settlement
                                    </button>
                                </div>
                            {/if}
                        </div>
                        {/if}
                        </div>
                    {/if}

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
                    {:else if mode === "send"}
                        <!-- SEND MODE -->
                        <div class="flex flex-col gap-4">
                            <div
                                class="rounded-xl border border-[#1e293b] bg-[#0f172a]/35 p-3"
                            >
                                <div
                                    class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                                >
                                    SPP Mode for Send
                                </div>
                                <div class="mt-1 text-[8px] text-[#94a3b8]">
                                    {getPrivacyWrapperSummary(privacyWrapperMode, "send")}
                                </div>
                                <div class="mt-1 text-[8px] text-[#fbbf24]">
                                    Public settlement still applies; non-public modes add
                                    policy and commitment receipts.
                                </div>
                            </div>

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
                                    placeholder="G... or C..."
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
                    {:else if mode === "receive"}
                        <!-- RECEIVE MODE -->
                        <div class="flex flex-col gap-4">
                            <div
                                class="rounded-xl border border-[#1e293b] bg-[#0f172a]/35 p-3"
                            >
                                <div
                                    class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                                >
                                    SPP Mode for Receive
                                </div>
                                <div class="mt-1 text-[8px] text-[#94a3b8]">
                                    {getPrivacyWrapperSummary(privacyWrapperMode, "receive")}
                                </div>
                                <div class="mt-1 text-[8px] text-[#fbbf24]">
                                    Receive requests stay advisory and public; non-public
                                    modes can export a protected request package that keeps
                                    the requested amount out of plaintext share text.
                                </div>
                            </div>

                            <div
                                class="rounded-xl border border-[#1e293b] bg-[#0f172a]/35 p-3"
                            >
                                <div
                                    class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]"
                                >
                                    Request Visibility
                                </div>
                                <div
                                    class="mt-2 flex bg-[#0f172a]/40 p-1.5 rounded-xl border border-[#1e293b]"
                                >
                                    <button
                                        class="flex-1 py-2 text-[9px] rounded-lg transition-all {receiveRequestVisibility ===
                                        'standard'
                                            ? 'bg-[#334155] text-white shadow-sm'
                                            : 'text-[#64748b]'}"
                                        onclick={() =>
                                            (receiveRequestVisibility = "standard")}
                                    >
                                        Standard
                                    </button>
                                    <button
                                        class="flex-1 py-2 text-[9px] rounded-lg transition-all {receiveRequestVisibility ===
                                        'protected'
                                            ? 'bg-[#0284c7] text-white shadow-sm'
                                            : 'text-[#64748b]'}"
                                        onclick={() =>
                                            (receiveRequestVisibility = "protected")}
                                    >
                                        Protected
                                    </button>
                                </div>
                                <div class="mt-2 text-[8px] text-[#94a3b8]">
                                    {#if receiveProtectedRequestEnabled}
                                        Destination and token remain visible so the sender
                                        can still pay. Requested amount and request metadata
                                        move into the encrypted SPP disclosure package.
                                    {:else if receiveRequestVisibility === "protected"}
                                        Protected packages require a non-public SPP mode.
                                        Public mode falls back to the standard plaintext
                                        request.
                                    {:else}
                                        Plaintext request includes the requested amount in
                                        share text.
                                    {/if}
                                </div>
                            </div>

                            <!-- TOKEN SELECT -->
                            <div
                                class="flex bg-[#0f172a]/40 p-1.5 rounded-xl border border-[#1e293b]"
                            >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {receiveToken ===
                                    'XLM'
                                        ? 'bg-[#334155] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (receiveToken = "XLM")}
                                    >XLM</button
                                >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {receiveToken ===
                                    'KALE'
                                        ? 'bg-[#0284c7] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (receiveToken = "KALE")}
                                    >KALE</button
                                >
                                <button
                                    class="flex-1 py-3 text-[10px] rounded-lg transition-all {receiveToken ===
                                    'USDC'
                                        ? 'bg-[#2775ca] text-white shadow-sm'
                                        : 'text-[#64748b]'}"
                                    onclick={() => (receiveToken = "USDC")}
                                    >USDC</button
                                >
                            </div>

                            <div
                                class="bg-[#0f172a]/40 p-4 rounded-xl border border-[#1e293b]"
                            >
                                <label
                                    class="text-[9px] uppercase text-[#64748b] mb-2 block tracking-widest"
                                    >Requested Amount ({receiveToken})</label
                                >
                                <input
                                    type="number"
                                    bind:value={receiveAmount}
                                    placeholder="optional"
                                    class="w-full bg-transparent text-[#f1f5f9] text-xl focus:outline-none font-[inherit] placeholder-[#334155]"
                                />
                                <div class="mt-2 text-[8px] text-[#94a3b8]">
                                    Advisory only. Amount is not enforced on-chain.
                                </div>
                            </div>

                            <div
                                class="bg-[#0f172a]/40 p-4 rounded-xl border border-[#1e293b]"
                            >
                                <div
                                    class="text-[9px] uppercase text-[#64748b] mb-2 tracking-widest"
                                >
                                    Receive Address (Smart Account)
                                </div>
                                <div
                                    class="text-[10px] text-[#e2e8f0] break-all leading-relaxed"
                                >
                                    {userState.contractId ||
                                        "Connect wallet to reveal address"}
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                <button
                                    class="text-[9px] py-3 rounded-lg border border-[#1e293b] bg-[#0f172a]/50 text-[#7dd3fc] hover:bg-[#0f172a]/80 hover:border-[#7dd3fc]/40 transition-all"
                                    onclick={copyReceiveAddress}
                                    disabled={!userState.contractId}
                                >
                                    Copy Address
                                </button>
                                <button
                                    class="text-[9px] py-3 rounded-lg border border-[#1e293b] bg-[#0f172a]/50 text-[#7dd3fc] hover:bg-[#0f172a]/80 hover:border-[#7dd3fc]/40 transition-all"
                                    onclick={copyReceiveRequest}
                                    disabled={!userState.contractId}
                                >
                                    {receiveProtectedRequestEnabled
                                        ? "Copy Protected Request"
                                        : "Copy Request"}
                                </button>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                <button
                                    class="text-[9px] py-3 rounded-lg border border-[#1e293b] bg-[#0f172a]/50 text-[#7dd3fc] hover:bg-[#0f172a]/80 hover:border-[#7dd3fc]/40 transition-all"
                                    onclick={shareReceiveRequest}
                                    disabled={!userState.contractId}
                                >
                                    {receiveProtectedRequestEnabled
                                        ? "Share Protected Request"
                                        : "Share Request"}
                                </button>
                                <button
                                    class="text-[9px] py-3 rounded-lg border border-[#1e293b] bg-[#0f172a]/50 text-[#7dd3fc] hover:bg-[#0f172a]/80 hover:border-[#7dd3fc]/40 transition-all"
                                    onclick={() =>
                                        receiveWatchActive
                                            ? stopReceiveWatch()
                                            : startReceiveWatch()}
                                    disabled={!userState.contractId}
                                >
                                    {receiveWatchActive
                                        ? "Stop Watch"
                                        : "Watch Amount"}
                                </button>
                            </div>

                            {#if receiveWatchActive}
                                <div
                                    class="bg-[#0f172a]/40 p-4 rounded-xl border border-[#1e293b]"
                                >
                                    <div
                                        class="text-[9px] uppercase tracking-widest text-[#64748b]"
                                    >
                                        Receive Watch
                                    </div>
                                    <div class="mt-2 text-[10px] text-[#cbd5e1]">
                                        Token: {receiveWatchToken}
                                    </div>
                                    <div class="text-[10px] text-[#cbd5e1]">
                                        Target: {formatTokenAmount(
                                            receiveWatchTargetStroops,
                                        )}
                                    </div>
                                    <div class="text-[10px] text-[#cbd5e1]">
                                        Received: {formatTokenAmount(
                                            receiveWatchDeltaStroops,
                                        )}
                                    </div>
                                    <div class="mt-2 text-[9px] text-[#fbbf24]">
                                        {#if receiveWatchFulfilled}
                                            Request fulfilled.
                                        {:else}
                                            Waiting for incoming transfer...
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {:else if mode === "pool"}
                        <!-- POOL MODE -->
                        <div class="flex flex-col gap-4">
                            <!-- Pool Depth -->
                            <div class="rounded-xl border border-[#1e293b] bg-[#0f172a]/35 p-3">
                                <div class="flex items-center justify-between">
                                    <div class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]">
                                        Private Pool
                                    </div>
                                    <div class="text-[7px] text-[#64748b]">
                                        {getPoolDepthLabel(poolEntries)}
                                    </div>
                                </div>
                                <div class="mt-1 text-[8px] text-[#94a3b8]">
                                    Queue payment intents with pre-committed receipts. Settle the full pool as a batch — each entry DEX-routed for on-chain indirection.
                                </div>
                                {#if privacyWrapperMode === "public"}
                                    <div class="mt-2 text-[7px] text-[#fbbf24]/70 border border-[#fbbf24]/20 rounded-lg px-2 py-1">
                                        Switch to BEFORE / AFTER / WRAP mode for commitment receipts per pool entry.
                                    </div>
                                {/if}
                            </div>

                            <!-- Pool mode toggle -->
                            <div class="rounded-xl border border-[#1e293b] bg-[#0f172a]/35 p-2">
                                <div class="text-[7px] uppercase tracking-[0.15em] text-[#64748b] mb-2">Deposit Mode</div>
                                <div class="grid grid-cols-2 gap-1">
                                    <button
                                        onclick={() => { poolMode = "addressed"; lastCommitmentTicket = null; }}
                                        class="rounded-lg px-2 py-2 text-[8px] transition-all border {poolMode === 'addressed' ? 'border-[#7dd3fc]/40 bg-[#0f172a] text-[#7dd3fc]' : 'border-[#1e293b] text-[#64748b] hover:text-[#94a3b8]'}"
                                    >
                                        Send to Address
                                    </button>
                                    <button
                                        onclick={() => { poolMode = "commitment_ticket"; poolSendTo = ""; poolSendQuote = null; }}
                                        class="rounded-lg px-2 py-2 text-[8px] transition-all border {poolMode === 'commitment_ticket' ? 'border-[#a78bfa]/40 bg-[#0f172a] text-[#a78bfa]' : 'border-[#1e293b] text-[#64748b] hover:text-[#94a3b8]'}"
                                    >
                                        🎟 Get Ticket
                                    </button>
                                </div>
                                {#if poolMode === "commitment_ticket"}
                                    <div class="mt-2 rounded-lg border border-[#a78bfa]/20 bg-[#1e1b4b]/30 px-2 py-1.5 text-[7px] text-[#a5b4fc]">
                                        ZK cash mode: no recipient specified now. You'll get a secret ticket. Whoever holds it can withdraw to any wallet later — deposit and withdrawal are cryptographically unlinked.
                                        <div class="mt-1 text-[#6d28d9]/80">⚠️ Pre-alpha research. No on-chain enforcement yet. Not audited.</div>
                                    </div>
                                {/if}
                            </div>

                            <!-- Add to Pool form -->
                            <div class="flex flex-col gap-2">
                                <div class="input-box group">
                                    <input
                                        type="number"
                                        bind:value={poolSendAmount}
                                        oninput={poolFetchQuote}
                                        placeholder="0.0"
                                        class="w-full bg-transparent text-[#f1f5f9] text-xl focus:outline-none font-[inherit] placeholder-[#334155]"
                                    />
                                    <button
                                        class="text-xs text-[#94a3b8] ml-2 tracking-wider hover:text-white hover:bg-white/10 px-2 py-1 rounded transition-colors"
                                        onclick={() => {
                                            const tokens: TokenSymbol[] = ["XLM", "KALE", "USDC"];
                                            const idx = tokens.indexOf(poolSendToken);
                                            poolSendToken = tokens[(idx + 1) % tokens.length];
                                            poolSendQuote = null;
                                            poolFetchQuote();
                                        }}
                                    >{poolSendToken} ▼</button>
                                </div>

                                {#if poolMode === "addressed"}
                                    <div class="input-box group">
                                        <input
                                            type="text"
                                            bind:value={poolSendTo}
                                            oninput={poolFetchQuote}
                                            placeholder="Recipient address"
                                            class="w-full bg-transparent text-[#f1f5f9] text-sm focus:outline-none font-[inherit] placeholder-[#334155]"
                                        />
                                    </div>
                                {:else}
                                    <div class="rounded-lg border border-[#a78bfa]/20 bg-[#1e1b4b]/20 px-3 py-2 text-[8px] text-[#a5b4fc]">
                                        No recipient needed — the ticket IS the claim.
                                    </div>
                                {/if}

                                {#if poolSendQuoting}
                                    <div class="text-[8px] text-[#64748b] text-center">Quoting private route...</div>
                                {:else if poolSendQuoteError}
                                    <div class="text-[8px] text-[#f87171]">{poolSendQuoteError}</div>
                                {:else if poolSendQuote}
                                    <div class="rounded-lg border border-[#1e293b] bg-[#0b1120]/60 px-3 py-2 text-[8px]">
                                        <div class="text-[#94a3b8]">{poolSendQuote.routeLabel}</div>
                                        <div class="mt-1 flex justify-between">
                                            <span class="text-[#64748b]">You send:</span>
                                            <span class="text-[#e2e8f0]">{poolSendAmount} {poolSendToken}</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-[#64748b]">{poolMode === "commitment_ticket" ? "Pool receives ≥" : "They get ≥"}</span>
                                            <span class="text-[#e2e8f0]">{Number(BigInt(poolSendQuote.amountOutMin)) / 1e7} {poolSendQuote.tokenOutSymbol}</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-[#64748b]">Impact:</span>
                                            <span class="text-[#e2e8f0]">{poolSendQuote.priceImpactPct}%</span>
                                        </div>
                                    </div>
                                {/if}

                                <button
                                    onclick={poolAddEntry}
                                    disabled={!userState.contractId || !poolSendAmount || (poolMode === "addressed" && !poolSendTo)}
                                    class="action-btn w-full py-4 text-xs"
                                    class:opacity-40={!userState.contractId || !poolSendAmount || (poolMode === "addressed" && !poolSendTo)}
                                >
                                    {poolMode === "commitment_ticket" ? "🎟 Generate Commitment Ticket" : "+ Add to Pool"}
                                </button>
                            </div>

                            <!-- Commitment ticket display -->
                            {#if lastCommitmentTicket}
                                <div class="rounded-xl border border-[#a78bfa]/30 bg-[#1e1b4b]/30 p-3 flex flex-col gap-2">
                                    <div class="flex items-center justify-between">
                                        <div class="text-[8px] uppercase tracking-[0.15em] text-[#a78bfa]">🎟 Your Commitment Ticket</div>
                                        <button
                                            onclick={poolCopyTicket}
                                            class="text-[7px] px-2 py-1 rounded border border-[#a78bfa]/30 text-[#a5b4fc] hover:bg-[#a78bfa]/10 transition-all"
                                        >{poolTicketCopied ? "✓ Copied!" : "Copy"}</button>
                                    </div>
                                    <div class="font-mono text-[6px] text-[#94a3b8] break-all leading-relaxed bg-[#0b1120]/60 rounded-lg p-2 select-all">
                                        {lastCommitmentTicket}
                                    </div>
                                    <div class="text-[7px] text-[#7c3aed]/80">
                                        Save this ticket now. Anyone who has it can withdraw the funds to any wallet. Losing it means losing access to the deposit.
                                    </div>
                                </div>
                            {/if}

                            <!-- Pool Entries -->
                            {#if poolEntries.length > 0}
                                <div class="flex flex-col gap-1">
                                    {#each poolEntries as entry (entry.entryId)}
                                        <div class="rounded-lg border border-[#1e293b] bg-[#0b1120]/50 px-3 py-2 flex items-center justify-between text-[8px]">
                                            <div class="flex flex-col gap-0.5">
                                                <div class="text-[#94a3b8]">{entry.amountMasked} → {entry.recipientMasked}</div>
                                                <div class="text-[#64748b]">{entry.routeLabel}</div>
                                                {#if entry.commitmentId}
                                                    <div class="text-[#334155]">commit: {entry.commitmentId.slice(0, 18)}…</div>
                                                {/if}
                                                {#if entry.commitmentKey}
                                                    <div class="text-[7px] text-[#a78bfa]/80">🎟 ticket mode</div>
                                                {/if}
                                            </div>
                                            <div class="flex flex-col items-end gap-1">
                                                <span class={`rounded-full px-1.5 py-0.5 text-[7px] border ${
                                                    entry.status === "confirmed" ? "border-[#0f766e]/40 text-[#5eead4]" :
                                                    entry.status === "failed" ? "border-[#991b1b]/40 text-[#f87171]" :
                                                    entry.status === "submitted" ? "border-[#1d4ed8]/40 text-[#7dd3fc]" :
                                                    "border-[#1e293b] text-[#64748b]"
                                                }`}>{entry.status}</span>
                                                {#if entry.txHash}
                                                    <span class="text-[7px] text-[#334155]">{entry.txHash.slice(0, 10)}…</span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>

                                <div class="grid grid-cols-2 gap-2">
                                    <button
                                        onclick={poolSubmitAll}
                                        disabled={poolSubmitting || !isPoolReadyToSubmit(poolEntries)}
                                        class="action-btn py-4 text-xs"
                                        class:opacity-40={poolSubmitting || !isPoolReadyToSubmit(poolEntries)}
                                    >
                                        {poolSubmitting ? "Settling..." : "Submit Pool"}
                                    </button>
                                    <button
                                        onclick={poolClear}
                                        class="rounded-xl border border-[#1e293b] bg-[#0f172a]/50 py-4 text-[8px] text-[#64748b] hover:text-[#94a3b8] hover:border-[#334155] transition-all"
                                    >
                                        Clear Pool
                                    </button>
                                </div>

                                {#if poolStatusMessage}
                                    <div class="text-center text-[8px] text-[#7dd3fc] tracking-widest">
                                        {poolStatusMessage}
                                    </div>
                                {/if}
                            {/if}

                            <!-- Redeem Ticket Panel -->
                            <details class="rounded-xl border border-[#a78bfa]/20 bg-[#1e1b4b]/20">
                                <summary class="cursor-pointer px-3 py-2 text-[8px] text-[#a78bfa] uppercase tracking-[0.15em] select-none">
                                    🎟 Redeem Commitment Ticket (Research)
                                </summary>
                                <div class="px-3 pb-3 pt-1 flex flex-col gap-2">
                                    <div class="text-[7px] text-[#6d28d9]/80 border border-[#7c3aed]/20 rounded-lg px-2 py-1.5">
                                        ⚠️ PRE-ALPHA RESEARCH ONLY — No on-chain enforcement yet. Not audited. Vibecoded. No guarantees. Do not use with funds you can't afford to lose.
                                    </div>
                                    <div class="input-box group">
                                        <input
                                            type="text"
                                            bind:value={redeemTicketInput}
                                            placeholder="dck1:…  (paste your commitment ticket)"
                                            class="w-full bg-transparent text-[#f1f5f9] text-[8px] focus:outline-none font-mono placeholder-[#334155]"
                                        />
                                    </div>
                                    <div class="input-box group">
                                        <input
                                            type="text"
                                            bind:value={redeemRecipientInput}
                                            placeholder="Recipient wallet address (any G… or C…)"
                                            class="w-full bg-transparent text-[#f1f5f9] text-sm focus:outline-none font-[inherit] placeholder-[#334155]"
                                        />
                                    </div>
                                    <button
                                        onclick={poolRedeemTicket}
                                        disabled={redeemWorking}
                                        class="action-btn w-full py-3 text-xs"
                                        class:opacity-40={redeemWorking}
                                    >
                                        {redeemWorking ? "Generating proof…" : "Generate Withdrawal Proof"}
                                    </button>
                                    {#if redeemError}
                                        <div class="text-[8px] text-[#f87171]">{redeemError}</div>
                                    {/if}
                                    {#if redeemProofResult}
                                        {@const r = redeemProofResult as Record<string, unknown>}
                                        <!-- Contract-facing fields highlighted for when CommitmentPool is deployed -->
                                        {#if r.commitmentBytes32Hex && r.nullifierHashHex}
                                        <div class="rounded-lg border border-[#34d399]/20 bg-[#064e3b]/20 px-2 py-1.5 text-[7px] font-mono text-[#6ee7b7]">
                                            <div class="text-[#34d399] uppercase tracking-widest text-[6px] mb-1">Contract deposit() args (when pool deployed)</div>
                                            <div><span class="text-[#94a3b8]">commitment (BytesN&lt;32&gt;):</span> {String(r.commitmentBytes32Hex)}</div>
                                            <div class="mt-1"><span class="text-[#94a3b8]">nullifier_hash (BytesN&lt;32&gt;):</span> {String(r.nullifierHashHex)}</div>
                                        </div>
                                        {/if}
                                        <div class="rounded-lg border border-[#a78bfa]/20 bg-[#0b1120]/60 p-2 text-[7px] font-mono text-[#94a3b8] break-all whitespace-pre-wrap">
                                            {JSON.stringify(redeemProofResult, null, 2)}
                                        </div>
                                    {/if}
                                </div>
                            </details>
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

                    <!-- ACTION BUTTON (not shown in pool mode, pool has its own controls) -->
                    {#if mode !== "pool"}
                    <button
                        onclick={handleAction}
                        class="action-btn w-full py-5 text-sm font-bold shadow-lg"
                        disabled={(mode !== "receive" &&
                            swapState === "submitting") ||
                            (mode === "swap" &&
                                quote &&
                                !turnstileToken &&
                                !turnstileFailed &&
                                !isDirectRelayer)}
                    >
                        {#if mode !== "receive" && swapState === "submitting"}
                            {mode === "swap" ? "Swapping..." : "Sending..."}
                        {:else if mode === "swap" && turnstileFailed && !turnstileToken}
                            Swap (pay fee)
                        {:else if mode === "receive"}
                            {receiveProtectedRequestEnabled
                                ? "Copy Protected Request"
                                : "Copy Request"}
                        {:else}
                            {mode === "swap" ? "Swap" : "Send"}{privacyWrapperMode !== "public" && mode === "send" ? " (private route)" : ""}
                        {/if}
                    </button>
                    {/if}
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

    .privacy-chip {
        border: 1px solid #1e293b;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.55);
        color: #64748b;
        font-family: "Press Start 2P", cursive;
        font-size: 8px;
        letter-spacing: 0.12em;
        padding: 10px 8px;
        transition: all 0.15s ease;
    }
    .privacy-chip:hover {
        color: #e2e8f0;
        border-color: #7dd3fc66;
        background: rgba(15, 23, 42, 0.85);
    }
    .privacy-chip.active {
        color: #f8fafc;
        border-color: #7dd3fc;
        background: linear-gradient(
            180deg,
            rgba(2, 132, 199, 0.4) 0%,
            rgba(15, 23, 42, 0.8) 100%
        );
        box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.2) inset;
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

