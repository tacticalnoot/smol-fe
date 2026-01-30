/**
 * Batch Transfer Builder
 * 
 * Builds a single transaction with multiple KALE transfer operations.
 * This allows tipping multiple artists with one signature instead of many.
 */

import {
    Contract,
    Address,
    nativeToScVal,
    TransactionBuilder,
    Networks,
    Account,
    rpc
} from "@stellar/stellar-sdk";
const { Server, Api, assembleTransaction } = rpc;

const RPC_URL = import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";
const KALE_CONTRACT = import.meta.env.PUBLIC_KALE_SAC_ID;
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface BatchTransfer {
    to: string;      // Recipient address
    amount: bigint;  // Amount in raw units (with decimals)
}

/**
 * Build a batch transfer transaction for KALE
 * 
 * @param from - The sender's contract address (C address)
 * @param transfers - Array of recipients and amounts
 * @returns XDR string of the assembled transaction
 */
export async function buildBatchKaleTransfer(
    from: string,
    transfers: BatchTransfer[]
): Promise<string> {
    if (transfers.length === 0) {
        throw new Error("No transfers provided");
    }

    console.log("[BatchTransfer] Building batch transfer:", {
        from,
        transferCount: transfers.length,
        totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0n).toString()
    });

    const server = new Server(RPC_URL);
    const contract = new Contract(KALE_CONTRACT);
    const sourceAccount = new Account(NULL_ACCOUNT, "0");

    // Build transaction with all transfer operations
    let builder = new TransactionBuilder(sourceAccount, {
        fee: (10000000 * transfers.length).toString(), // Scale fee with operations
        networkPassphrase: Networks.PUBLIC
    });

    // Add each transfer as a separate operation
    for (const transfer of transfers) {
        const transferOp = contract.call(
            "transfer",
            nativeToScVal(new Address(from)),           // from
            nativeToScVal(new Address(transfer.to)),    // to
            nativeToScVal(transfer.amount, { type: "i128" }) // amount
        );
        builder = builder.addOperation(transferOp);
    }

    const tx = builder.setTimeout(300).build();
    const preSimXdr = tx.toXDR();

    console.log("[BatchTransfer] Pre-simulation XDR built, simulating...");

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
        operations: transfers.length,
        xdrLength: finalXdr.length
    });

    return finalXdr;
}
