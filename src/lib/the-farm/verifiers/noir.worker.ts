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
    const valid = await verifier.verifyProof(proof);

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
