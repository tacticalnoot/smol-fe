/**
 * Batch Transfer via Soroban Contract
 * 
 * Calls the deployed batch transfer contract to send KALE to multiple
 * recipients in a single transaction with one signature.
 * 
 * Contract: CAZ4E2ZSMWMJDZQWB2OLXHYISBN6VSWUV2GOUM7AQ4ZDM4KBWHGKLDKX
 */

import {
    Contract,
    Address,
    nativeToScVal,
    TransactionBuilder,
    Networks,
    Account,
    rpc,
    xdr
} from "@stellar/stellar-sdk";

const { Server, Api, assembleTransaction } = rpc;

// RPC URL from environment
const RPC_URL = import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";

// Deployed batch transfer contract on mainnet
const BATCH_CONTRACT_ID = "CAZ4E2ZSMWMJDZQWB2OLXHYISBN6VSWUV2GOUM7AQ4ZDM4KBWHGKLDKX";
const KALE_CONTRACT = import.meta.env.PUBLIC_KALE_SAC_ID;
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface BatchTransfer {
    to: string;      // Recipient address
    amount: bigint;  // Amount in raw units (with decimals)
}

/**
 * Build a batch transfer transaction for KALE using the batch contract
 * 
 * @param from - The sender's contract address (C address)
 * @param transfers - Array of recipients and amounts
 * @returns XDR string of the assembled transaction ready for signing
 */
export async function buildBatchKaleTransfer(
    from: string,
    transfers: BatchTransfer[]
): Promise<string> {
    if (transfers.length === 0) {
        throw new Error("No transfers provided");
    }

    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0n);
    console.log("[BatchTransfer] Building batch via contract:", {
        from,
        transferCount: transfers.length,
        totalAmount: totalAmount.toString(),
        contract: BATCH_CONTRACT_ID
    });

    const server = new Server(RPC_URL);
    const batchContract = new Contract(BATCH_CONTRACT_ID);
    const sourceAccount = new Account(NULL_ACCOUNT, "0");

    // Build recipients and amounts as Soroban Vec
    const recipientsScVal = xdr.ScVal.scvVec(
        transfers.map(t => nativeToScVal(new Address(t.to)))
    );
    const amountsScVal = xdr.ScVal.scvVec(
        transfers.map(t => nativeToScVal(t.amount, { type: "i128" }))
    );

    // Call batch_transfer(token, from, recipients, amounts)
    const batchCall = batchContract.call(
        "batch_transfer",
        nativeToScVal(new Address(KALE_CONTRACT)),  // token
        nativeToScVal(new Address(from)),            // from
        recipientsScVal,                              // recipients
        amountsScVal                                  // amounts
    );

    const tx = new TransactionBuilder(sourceAccount, {
        fee: "10000000",  // 1 XLM max fee (will be refunded)
        networkPassphrase: Networks.PUBLIC
    })
        .addOperation(batchCall)
        .setTimeout(300)
        .build();

    console.log("[BatchTransfer] Simulating batch contract call...");

    // Simulate to get auth requirements
    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        console.error("[BatchTransfer] Simulation failed:", simResult.error);
        throw new Error(`Batch simulation failed: ${simResult.error}`);
    }

    console.log("[BatchTransfer] Simulation successful, assembling...");
    const finalTx = assembleTransaction(tx, simResult).build();
    const finalXdr = finalTx.toXDR();

    console.log("[BatchTransfer] Batch transaction ready:", {
        recipients: transfers.length,
        xdrLength: finalXdr.length
    });

    return finalXdr;
}
