import {
    sha256Hex,
    stableStringify,
    type SppPhase,
} from "./discombobulator-spp";

export type PrivacyWrapperMode =
    | "public"
    | "shield_before_swap"
    | "shield_after_swap"
    | "wrap_around_swap";

export type PrivacyEnvelopeStage = "pre" | "post";
export type AspPolicyDecision = "allow" | "allow_with_audit";
export type AspAuditLevel = "standard" | "elevated";

export interface AspPolicyReceipt {
    receiptId: string;
    policyId: string;
    phase: SppPhase;
    mode: PrivacyWrapperMode;
    decision: AspPolicyDecision;
    auditLevel: AspAuditLevel;
    riskScore: number;
    reasons: string[];
    settlementMode: "public";
    networkPassphrase: string;
    relayerMode: "DIRECT" | "PROXY";
    checkedAt: string;
}

export interface PrivacyCommitmentReceipt {
    commitmentId: string;
    intentId: string;
    phase: SppPhase;
    stage: PrivacyEnvelopeStage;
    mode: PrivacyWrapperMode;
    settlementMode: "public";
    payloadDigest: string;
    redactedDigest: string;
    policyReceiptId: string;
    disclosureHandle: string;
    createdAt: string;
}

export interface PrivacyDisclosureArtifact {
    disclosureHandle: string;
    commitmentId: string;
    phase: SppPhase;
    stage: PrivacyEnvelopeStage;
    algorithm: "AES-GCM-256" | "digest-only";
    ciphertext: string | null;
    iv: string | null;
    keyFingerprint: string | null;
    summary: string;
    redactedPayload: Record<string, unknown>;
    fullPayloadDigest: string;
    createdAt: string;
}

export type PrivacySettlementKind = "public_transaction" | "request_only";
export type PrivacySettlementState =
    | "pending"
    | "confirmed"
    | "request_only"
    | "soft_success_unverified";

export interface PrivacySettlementBinding {
    settlementKind: PrivacySettlementKind;
    settlementState: PrivacySettlementState;
    networkPassphrase: string;
    relayerMode: "DIRECT" | "PROXY";
    operation: string;
    txHash: string | null;
    confirmedAt: string | null;
    softSuccessReason: "duplicate_nonce" | null;
    note: string | null;
}

export interface PrivacyExecutionArtifact {
    policyReceipt: AspPolicyReceipt;
    commitment: PrivacyCommitmentReceipt;
    disclosure: PrivacyDisclosureArtifact;
    settlement: PrivacySettlementBinding;
}

export interface EvaluateAspPolicyInput {
    phase: SppPhase;
    mode: PrivacyWrapperMode;
    payload: Record<string, unknown>;
    networkPassphrase: string;
    relayerMode: "DIRECT" | "PROXY";
}

export interface ExecutePrivacyStageInput {
    phase: SppPhase;
    stage: PrivacyEnvelopeStage;
    mode: PrivacyWrapperMode;
    intentId: string;
    payload: Record<string, unknown>;
    policyReceipt: AspPolicyReceipt;
}

export interface UpdatePrivacySettlementInput {
    artifact: PrivacyExecutionArtifact;
    txHash?: string | null;
    confirmedAt?: string | null;
    softSuccessReason?: "duplicate_nonce" | null;
    note?: string | null;
}

function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }

    let binary = "";
    bytes.forEach((value) => {
        binary += String.fromCharCode(value);
    });

    if (typeof btoa !== "undefined") {
        return btoa(binary);
    }

    return "";
}

function redactString(value: string): string {
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry));
    }

    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, innerValue] of Object.entries(
            value as Record<string, unknown>,
        )) {
            out[key] = redactValueByKey(key, innerValue);
        }
        return out;
    }

    if (typeof value === "string") {
        return redactString(value);
    }

    return value;
}

function redactValueByKey(key: string, value: unknown): unknown {
    const normalized = key.toLowerCase();
    const preserveKey =
        normalized.includes("token") ||
        normalized.includes("amount") ||
        normalized.includes("trade") ||
        normalized.includes("route") ||
        normalized.includes("operation") ||
        normalized.includes("requested") ||
        normalized.includes("mode") ||
        normalized.includes("phase") ||
        normalized.includes("policy") ||
        normalized.includes("masked") ||
        normalized.includes("hops");

    if (preserveKey) return value;

    return redactValue(value);
}

function createRedactedPayload(
    payload: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        out[key] = redactValueByKey(key, value);
    }
    return out;
}

function coerceNumericValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") {
        const coerced = Number(value);
        return Number.isFinite(coerced) ? coerced : null;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function summarizePayload(
    phase: SppPhase,
    redactedPayload: Record<string, unknown>,
): string {
    if (phase === "swap") {
        return `Swap ${String(redactedPayload.swapInToken ?? "?")} -> ${String(redactedPayload.swapOutToken ?? "?")}`;
    }
    if (phase === "send") {
        return `Send ${String(redactedPayload.sendToken ?? "?")} ${String(redactedPayload.amount ?? redactedPayload.sendAmount ?? "")}`.trim();
    }
    return `Receive ${String(redactedPayload.receiveToken ?? "?")} ${String(redactedPayload.requestedAmount ?? redactedPayload.receiveAmount ?? "")}`.trim();
}

function getDefaultSettlementOperation(
    phase: SppPhase,
    payload: Record<string, unknown>,
): string {
    if (phase === "swap") return "swap_transaction";
    if (phase === "send") return "token_transfer";
    if (typeof payload.operation === "string" && payload.operation.trim()) {
        return payload.operation.trim();
    }
    return "receive_request";
}

function createDefaultSettlementBinding(
    phase: SppPhase,
    payload: Record<string, unknown>,
    policyReceipt: AspPolicyReceipt,
): PrivacySettlementBinding {
    if (phase === "receive") {
        return {
            settlementKind: "request_only",
            settlementState: "request_only",
            networkPassphrase: policyReceipt.networkPassphrase,
            relayerMode: policyReceipt.relayerMode,
            operation: getDefaultSettlementOperation(phase, payload),
            txHash: null,
            confirmedAt: null,
            softSuccessReason: null,
            note: "No on-chain settlement is executed by the receive request flow.",
        };
    }

    return {
        settlementKind: "public_transaction",
        settlementState: "pending",
        networkPassphrase: policyReceipt.networkPassphrase,
        relayerMode: policyReceipt.relayerMode,
        operation: getDefaultSettlementOperation(phase, payload),
        txHash: null,
        confirmedAt: null,
        softSuccessReason: null,
        note: "Awaiting confirmed mainnet settlement binding.",
    };
}

async function sealPayload(
    payload: Record<string, unknown>,
): Promise<Pick<PrivacyDisclosureArtifact, "algorithm" | "ciphertext" | "iv" | "keyFingerprint">> {
    try {
        if (
            typeof globalThis === "undefined" ||
            !globalThis.crypto?.subtle ||
            typeof TextEncoder === "undefined"
        ) {
            console.warn("[SPP] AES-GCM-256 unavailable (crypto.subtle missing) — falling back to digest-only. Payload is NOT encrypted.");
            return {
                algorithm: "digest-only",
                ciphertext: null,
                iv: null,
                keyFingerprint: null,
            };
        }

        const encoded = new TextEncoder().encode(stableStringify(payload));
        const rawKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const key = await globalThis.crypto.subtle.importKey(
            "raw",
            rawKey,
            { name: "AES-GCM" },
            false,
            ["encrypt"],
        );
        const ciphertext = await globalThis.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            encoded,
        );
        const keyFingerprint = (await sha256Hex(toBase64(rawKey))).slice(0, 16);
        rawKey.fill(0);

        return {
            algorithm: "AES-GCM-256",
            ciphertext: toBase64(new Uint8Array(ciphertext)),
            iv: toBase64(iv),
            keyFingerprint,
        };
    } catch (err) {
        console.warn("[SPP] AES-GCM-256 encryption failed — falling back to digest-only. Payload is NOT encrypted.", err);
        return {
            algorithm: "digest-only",
            ciphertext: null,
            iv: null,
            keyFingerprint: null,
        };
    }
}

export async function evaluateAspPolicy(
    input: EvaluateAspPolicyInput,
): Promise<AspPolicyReceipt> {
    const checkedAt = new Date().toISOString();
    const reasons: string[] = ["public settlement remains visible on-chain"];
    let riskScore = 8;

    if (input.mode !== "public") {
        riskScore += 12;
        reasons.push("non-public wrapper mode requires audit receipts");
    }

    if (input.mode === "wrap_around_swap") {
        riskScore += 8;
        reasons.push("wrap mode stages both pre and post envelopes");
    }

    if (input.phase === "swap") {
        riskScore += 10;
        reasons.push("swap flow introduces routing and execution variability");
    }

    const routeHops = coerceNumericValue(input.payload.routeHops);
    if ((routeHops ?? 0) > 1) {
        riskScore += 4;
        reasons.push("multi-hop route increases observability review value");
    }

    const amountSignal =
        coerceNumericValue(input.payload.amountIn) ??
        coerceNumericValue(input.payload.amountInStroops) ??
        coerceNumericValue(input.payload.amount);
    if ((amountSignal ?? 0) >= 1_000_000) {
        riskScore += 10;
        reasons.push("larger amount signal escalates audit level");
    }

    if (input.relayerMode === "PROXY") {
        riskScore += 6;
        reasons.push("proxy relayer path requires additional operational traceability");
    }

    riskScore = Math.max(0, Math.min(100, riskScore));

    const auditLevel: AspAuditLevel = riskScore >= 28 ? "elevated" : "standard";
    const decision: AspPolicyDecision =
        input.mode === "public" && auditLevel === "standard"
            ? "allow"
            : "allow_with_audit";

    const policySource = stableStringify({
        phase: input.phase,
        mode: input.mode,
        auditLevel,
        riskScore,
        reasons,
        networkPassphrase: input.networkPassphrase,
        relayerMode: input.relayerMode,
    });
    const receiptDigest = await sha256Hex(policySource);

    return {
        receiptId: `asp-${Date.now().toString(36)}-${receiptDigest.slice(0, 10)}`,
        policyId: "spp-mainnet-safe-v1",
        phase: input.phase,
        mode: input.mode,
        decision,
        auditLevel,
        riskScore,
        reasons,
        settlementMode: "public",
        networkPassphrase: input.networkPassphrase,
        relayerMode: input.relayerMode,
        checkedAt,
    };
}

