import { UltraHonkBackend } from "@aztec/bb.js";
import type { VerificationResult } from "../types";

type NoirProofPayload = {
  proofBase64: string;
  publicInputs: string[];
};

let backend: UltraHonkBackend | null = null;
let backendBytecode = "";

function decodeBase64(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Noir verifier bytecode is gzip-compressed, but DecompressionStream is unavailable in this browser.",
    );
  }

  const ds = new DecompressionStream("gzip");
  const safe = new Uint8Array(bytes) as unknown as Uint8Array<ArrayBuffer>;
  const stream = new Blob([safe]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function getBackend(bytecodeGzipBase64: string): Promise<UltraHonkBackend> {
  if (!backend || backendBytecode !== bytecodeGzipBase64) {
    if (backend) {
      await backend.destroy();
    }

    const rawBytes = decodeBase64(bytecodeGzipBase64);
    const bytecode = isGzip(rawBytes) ? await gunzip(rawBytes) : rawBytes;

    backend = new UltraHonkBackend(bytecode, { threads: 1 });
    backendBytecode = bytecodeGzipBase64;
  }
  return backend;
}

export function preloadNoirVerifier(bytecode: string): void {
  void getBackend(bytecode).catch(() => {
    // Fallback happens in verify call; preload failure is non-fatal.
  });
}

export async function verifyNoirProof(
  bytecode: string,
  proof: unknown,
): Promise<VerificationResult> {
  const payload = proof as Partial<NoirProofPayload> | null;
  if (!payload?.proofBase64 || !Array.isArray(payload.publicInputs)) {
    return {
      valid: false,
      durationMs: 0,
      error: "Malformed Noir proof payload",
    };
  }

  const startedAt = performance.now();

  try {
    const verifier = await getBackend(bytecode);
    const valid = await verifier.verifyProof(decodeBase64(payload.proofBase64));
    return {
      valid,
      durationMs: Math.round(performance.now() - startedAt),
      error: valid ? undefined : "Noir verification returned false",
    };
  } catch (error) {
    return {
      valid: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Noir verification failed",
    };
  }
}
