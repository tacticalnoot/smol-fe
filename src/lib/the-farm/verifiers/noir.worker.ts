import { UltraHonkBackend } from "@aztec/bb.js";
import type { VerificationResult } from "../types";

type WorkerRequest =
  | {
      id: number;
      type: "preload";
      payload: {
        bytecode: string;
      };
    }
  | {
      id: number;
      type: "verify";
      payload: {
        bytecode: string;
        proofBase64: string;
        publicInputs: string[];
      };
    };

type WorkerResponse = {
  id: number;
  result: VerificationResult;
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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const startedAt = performance.now();

  try {
    if (request.type === "preload") {
      await getBackend(request.payload.bytecode);
      const response: WorkerResponse = {
        id: request.id,
        result: {
          valid: true,
          durationMs: Math.round(performance.now() - startedAt),
        },
      };
      self.postMessage(response);
      return;
    }

    const verifier = await getBackend(request.payload.bytecode);
    const proof = decodeBase64(request.payload.proofBase64);
    const valid = await verifier.verifyProof({
      proof,
      publicInputs: request.payload.publicInputs,
    });

    const response: WorkerResponse = {
      id: request.id,
      result: {
        valid,
        durationMs: Math.round(performance.now() - startedAt),
        error: valid ? undefined : "Noir verification returned false",
      },
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      result: {
        valid: false,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : "Noir verification failed",
      },
    };
    self.postMessage(response);
  }
};
