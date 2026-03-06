import logger, { LogCategory, LogLevel } from "./debug-logger";
import { safeLocalStorageGet, safeLocalStorageSet } from "./storage";

const DISCOMBO_VERBOSE_KEY = "smol:discombo:verbose";
const DISCOMBO_RUN_COUNT_KEY = "smol:discombo:run_count";

type DebugLogLevel = "trace" | "debug" | "info" | "warn" | "error";
type DebugPrivacyPhase = "swap" | "send" | "receive";
type DebugPrivacyStage = "pre" | "post";
type DebugPrivacyDecision = "allow" | "allow_with_audit";

interface DebugPrivacyArtifactLookup {
    phase?: DebugPrivacyPhase;
    stage?: DebugPrivacyStage;
    decision?: DebugPrivacyDecision;
    intentId?: string | null;
    commitmentId?: string;
    disclosureHandle?: string;
}

export interface DiscombobulatorSnapshot {
    appState: string;
    mode: string;
    swapState: string;
    swapInToken: string;
    swapOutToken: string;
    swapAmount: string;
    swapOutputAmount: string;
    sendToken: string;
    sendAmount: string;
    sendToMasked: string;
    receiveToken: string;
    receiveAmount: string;
    receiveRequestVisibility: string;
    receiveWatchActive: boolean;
    receiveWatchFulfilled: boolean;
    receiveWatchToken: string;
    receiveWatchTarget: string;
    receiveWatchReceived: string;
    hasQuote: boolean;
    statusMessage: string;
    hasTurnstileToken: boolean;
    turnstileFailed: boolean;
    isAuthenticated: boolean;
    privacyWrapperMode: string;
    privacyPolicyDescriptor: string;
    privacyPolicyPreEnabled: boolean;
    privacyPolicyPostEnabled: boolean;
    sppTraceCount: number;
    sppActiveIntentId: string;
    sppLastIntentId: string;
    sppLastIntentStatus: string;
    privacyArtifactCount: number;
    privacyLastCommitmentId: string;
    privacyLastPolicyDecision: string;
    privacyLastDisclosureHandle: string;
    privacyLastSettlementState: string;
    privacyLastSettlementTxHash: string;
    zkEligibilityStatus: string;
    zkEligibilityLocallyVerified: boolean | null;
    zkEligibilityThreshold: string;
    zkEligibilityDurationMs: number | null;
    lowGpuMode: boolean;
    contractIdMasked: string;
    keyIdMasked: string;
    walletConnected: boolean;
    relayerMode: "DIRECT" | "PROXY";
}

export interface DiscombobulatorConsoleHelpers {
    help: () => void;
    snapshot: () => DiscombobulatorSnapshot;
    spp: (limit?: number) => unknown[];
    exportSpp: () => string;
    clearSpp: () => void;
    privacy: (
        limit?: number,
        filters?: Partial<
            Pick<
                DebugPrivacyArtifactLookup,
                "phase" | "stage" | "decision"
            >
        >,
    ) => unknown[];
    exportPrivacy: () => string;
    clearPrivacy: () => void;
    receipt: (phase?: DebugPrivacyPhase) => unknown | null;
    exportReceipt: (phase?: DebugPrivacyPhase) => string;
    artifact: (
        query: string | DebugPrivacyArtifactLookup,
    ) => unknown | null;
    setVerbose: (nextValue: boolean) => void;
    enableVerbose: () => void;
    disableVerbose: () => void;
    setTraceLevel: (nextLevel: keyof typeof LogLevel) => void;
    traceOn: () => void;
    traceOff: () => void;
    mark: (event: string, data?: Record<string, unknown>) => void;
    logs: (limit?: number) => unknown[];
    exportLogs: () => string;
    summary: () => void;
    clear: () => void;
}

export interface DiscombobulatorDebugger {
    trace: (event: string, data?: Record<string, unknown>) => void;
    debug: (event: string, data?: Record<string, unknown>) => void;
    info: (event: string, data?: Record<string, unknown>) => void;
    warn: (event: string, data?: Record<string, unknown>) => void;
    error: (event: string, data?: Record<string, unknown>) => void;
    transition: (
        field: string,
        from: string,
        to: string,
        data?: Record<string, unknown>,
    ) => void;
    snapshot: () => DiscombobulatorSnapshot;
}

