import { Account, Address, Contract, TransactionBuilder, TimeoutInfinite, rpc, xdr } from "@stellar/stellar-sdk/minimal";
import { Buffer } from "buffer";
import { MAINNET_NETWORK_PASSPHRASE, MAINNET_RPC_URL, FARM_ATTESTATIONS_CONTRACT_ID_MAINNET } from "../../../config/farmAttestation";
import { account as passkeyAccount } from "../../../utils/passkey-kit";
import { getSafeRpId } from "../../../utils/domains";
import { ensureBytes32Hex, hexToBytes } from "../digest";
import type { AttestationResult, ProofSystem, Tier } from "../types";

const { Api, Server, assembleTransaction } = rpc;
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

interface PublishAttestationInput {
  owner: string;
  keyId: string;
  system: ProofSystem;
  tier: Tier;
  statementHash: string;
  verifierHash: string;
}

function symbolForSystem(system: ProofSystem): string {
  switch (system) {
    case "circom":
      return "CIRCOM";
    case "noir":
      return "NOIR";
    case "risc0":
      return "RISC0";
  }
}

function symbolForTier(tier: Tier): string {
  switch (tier) {
    case "sprout":
      return "SPROUT";
    case "grower":
      return "GROWER";
    case "harvester":
      return "HARVEST";
    case "whale":
      return "WHALE";
    case "edge":
      return "EDGE";
    case "invalid":
      return "INVALID";
  }
}

function ensureMainnetConfig(): void {
  if (!MAINNET_RPC_URL.trim()) {
    throw new Error("Missing PUBLIC_MAINNET_RPC_URL");
  }
  if (!FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim()) {
    throw new Error("Missing PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET");
  }
}

function waitInterval(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const handle = globalThis.setInterval(() => {
      globalThis.clearInterval(handle);
      resolve();
    }, milliseconds);
  });
}

async function waitForTransaction(
  server: rpc.Server,
  hash: string,
): Promise<rpc.Api.GetTransactionResponse> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tx = await server.getTransaction(hash);
    if (tx.status === Api.GetTransactionStatus.SUCCESS || tx.status === Api.GetTransactionStatus.FAILED) {
      return tx;
    }
    await waitInterval(1200);
  }
  throw new Error("Mainnet attestation confirmation timed out");
}

export async function publishAttestationMainnet(
  input: PublishAttestationInput,
): Promise<AttestationResult> {
  try {
    ensureMainnetConfig();

    const statementHash = ensureBytes32Hex(input.statementHash);
    const verifierHash = ensureBytes32Hex(input.verifierHash);
    const server = new Server(MAINNET_RPC_URL);

    const contract = new Contract(FARM_ATTESTATIONS_CONTRACT_ID_MAINNET);
    const operation = contract.call(
      "attest",
      new Address(input.owner).toScVal(),
      xdr.ScVal.scvSymbol(symbolForSystem(input.system)),
      xdr.ScVal.scvSymbol(symbolForTier(input.tier)),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(statementHash))),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(verifierHash))),
    );

    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "1000000",
      networkPassphrase: MAINNET_NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(TimeoutInfinite)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    const preparedTx = assembleTransaction(tx, simulation).build();

    const kit = await passkeyAccount.get();
    if (!kit.wallet) {
      await kit.connectWallet({
        rpId: getSafeRpId(window.location.hostname),
        keyId: input.keyId,
        getContractId: async () => input.owner,
      });
    }

    const latestLedger = await server.getLatestLedger();
    const signed = await kit.sign(preparedTx, {
      rpId: getSafeRpId(window.location.hostname),
      keyId: input.keyId,
      expiration: latestLedger.sequence + 60,
    });

    const signedTx = signed?.built ?? signed;
    const sendResponse = await server.sendTransaction(signedTx);
    if (sendResponse.status === "ERROR") {
      throw new Error("Mainnet submission failed");
    }

    const txHash = sendResponse.hash;
    const confirmed = await waitForTransaction(server, txHash);
    if (confirmed.status !== Api.GetTransactionStatus.SUCCESS) {
      return {
        ok: false,
        txHash,
        error: "Mainnet attestation transaction failed",
      };
    }

    return {
      ok: true,
      txHash,
      ledger: confirmed.ledger,
      feeCharged: undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Mainnet attestation failed",
    };
  }
}
