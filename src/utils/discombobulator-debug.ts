import logger, { LogCategory, LogLevel } from "./debug-logger";
import { safeLocalStorageGet, safeLocalStorageSet } from "./storage";

const DISCOMBO_VERBOSE_KEY = "smol:discombo:verbose";
const DISCOMBO_RUN_COUNT_KEY = "smol:discombo:run_count";

type DebugLogLevel = "trace" | "debug" | "info" | "warn" | "error";

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
    lowGpuMode: boolean;
    contractIdMasked: string;
    keyIdMasked: string;
    walletConnected: boolean;
    relayerMode: "DIRECT" | "PROXY";
}

export interface DiscombobulatorConsoleHelpers {
    help: () => void;
    snapshot: () => DiscombobulatorSnapshot;
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
