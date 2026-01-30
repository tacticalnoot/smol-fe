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
    xdr,
} from "@stellar/stellar-sdk";

const { Server, Api, assembleTransaction } = rpc;

// RPC URL from environment or failover
const RPC_URL = import.meta.env.PUBLIC_RPC_URL || "https://rpc.ankr.com/stellar_soroban";

// Deployed batch transfer contract
const BATCH_CONTRACT_ID = "CAZ4E2ZSMWMJDZQWB2OLXHYISBN6VSWUV2GOUM7AQ4ZDM4KBWHGKLDKX";
const KALE_SAC_ID = import.meta.env.PUBLIC_KALE_SAC_ID;

export interface BatchTransfer {
    to: string;      // Recipient address
    amount: bigint;  // Amount in raw units (with decimals)
}

/**
 * Build a batch transfer transaction for KALE using the batch contract
 * 
 * @param from - The sender's contract address (C address)
 * @param transfers - Array of recipients and amounts
 * @param sequence - Optional sequence number (will fetch if not provided)
 * @returns XDR string of the assembled transaction ready for signing
 */
export async function buildBatchKaleTransfer(
    from: string,
    transfers: BatchTransfer[],
    sequence?: string | number
): Promise<string> {
    if (transfers.length === 0) {
        throw new Error("No transfers provided");
    }

    if (!KALE_SAC_ID) {
        throw new Error("KALE C-Contract ID (PUBLIC_KALE_SAC_ID) is missing");
    }

    const server = new Server(RPC_URL);

    // Get sequence if needed
    let seq: string | number;
    if (sequence !== undefined) {
        seq = sequence;
    } else {
        console.log("[BatchTransfer] Fetching sequence for", from);
        const accountResp = await server.getAccount(from);
        seq = accountResp.sequence;
    }

    const seqString = seq.toString();
    const sourceAccount = new Account(from, seqString);
    console.log(`[BatchTransfer] Building batch contract call: From ${from}, Transfers: ${transfers.length}, Contract: ${BATCH_CONTRACT_ID}`);

    const batchContract = new Contract(BATCH_CONTRACT_ID);

    // Build recipients and amounts as Soroban Vecs
    const recipientsScVal = xdr.ScVal.scvVec(
        transfers.map(t => nativeToScVal(new Address(t.to)))
    );
    // Use i128 for amounts as per contract definition in lib.rs
    const amountsScVal = xdr.ScVal.scvVec(
        transfers.map(t => nativeToScVal(t.amount, { type: "i128" }))
    );

    // Call batch_transfer(token, from, recipients, amounts)
    const batchCall = batchContract.call(
        "batch_transfer",
        nativeToScVal(new Address(KALE_SAC_ID)),     // token
        nativeToScVal(new Address(from)),            // from
        recipientsScVal,                             // recipients
        amountsScVal                                 // amounts
    );

    const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: "10000000", // 1 XLM max fee
        networkPassphrase: Networks.PUBLIC
    });

    const tx = txBuilder
        .addOperation(batchCall)
        .setTimeout(300)
        .build();

    console.log("[BatchTransfer] Simulating batch call...");

    const simResult = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simResult)) {
        console.error("[BatchTransfer] Simulation failed:", simResult.error);
        throw new Error(`Batch simulation failed: ${simResult.error}`);
    }

    // Diagnostics
    const successResult = simResult as Api.SimulateTransactionSuccessResponse;
    const cpu = successResult.cost?.cpuInsns ?? "unknown";
    const mem = successResult.cost?.memBytes ?? "unknown";
    const fee = successResult.minResourceFee;
    const resultXdrSize = successResult.results?.[0]?.xdr?.length ?? 0;

    console.log(`[BatchTransfer] Simulation successful (Diagnostics):`);
    console.log(`   - CPU Instructions: ${cpu}`);
    console.log(`   - Memory Bytes: ${mem}`);
    console.log(`   - Min Resource Fee: ${fee}`);
    console.log(`   - Result XDR Size: ${resultXdrSize}`);
    console.log(`   - Events: ${successResult.events?.length ?? 0}`);

    if (parseInt(fee) > 10000000) {
        console.warn(`[BatchTransfer] WARNING: Fee ${fee} exceeds standard 1 XLM limit!`);
    }

    console.log("[BatchTransfer] Assembling final transaction...");

    const finalTx = assembleTransaction(tx, simResult).build();
    const finalXdr = finalTx.toXDR();

    console.log(`[BatchTransfer] Ready. Final XDR Length: ${finalXdr.length}`);
    return finalXdr;
}