export interface DiscombobulatorDebugBootstrapOptions {
    getSnapshot: () => DiscombobulatorSnapshot;
    hostname: string;
    relayerMode: "DIRECT" | "PROXY";
    forceTrace?: boolean;
    debugQueryEnabled?: boolean;
    getSppTrace?: (limit?: number) => unknown[];
    exportSppTrace?: () => string;
    clearSppTrace?: () => void;
    getPrivacyArtifacts?: (limit?: number) => unknown[];
    exportPrivacyArtifacts?: () => string;
    clearPrivacyArtifacts?: () => void;
    getPrivacyReceipt?: (phase?: DebugPrivacyPhase) => unknown | null;
    exportPrivacyReceipt?: (phase?: DebugPrivacyPhase) => string;
    findPrivacyArtifact?: (
        query: string | DebugPrivacyArtifactLookup,
    ) => unknown | null;
}

declare global {
    interface Window {
        discomboDebug?: DiscombobulatorConsoleHelpers;
    }
}

const noop = () => {};

export const noopDiscombobulatorDebugger: DiscombobulatorDebugger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    transition: noop,
    snapshot: () => ({
        appState: "unknown",
        mode: "unknown",
        swapState: "unknown",
        swapInToken: "unknown",
        swapOutToken: "unknown",
        swapAmount: "",
        swapOutputAmount: "",
        sendToken: "unknown",
        sendAmount: "",
        sendToMasked: "",
        receiveToken: "unknown",
        receiveAmount: "",
        receiveRequestVisibility: "standard",
        receiveWatchActive: false,
        receiveWatchFulfilled: false,
        receiveWatchToken: "unknown",
        receiveWatchTarget: "0",
        receiveWatchReceived: "0",
        hasQuote: false,
        statusMessage: "",
        hasTurnstileToken: false,
        turnstileFailed: false,
        isAuthenticated: false,
        privacyWrapperMode: "public",
        privacyPolicyDescriptor: "public_only",
        privacyPolicyPreEnabled: false,
        privacyPolicyPostEnabled: false,
        sppTraceCount: 0,
        sppActiveIntentId: "",
        sppLastIntentId: "",
        sppLastIntentStatus: "",
        privacyArtifactCount: 0,
        privacyLastCommitmentId: "",
        privacyLastPolicyDecision: "",
        privacyLastDisclosureHandle: "",
        privacyLastSettlementState: "",
        privacyLastSettlementTxHash: "",
        zkEligibilityStatus: "n/a",
        zkEligibilityLocallyVerified: null,
        zkEligibilityThreshold: "",
        zkEligibilityDurationMs: null,
        lowGpuMode: false,
        contractIdMasked: "",
        keyIdMasked: "",
        walletConnected: false,
        relayerMode: "PROXY",
    }),
};

function parseBoolean(value: string | null, fallback: boolean): boolean {
    if (value === null) return fallback;
    if (value === "1" || value.toLowerCase() === "true") return true;
    if (value === "0" || value.toLowerCase() === "false") return false;
    return fallback;
}

function readVerboseFlag(): boolean {
    return parseBoolean(safeLocalStorageGet(DISCOMBO_VERBOSE_KEY), true);
}

function writeVerboseFlag(value: boolean): void {
    safeLocalStorageSet(DISCOMBO_VERBOSE_KEY, value ? "1" : "0");
}

function nextRunCount(): number {
    const previous = Number.parseInt(
        safeLocalStorageGet(DISCOMBO_RUN_COUNT_KEY) ?? "0",
        10,
    );
    const next = Number.isFinite(previous) ? previous + 1 : 1;
    safeLocalStorageSet(DISCOMBO_RUN_COUNT_KEY, String(next));
    return next;
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    ERROR: LogLevel.ERROR,
    WARN: LogLevel.WARN,
    INFO: LogLevel.INFO,
    DEBUG: LogLevel.DEBUG,
    TRACE: LogLevel.TRACE,
};

