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

async function getBackend(bytecode: string): Promise<UltraHonkBackend> {
  if (!backend || backendBytecode !== bytecode) {
    if (backend) {
      await backend.destroy();
    }
    backend = new UltraHonkBackend(bytecode, { threads: 1 });
    backendBytecode = bytecode;
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
    const valid = await verifier.verifyProof({
      proof: decodeBase64(payload.proofBase64),
      publicInputs: payload.publicInputs,
    });
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