export async function executePrivacyStage(
    input: ExecutePrivacyStageInput,
): Promise<PrivacyExecutionArtifact> {
    const createdAt = new Date().toISOString();
    const redactedPayload = createRedactedPayload(input.payload);
    const fullPayloadDigest = await sha256Hex(stableStringify(input.payload));
    const redactedDigest = await sha256Hex(stableStringify(redactedPayload));
    const disclosureHandle = `disc-${Date.now().toString(36)}-${redactedDigest.slice(0, 10)}`;
    const disclosure = await sealPayload(input.payload);
    const commitmentSource = stableStringify({
        intentId: input.intentId,
        phase: input.phase,
        stage: input.stage,
        mode: input.mode,
        policyReceiptId: input.policyReceipt.receiptId,
        payloadDigest: fullPayloadDigest,
        redactedDigest,
        disclosureHandle,
    });
    const commitmentDigest = await sha256Hex(commitmentSource);
    const commitmentId = `commit-${commitmentDigest.slice(0, 16)}`;

    return {
        policyReceipt: input.policyReceipt,
        commitment: {
            commitmentId,
            intentId: input.intentId,
            phase: input.phase,
            stage: input.stage,
            mode: input.mode,
            settlementMode: "public",
            payloadDigest: fullPayloadDigest,
            redactedDigest,
            policyReceiptId: input.policyReceipt.receiptId,
            disclosureHandle,
            createdAt,
        },
        disclosure: {
            disclosureHandle,
            commitmentId,
            phase: input.phase,
            stage: input.stage,
            algorithm: disclosure.algorithm,
            ciphertext: disclosure.ciphertext,
            iv: disclosure.iv,
            keyFingerprint: disclosure.keyFingerprint,
            summary: summarizePayload(input.phase, redactedPayload),
            redactedPayload,
            fullPayloadDigest,
            createdAt,
        },
        settlement: createDefaultSettlementBinding(
            input.phase,
            input.payload,
            input.policyReceipt,
        ),
    };
}

export function updatePrivacySettlementBinding(
    input: UpdatePrivacySettlementInput,
): PrivacyExecutionArtifact {
    const current = input.artifact.settlement;
    const txHashRaw = input.txHash ?? current.txHash;
    const normalizedTxHash =
        typeof txHashRaw === "string" ? txHashRaw.trim().toLowerCase() : txHashRaw;
    // Only accept a txHash that looks like a real 64-hex-char Stellar transaction hash.
    const txHash =
        normalizedTxHash && /^[0-9a-f]{64}$/.test(normalizedTxHash)
            ? normalizedTxHash
            : current.txHash;
    const softSuccessReason =
        input.softSuccessReason ?? current.softSuccessReason ?? null;
    const settlementState =
        txHash && txHash.length > 0
            ? "confirmed"
            : softSuccessReason === "duplicate_nonce"
              ? "soft_success_unverified"
              : current.settlementState;
    const confirmedAt =
        settlementState === "confirmed"
            ? input.confirmedAt ?? current.confirmedAt ?? new Date().toISOString()
            : current.confirmedAt;
    const note =
        input.note ??
        (settlementState === "confirmed"
            ? "Bound to confirmed public mainnet transaction."
            : settlementState === "soft_success_unverified"
              ? "Duplicate nonce replay prevented; settlement was not independently re-confirmed in this client flow."
              : current.note);

    return {
        ...input.artifact,
        settlement: {
            ...current,
            txHash,
            confirmedAt,
            softSuccessReason,
            settlementState,
            note,
        },
    };
}

export function exportPrivacyExecutionJson(
    policies: AspPolicyReceipt[],
    artifacts: PrivacyExecutionArtifact[],
): string {
    return JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            policyCount: policies.length,
            artifactCount: artifacts.length,
            policies,
            artifacts,
        },
        null,
        2,
    );
}
