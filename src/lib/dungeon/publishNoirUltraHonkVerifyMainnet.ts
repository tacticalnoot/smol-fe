import { Account, Address, Contract, Networks, TransactionBuilder, TimeoutInfinite, rpc, xdr } from "@stellar/stellar-sdk/minimal";
import { Buffer } from "buffer";
import { FARM_ATTESTATIONS_CONTRACT_ID_MAINNET, MAINNET_NETWORK_PASSPHRASE, MAINNET_RPC_URL } from "../../config/farmAttestation";
import { ensureBytes32Hex, hexToBytes } from "../the-farm/digest";
import { getRpcUrl } from "../../utils/rpc";
import { noirSamples } from "../../data/the-farm/noirBundle";

const { Api, Server, assembleTransaction } = rpc;
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type NoirUltraHonkOnchainResult =
  | { ok: true; txHash: string; ledger?: number }
  | { ok: false; error: string; txHash?: string };

function resolveSorobanRpcUrl(): string {
  const fromEnv = MAINNET_RPC_URL.trim();
  if (fromEnv) return fromEnv;

  try {
    const selected = (getRpcUrl?.() ?? "").trim();
    if (selected) return selected;
  } catch {
    // Ignore selector errors.
  }

  const fallback = (import.meta.env.PUBLIC_RPC_URL ?? "").trim();
  if (fallback) return fallback;

  return "";
}

function symbol(value: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(value);
}

async function waitInterval(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const handle = globalThis.setInterval(() => {
      globalThis.clearInterval(handle);
      resolve();
    }, milliseconds);
  });
}

async function waitForTransaction(server: rpc.Server, hash: string): Promise<rpc.Api.GetTransactionResponse> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tx = await server.getTransaction(hash);
    if (tx.status === Api.GetTransactionStatus.SUCCESS || tx.status === Api.GetTransactionStatus.FAILED) {
      return tx;
    }
    await waitInterval(1200);
  }
  throw new Error("Noir UltraHonk on-chain verification confirmation timed out");
}

function tierIdToSampleTier(tierId: number): "sprout" | "grower" | "harvester" | "whale" {
  if (tierId <= 0) return "sprout";
  if (tierId === 1) return "grower";
  if (tierId === 2) return "harvester";
  return "whale";
}

function concatPublicInputsBytes(publicInputsHex: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const hex of publicInputsHex) {
    parts.push(Buffer.from(hexToBytes(ensureBytes32Hex(hex))));
  }
  return Buffer.concat(parts);
}

/**
 * Mainnet passkey-signed, *on-chain proof verification* for Noir UltraHonk proofs.
 *
 * IMPORTANT:
 * - Uses a training sample proof artifact (cryptographically real), not yet bound to the live dungeon run inputs.
 * - Verification is performed on-chain via: farm-attestations -> (configured) ultrahonk-verifier contract.
 */
export async function publishNoirUltraHonkVerifyMainnet(input: {
  owner: string; // passkey smart account contractId
  keyId: string; // passkey keyId (base64)
  tierId: number; // selects training artifact
  onStage?: (stage: "simulating" | "assembling" | "signing" | "submitted" | "confirmed") => void;
}): Promise<NoirUltraHonkOnchainResult> {
  try {
    const rpcUrl = resolveSorobanRpcUrl();
    if (!rpcUrl) {
      throw new Error("Soroban RPC URL not configured. Set PUBLIC_RPC_URL (or PUBLIC_MAINNET_RPC_URL).");
    }

    const farmId = FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim();
    if (!farmId) {
      throw new Error("Missing Farm Attestations contract ID (mainnet)");
    }

    const tier = tierIdToSampleTier(input.tierId);
    const sample =
      noirSamples.find((s) => s.tier === tier && s.expectedValid) ??
      noirSamples.find((s) => s.expectedValid);
    if (!sample) {
      throw new Error("No Noir sample proof available");
    }

    const proofBase64 = String((sample as any)?.proof?.proofBase64 ?? "");
    const publicInputsHex: string[] = Array.isArray((sample as any)?.proof?.publicInputs)
      ? ((sample as any).proof.publicInputs as string[])
      : Array.isArray((sample as any)?.publicInputs)
        ? ((sample as any).publicInputs as string[])
        : [];

    if (!proofBase64) {
      throw new Error("Noir sample missing proofBase64");
    }
    if (publicInputsHex.length === 0) {
      throw new Error("Noir sample missing publicInputs");
    }

    const statementHash = ensureBytes32Hex(String((sample as any)?.commitmentDigest ?? publicInputsHex[1] ?? ""));
    const verifierHash = ensureBytes32Hex(String((sample as any)?.verifierDigest ?? ""));

    const proofBytes = Buffer.from(proofBase64, "base64");
    const publicInputsBytes = concatPublicInputsBytes(publicInputsHex);

    const server = new Server(rpcUrl);
    const farm = new Contract(farmId);

    const op = farm.call(
      "verify_ultrahonk_and_attest",
      new Address(input.owner).toScVal(),
      symbol("NOIR"),
      symbol(tier.toUpperCase()),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(statementHash))),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(verifierHash))),
      xdr.ScVal.scvBytes(publicInputsBytes),
      xdr.ScVal.scvBytes(proofBytes),
    );

    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "10000000",
      networkPassphrase: MAINNET_NETWORK_PASSPHRASE || Networks.PUBLIC,
    })
      .addOperation(op)
      .setTimeout(TimeoutInfinite)
      .build();

    input.onStage?.("simulating");
    const sim = await server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    input.onStage?.("assembling");
    const preparedTx = assembleTransaction(tx, sim).build();

    const { signAndSend } = await import("../../utils/transaction-helpers");
    input.onStage?.("signing");
    const result = await signAndSend(preparedTx, {
      keyId: input.keyId,
      contractId: input.owner,
      turnstileToken: "",
      updateBalance: true,
    });

    if (!result.success) {
      throw new Error(result.error || "Noir UltraHonk on-chain verification failed");
    }

    const txHash =
      result.transactionHash ||
      result.result?.hash ||
      result.result?.transactionHash ||
      result.result?.txHash ||
      result.result?.data?.hash ||
      result.result?.data?.transactionHash;
    if (!txHash) {
      throw new Error(`Relayer success but no hash discovered in result: ${JSON.stringify(result.result)}`);
    }

    input.onStage?.("submitted");
    const confirmed = await waitForTransaction(server, txHash);
    if (confirmed.status !== Api.GetTransactionStatus.SUCCESS) {
      return { ok: false, txHash, error: "Noir UltraHonk on-chain verification transaction failed" };
    }

    input.onStage?.("confirmed");
    return { ok: true, txHash, ledger: confirmed.ledger };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Noir UltraHonk on-chain verification failed" };
  }
}

