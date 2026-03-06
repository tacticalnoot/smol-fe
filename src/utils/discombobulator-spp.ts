export type SppPhase = "swap" | "send" | "receive";
export type SppTraceStage = "pre_envelope" | "action" | "post_envelope";
export type SppTraceStageStatus = "started" | "completed" | "skipped" | "failed";
export type SppIntentStatus = "active" | "succeeded" | "failed";

export type SppPolicyDescriptor =
    | "public_only"
    | "pre_envelope_research"
    | "post_envelope_research"
    | "pre_and_post_envelope_research";

export interface SppStageReceipt {
    stage: SppTraceStage;
    status: SppTraceStageStatus;
    at: string;
    durationMs?: number;
    details?: Record<string, unknown>;
}

export interface SppIntentTrace {
    intentId: string;
    intentHash: string;
    phase: SppPhase;
    mode: string;
    policy: SppPolicyDescriptor;
    summary: string;
    payload: Record<string, unknown>;
    stageReceipts: SppStageReceipt[];
    status: SppIntentStatus;
    txHash: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SppIntentInput {
    phase: SppPhase;
    mode: string;
    policy: SppPolicyDescriptor;
    summary: string;
    payload: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function canonicalize(value: unknown): unknown {
    if (typeof value === "bigint") {
        return { __sppType: "bigint", value: value.toString() };
    }

    if (Array.isArray(value)) {
        return value.map((item) => canonicalize(item));
    }

    if (isPlainObject(value)) {
        const sortedKeys = Object.keys(value).sort();
        const out: Record<string, unknown> = {};
        for (const key of sortedKeys) {
            out[key] = canonicalize(value[key]);
        }
        return out;
    }

    return value;
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function fallbackHash(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    let h3 = 0x9e3779b9;
    let h4 = 0x85ebca6b;

    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 0x01000193);
        h2 = Math.imul(h2 ^ code, 0x27d4eb2d);
        h3 = Math.imul(h3 ^ code, 0x165667b1);
        h4 = Math.imul(h4 ^ code, 0x9e3779b1);
    }

    const parts = [h1, h2, h3, h4]
        .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
        .join("");
    return `${parts}${parts}`;
}

export async function sha256Hex(input: string): Promise<string> {
    try {
        if (
            typeof globalThis !== "undefined" &&
            globalThis.crypto?.subtle &&
            typeof TextEncoder !== "undefined"
        ) {
            const payload = new TextEncoder().encode(input);
            const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
            return toHex(new Uint8Array(digest));
        }
    } catch {
        // Fallback below.
    }
    return fallbackHash(input);
}

export async function createSppIntentTrace(
    input: SppIntentInput,
): Promise<SppIntentTrace> {
    const createdAt = new Date().toISOString();
    const payloadHashSource = stableStringify({
        phase: input.phase,
        mode: input.mode,
        policy: input.policy,
        summary: input.summary,
        payload: input.payload,
    });
    const intentHash = await sha256Hex(payloadHashSource);
    const intentId = `spp-${Date.now().toString(36)}-${intentHash.slice(0, 10)}`;

    return {
        intentId,
        intentHash,
        phase: input.phase,
        mode: input.mode,
        policy: input.policy,
        summary: input.summary,
        payload: input.payload,
        stageReceipts: [],
        status: "active",
        txHash: null,
        error: null,
        createdAt,
        updatedAt: createdAt,
    };
}

export function appendSppStageReceipt(
    trace: SppIntentTrace,
    receipt: SppStageReceipt,
): SppIntentTrace {
    return {
        ...trace,
        stageReceipts: [...trace.stageReceipts, receipt],
        updatedAt: new Date().toISOString(),
    };
}

export function finalizeSppIntentTrace(
    trace: SppIntentTrace,
    status: SppIntentStatus,
    patch: Partial<Pick<SppIntentTrace, "txHash" | "error">> = {},
): SppIntentTrace {
    return {
        ...trace,
        status,
        txHash: patch.txHash ?? trace.txHash,
        error: patch.error ?? trace.error,
        updatedAt: new Date().toISOString(),
    };
}

export function exportSppTraceJson(traces: SppIntentTrace[]): string {
    return JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            traceCount: traces.length,
            traces,
        },
        null,
        2,
    );
}