function resolveLogLevel(level: string): LogLevel | null {
    const normalized = level.toUpperCase();
    const result = LOG_LEVEL_MAP[normalized];
    return typeof result === "number" ? result : null;
}

function isDebugQueryEnabledFromUrl(): boolean {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search);
    if (!params.has("debug")) return false;

    const raw = (params.get("debug") ?? "").trim().toLowerCase();
    if (!raw) return true;
    return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function getDebugLevelFromUrl(): LogLevel | null {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const raw =
        params.get("debugLevel") ??
        params.get("logLevel") ??
        params.get("level");

    if (!raw) return null;
    return resolveLogLevel(raw);
}

function matchesPrivacyArtifactFilter(
    entry: any,
    filters: Partial<
        Pick<DebugPrivacyArtifactLookup, "phase" | "stage" | "decision">
    >,
): boolean {
    if (filters.phase && entry?.commitment?.phase !== filters.phase) {
        return false;
    }
    if (filters.stage && entry?.commitment?.stage !== filters.stage) {
        return false;
    }
    if (
        filters.decision &&
        entry?.policyReceipt?.decision !== filters.decision
    ) {
        return false;
    }
    return true;
}

export function bootstrapDiscombobulatorDebug(
    options: DiscombobulatorDebugBootstrapOptions,
): DiscombobulatorDebugger {
    const runCount = nextRunCount();
    const sessionId = `discombo-${Date.now().toString(36)}-${runCount}`;
    const debugQueryEnabled =
        options.debugQueryEnabled ?? isDebugQueryEnabledFromUrl();
    let verbose = debugQueryEnabled ? true : readVerboseFlag();
    const urlDebugLevel = getDebugLevelFromUrl();
    const traceEnabled = options.forceTrace ?? debugQueryEnabled;

    if (debugQueryEnabled) {
        writeVerboseFlag(true);
    }

    if (urlDebugLevel !== null) {
        logger.setLevel(urlDebugLevel);
    } else if (traceEnabled) {
        logger.setLevel(LogLevel.TRACE);
    }

    const emit = (
        level: DebugLogLevel,
        event: string,
        data?: Record<string, unknown>,
    ): void => {
        if (!verbose && (level === "trace" || level === "debug" || level === "info")) {
            return;
        }

        const payload = {
            event,
            sessionId,
            hostname: options.hostname,
            relayerMode: options.relayerMode,
            ...(data ?? {}),
        };

        const message = `[Discombobulator] ${event}`;
        switch (level) {
            case "trace":
                logger.trace(LogCategory.GENERAL, message, payload);
                break;
            case "debug":
                logger.debug(LogCategory.GENERAL, message, payload);
                break;
            case "info":
                logger.info(LogCategory.GENERAL, message, payload);
                break;
            case "warn":
                logger.warn(LogCategory.GENERAL, message, payload);
                break;
            case "error":
                logger.error(LogCategory.GENERAL, message, payload);
                break;
            default:
                logger.info(LogCategory.GENERAL, message, payload);
                break;
        }
    };

    const helpers: DiscombobulatorConsoleHelpers = {
        help: () => {
            console.group("[Discombobulator] Console Helpers");
            console.log("window.discomboDebug.snapshot()");
            console.log("window.discomboDebug.spp(50)");
            console.log("window.discomboDebug.exportSpp()");
            console.log("window.discomboDebug.clearSpp()");
            console.log("window.discomboDebug.privacy(25)");
            console.log(
                "window.discomboDebug.privacy(25, { phase: 'swap', decision: 'allow_with_audit' })",
            );
            console.log("window.discomboDebug.exportPrivacy()");
            console.log("window.discomboDebug.clearPrivacy()");
            console.log("window.discomboDebug.receipt('swap')");
            console.log("window.discomboDebug.exportReceipt('receive')");
            console.log(
                "window.discomboDebug.artifact({ phase: 'send', stage: 'post' })",
            );
            console.log("window.discomboDebug.artifact('commit-1234')");
            console.log("window.discomboDebug.mark('label', { any: 'context' })");
            console.log("window.discomboDebug.traceOn() / traceOff()");
            console.log("window.discomboDebug.setTraceLevel('TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR')");
            console.log("window.discomboDebug.enableVerbose() / disableVerbose()");
            console.log("window.discomboDebug.logs(120)");
            console.log("window.discomboDebug.summary()");
            console.log("window.discomboDebug.exportLogs()");
            console.log("window.discomboDebug.clear()");
            console.groupEnd();
        },
        snapshot: () => options.getSnapshot(),
        spp: (limit = 50) => {
            if (!options.getSppTrace) {
                console.warn("[Discombobulator] SPP trace provider is not configured.");
                return [];
            }

            const entries = options.getSppTrace(limit);
            if (Array.isArray(entries) && entries.length > 0) {
                console.table(
                    entries.map((entry: any) => ({
                        intentId: entry.intentId ?? "unknown",
                        phase: entry.phase ?? "unknown",
                        mode: entry.mode ?? "unknown",
                        policy: entry.policy ?? "unknown",
                        status: entry.status ?? "unknown",
                        stages: entry.stageReceipts?.length ?? 0,
                        txHash: entry.txHash ?? "",
                        updatedAt: entry.updatedAt ?? "",
                    })),
                );
            }
            return entries;
        },
        exportSpp: () => {
            if (!options.exportSppTrace) {
                console.warn("[Discombobulator] SPP export provider is not configured.");
                return "";
            }
            return options.exportSppTrace();
        },
        clearSpp: () => {
            options.clearSppTrace?.();
            emit("info", "spp_trace_cleared");
        },
        privacy: (limit = 25, filters = {}) => {
            if (!options.getPrivacyArtifacts) {
                console.warn(
                    "[Discombobulator] Privacy artifact provider is not configured.",
                );
                return [];
            }

            const entries = options
                .getPrivacyArtifacts(limit)
                .filter((entry: any) =>
                    matchesPrivacyArtifactFilter(entry, filters),
                );
            if (Array.isArray(entries) && entries.length > 0) {
                console.table(
                    entries.map((entry: any) => ({
                        commitmentId: entry.commitment?.commitmentId ?? "unknown",
                        phase: entry.commitment?.phase ?? "unknown",
                        stage: entry.commitment?.stage ?? "unknown",
                        mode: entry.commitment?.mode ?? "unknown",
                        decision:
                            entry.policyReceipt?.decision ?? "unknown",
                        auditLevel:
                            entry.policyReceipt?.auditLevel ?? "unknown",
                        disclosureHandle:
                            entry.disclosure?.disclosureHandle ?? "",
                        settlementState:
                            entry.settlement?.settlementState ?? "unknown",
                        txHash: entry.settlement?.txHash ?? "",
                        algorithm: entry.disclosure?.algorithm ?? "",
                        summary: entry.disclosure?.summary ?? "",
                    })),
                );
            }
            return entries;
        },
        exportPrivacy: () => {
            if (!options.exportPrivacyArtifacts) {
                console.warn(
                    "[Discombobulator] Privacy export provider is not configured.",
                );
                return "";
            }
            return options.exportPrivacyArtifacts();
        },
        clearPrivacy: () => {
            options.clearPrivacyArtifacts?.();
            emit("info", "privacy_artifacts_cleared");
        },
        receipt: (phase) => {
            if (!options.getPrivacyReceipt) {
                console.warn(
                    "[Discombobulator] Privacy receipt provider is not configured.",
                );
                return null;
            }

            const receipt: any = options.getPrivacyReceipt(phase);
            if (!receipt) {
                console.warn(
                    `[Discombobulator] No privacy receipt found${phase ? ` for phase ${phase}` : ""}.`,
                );
                return null;
            }

            console.table([
                {
                    phase: receipt.phase ?? phase ?? "unknown",
                    mode: receipt.mode ?? "unknown",
                    settlement: receipt.settlementMode ?? "unknown",
                    settlementState: receipt.settlementState ?? "unknown",
                    decision: receipt.decision ?? "unknown",
                    auditLevel: receipt.auditLevel ?? "unknown",
                    riskScore: receipt.riskScore ?? "unknown",
                    commitmentId: receipt.commitmentId ?? "",
                    disclosureHandle: receipt.disclosureHandle ?? "",
                    txHash: receipt.settlementTxHash ?? "",
                    algorithm: receipt.algorithm ?? "",
                },
            ]);
            console.log(receipt);
            return receipt;
        },
        exportReceipt: (phase) => {
            if (!options.exportPrivacyReceipt) {
                console.warn(
                    "[Discombobulator] Privacy receipt export provider is not configured.",
                );
                return "";
            }
            return options.exportPrivacyReceipt(phase);
        },
        artifact: (query) => {
            if (!options.findPrivacyArtifact) {
                console.warn(
                    "[Discombobulator] Privacy artifact lookup provider is not configured.",
                );
                return null;
            }

            const result: any = options.findPrivacyArtifact(query);
            if (!result) {
                console.warn("[Discombobulator] No matching privacy artifact found.");
                return null;
            }

            const artifact = result.artifact ?? result;
            console.table([
                {
                    commitmentId: artifact.commitment?.commitmentId ?? "",
                    intentId: artifact.commitment?.intentId ?? "",
                    phase: artifact.commitment?.phase ?? "",
                    stage: artifact.commitment?.stage ?? "",
                    mode: artifact.commitment?.mode ?? "",
                    decision: artifact.policyReceipt?.decision ?? "",
                    disclosureHandle: artifact.disclosure?.disclosureHandle ?? "",
                    settlementState: artifact.settlement?.settlementState ?? "",
                    txHash: artifact.settlement?.txHash ?? "",
                    algorithm: artifact.disclosure?.algorithm ?? "",
                },
            ]);
            console.log(result);
            return result;
        },
        setVerbose: (nextValue: boolean) => {
            verbose = !!nextValue;
            writeVerboseFlag(verbose);
            emit("info", "verbose_toggled", { verbose });
        },
        enableVerbose: () => {
            verbose = true;
            writeVerboseFlag(true);
            emit("info", "verbose_enabled");
        },
        disableVerbose: () => {
            verbose = false;
            writeVerboseFlag(false);
            emit("warn", "verbose_disabled");
        },
        setTraceLevel: (nextLevel: keyof typeof LogLevel) => {
            const resolved = resolveLogLevel(String(nextLevel));
            if (resolved === null) {
                emit("warn", "invalid_trace_level", {
                    requested: nextLevel,
                });
                return;
            }
            logger.setLevel(resolved);
            emit("info", "trace_level_updated", {
                nextLevel: LogLevel[resolved],
            });
        },
        traceOn: () => {
            logger.setLevel(LogLevel.TRACE);
            emit("info", "trace_on");
        },
        traceOff: () => {
            logger.setLevel(LogLevel.INFO);
            emit("info", "trace_off");
        },
        mark: (event: string, data?: Record<string, unknown>) => {
            emit("info", `mark:${event}`, data);
        },
        logs: (limit = 120) => {
            const safeLimit = Math.max(1, Math.floor(limit));
            const entries = logger.getLogs().slice(-safeLimit);
            console.table(
                entries.map((entry) => ({
                    at: new Date(entry.timestamp).toISOString(),
                    level: LogLevel[entry.level],
                    category: entry.category,
                    message: entry.message,
                })),
            );
            return entries;
        },
        exportLogs: () => logger.exportLogs(),
        summary: () => {
            logger.printSummary();
            const snapshot = options.getSnapshot();
            console.table([
                {
                    mode: snapshot.mode,
                    swapState: snapshot.swapState,
                    privacyMode: snapshot.privacyWrapperMode,
                    privacyPolicy: snapshot.privacyPolicyDescriptor,
                    privacyPolicyPreEnabled: snapshot.privacyPolicyPreEnabled,
                    privacyPolicyPostEnabled: snapshot.privacyPolicyPostEnabled,
                    relayerMode: snapshot.relayerMode,
                    sppTraceCount: snapshot.sppTraceCount,
                    sppLastIntentId: snapshot.sppLastIntentId,
                    sppLastIntentStatus: snapshot.sppLastIntentStatus,
                    privacyArtifactCount: snapshot.privacyArtifactCount,
                    privacyLastCommitmentId: snapshot.privacyLastCommitmentId,
                    privacyLastPolicyDecision: snapshot.privacyLastPolicyDecision,
                    privacyLastDisclosureHandle:
                        snapshot.privacyLastDisclosureHandle,
                    privacyLastSettlementState:
                        snapshot.privacyLastSettlementState,
                    privacyLastSettlementTxHash:
                        snapshot.privacyLastSettlementTxHash,
                },
            ]);
            if (options.getSppTrace) {
                const recent = options.getSppTrace(5);
                if (recent.length > 0) {
                    console.log("[Discombobulator] Recent SPP intents");
                    console.table(
                        recent.map((entry: any) => ({
                            intentId: entry.intentId,
                            phase: entry.phase,
                            mode: entry.mode,
                            policy: entry.policy,
                            status: entry.status,
                            receipts: Array.isArray(entry.stageReceipts)
                                ? entry.stageReceipts.length
                                : 0,
                            txHash: entry.txHash || "",
                        })),
                    );
                }
            }
            if (options.getPrivacyArtifacts) {
                const recent = options.getPrivacyArtifacts(5);
                if (recent.length > 0) {
                    console.log("[Discombobulator] Recent privacy artifacts");
                    console.table(
                        recent.map((entry: any) => ({
                            commitmentId: entry.commitment?.commitmentId ?? "",
                            phase: entry.commitment?.phase ?? "",
                            stage: entry.commitment?.stage ?? "",
                            mode: entry.commitment?.mode ?? "",
                            decision:
                                entry.policyReceipt?.decision ?? "",
                            disclosureHandle:
                                entry.disclosure?.disclosureHandle ?? "",
                            settlementState:
                                entry.settlement?.settlementState ?? "",
                            txHash: entry.settlement?.txHash ?? "",
                        })),
                    );
                }
            }
            if (options.getPrivacyReceipt) {
                const receipts = (
                    ["swap", "send", "receive"] as DebugPrivacyPhase[]
                )
                    .map((phase) => {
                        const receipt: any = options.getPrivacyReceipt?.(phase);
                        if (!receipt) return null;
                        return {
                            phase,
                            decision: receipt.decision ?? "",
                            auditLevel: receipt.auditLevel ?? "",
                            commitmentId: receipt.commitmentId ?? "",
                            disclosureHandle: receipt.disclosureHandle ?? "",
                            settlementState: receipt.settlementState ?? "",
                            txHash: receipt.settlementTxHash ?? "",
                        };
                    })
                    .filter(Boolean);
                if (receipts.length > 0) {
                    console.log("[Discombobulator] Latest phase receipts");
                    console.table(receipts);
                }
            }
        },
        clear: () => {
            logger.clearLogs();
        },
    };

    if (typeof window !== "undefined") {
        window.discomboDebug = helpers;
        console.groupCollapsed(
            `[Discombobulator] Debug helpers preloaded (${sessionId})`,
        );
        console.log("Run window.discomboDebug.help() for command list.");
        console.log(
            `Debug URL mode: ${debugQueryEnabled ? "ON" : "OFF"} (?debug=true)`,
        );
        if (debugQueryEnabled) {
            console.log("Verbose trace mode is enabled for this session.");
        }
        console.groupEnd();
    }

    emit("info", "debug_bootstrap", {
        sessionId,
        verbose,
        traceLevel: LogLevel[logger.getLevel()],
        relayerMode: options.relayerMode,
        hostname: options.hostname,
        debugQueryEnabled,
        urlDebugLevel:
            urlDebugLevel === null ? "none" : LogLevel[urlDebugLevel],
    });

    return {
        trace: (event, data) => emit("trace", event, data),
        debug: (event, data) => emit("debug", event, data),
        info: (event, data) => emit("info", event, data),
        warn: (event, data) => emit("warn", event, data),
        error: (event, data) => emit("error", event, data),
        transition: (field, from, to, data) =>
            emit("info", `${field}_transition`, { from, to, ...(data ?? {}) }),
        snapshot: options.getSnapshot,
    };
}
