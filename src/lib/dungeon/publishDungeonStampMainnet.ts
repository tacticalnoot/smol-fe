import { Account, Address, Contract, Networks, TransactionBuilder, TimeoutInfinite, rpc, xdr } from "@stellar/stellar-sdk/minimal";
import { Buffer } from "buffer";
import { FARM_ATTESTATIONS_CONTRACT_ID_MAINNET, MAINNET_NETWORK_PASSPHRASE, MAINNET_RPC_URL } from "../../config/farmAttestation";
import { ensureBytes32Hex, hexToBytes } from "../the-farm/digest";
import { getRpcUrl } from "../../utils/rpc";

const { Api, Server, assembleTransaction } = rpc;
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type DungeonStampKind = "ENTRY" | "WITHDRAWAL";

export type DungeonStampResult =
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
  // Soroban symbols are ASCII-ish, short identifiers.
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
  throw new Error("Dungeon stamp confirmation timed out");
}

/**
 * Mainnet passkey-signed audit stamp, recorded to the existing Farm Attestations contract.
 *
 * This is a digest-only record: it does NOT claim on-chain proof verification.
 *
 * Tx pipeline: simulate -> assemble -> passkey sign/send via the repo's canonical `signAndSend`
 * helper (same flow used by other Labs tx UIs like Kale-or-Fail / tip paths).
 */
export async function publishDungeonStampMainnet(input: {
  owner: string; // passkey smart account contractId
  keyId: string; // passkey keyId (base64)
  kind: DungeonStampKind;
  statementHash: string; // 32-byte hex
  verifierHash: string; // 32-byte hex
  onStage?: (stage: "simulating" | "assembling" | "signing" | "submitted" | "confirmed") => void;
}): Promise<DungeonStampResult> {
  try {
    const contractId = FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim();
    if (!contractId) {
      throw new Error("Missing Farm Attestations contract ID (mainnet)");
    }

    const rpcUrl = resolveSorobanRpcUrl();
    if (!rpcUrl) {
      throw new Error("Soroban RPC URL not configured. Set PUBLIC_RPC_URL (or PUBLIC_MAINNET_RPC_URL).");
    }

    const statementHash = ensureBytes32Hex(input.statementHash);
    const verifierHash = ensureBytes32Hex(input.verifierHash);

    const server = new Server(rpcUrl);
    const contract = new Contract(contractId);

    // We store dungeon stamps as: system="DUNGEON", tier="ENTRY"|"WITHDRAW".
    const operation = contract.call(
      "attest",
      new Address(input.owner).toScVal(),
      symbol("DUNGEON"),
      symbol(input.kind === "ENTRY" ? "ENTRY" : "WITHDRAW"),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(statementHash))),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(verifierHash))),
    );

    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "10000000", // 1 XLM max for mainnet reliability
      networkPassphrase: MAINNET_NETWORK_PASSPHRASE || Networks.PUBLIC,
    })
      .addOperation(operation)
      .setTimeout(TimeoutInfinite)
      .build();

    input.onStage?.("simulating");
    const sim = await server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    input.onStage?.("assembling");
    const preparedTx = assembleTransaction(tx, sim).build();

    // Reuse canonical PasskeyKit relayer flow.
    const { signAndSend } = await import("../../utils/transaction-helpers");
    input.onStage?.("signing");
    const result = await signAndSend(preparedTx, {
      keyId: input.keyId,
      contractId: input.owner,
      turnstileToken: "",
      updateBalance: true,
    });

    if (!result.success) {
      throw new Error(result.error || "Dungeon stamp failed");
    }

    const { extractTxHashFromRelayerResponse } = await import("../../utils/transaction-helpers");
    const txHash =
      result.transactionHash ||
      extractTxHashFromRelayerResponse(result.result) ||
      extractTxHashFromRelayerResponse(result);
    if (!txHash) {
      throw new Error(`Relayer success but no hash discovered in result: ${JSON.stringify(result.result)}`);
    }

    input.onStage?.("submitted");
    const confirmed = await waitForTransaction(server, txHash);
    if (confirmed.status !== Api.GetTransactionStatus.SUCCESS) {
      return { ok: false, txHash, error: "Dungeon stamp transaction failed" };
    }

    input.onStage?.("confirmed");
    return { ok: true, txHash, ledger: confirmed.ledger };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Dungeon stamp failed" };
  }
}
