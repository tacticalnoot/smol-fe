import { readFileSync } from 'fs';
import pkg from '@stellar/stellar-sdk';
const { Keypair, Contract, rpc, TransactionBuilder, Networks, xdr, Address, nativeToScVal } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Constants
const VKEY_PATH = "public/zk/verification_key.json";
const CONTRACT_ID_PATH = "deployed-contract-id.txt";
const SECRET_PATH = "deployer_secret.txt";
const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE = Networks.PUBLIC;

// ============================================================================
// Serialization Helpers
// ============================================================================

function bigintToBytes32(value) {
    const bytes = new Uint8Array(32);
    let v = BigInt(value);
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

function serializeG1(point) {
    const x = BigInt(point[0]);
    const y = BigInt(point[1]);
    const result = new Uint8Array(64);
    result.set(bigintToBytes32(x), 0);
    result.set(bigintToBytes32(y), 32);
    return result;
}

function serializeG2(point) {
    const x_c1 = BigInt(point[0][0]);
    const x_c0 = BigInt(point[0][1]);
    const y_c1 = BigInt(point[1][0]);
    const y_c0 = BigInt(point[1][1]);
    const result = new Uint8Array(128);
    result.set(bigintToBytes32(x_c1), 0);
    result.set(bigintToBytes32(x_c0), 32);
    result.set(bigintToBytes32(y_c1), 64);
    result.set(bigintToBytes32(y_c0), 96);
    return result;
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
    console.log("🔐 Starting SDK Initialization (Sorted nativeToScVal)...");

    // 1. Load Secrets & Config
    const secret = readFileSync(path.join(rootDir, SECRET_PATH), 'utf8').trim();
    if (!secret) throw new Error("Deployer secret not found");
    const kp = Keypair.fromSecret(secret);

    const contractId = readFileSync(path.join(rootDir, CONTRACT_ID_PATH), 'utf8').trim();
    if (!contractId) throw new Error("Contract ID not found");

    console.log(`Identity: ${kp.publicKey()}`);
    console.log(`Contract: ${contractId}`);

    // 2. Load VKey and Serialize
    const vkeyRaw = JSON.parse(readFileSync(path.join(rootDir, VKEY_PATH), 'utf8'));

    const alpha_g1_bytes = serializeG1(vkeyRaw.vk_alpha_1);
    const beta_g2_bytes = serializeG2(vkeyRaw.vk_beta_2);
    const gamma_g2_bytes = serializeG2(vkeyRaw.vk_gamma_2);
    const delta_g2_bytes = serializeG2(vkeyRaw.vk_delta_2);
    const ic_bytes_array = vkeyRaw.IC.map(point => serializeG1(point));

    // 3. Build ScVal using nativeToScVal (explicitly sorted keys)
    // Order: alpha, beta, delta, gamma, ic
    const vkeyObj = {
        alpha_g1: alpha_g1_bytes,
        beta_g2: beta_g2_bytes,
        delta_g2: delta_g2_bytes, // D comes before G
        gamma_g2: gamma_g2_bytes,
        ic: ic_bytes_array
    };

    console.log("Keys in object:", Object.keys(vkeyObj));

    let vkeyScVal;
    try {
        vkeyScVal = nativeToScVal(vkeyObj);
    } catch (e) {
        console.error("nativeToScVal failed:", e);
        throw e;
    }

    // 4. Build Transaction
    const server = new rpc.Server(RPC_URL);
    const account = await server.getAccount(kp.publicKey());

    const contract = new Contract(contractId);

    const op = contract.call("initialize",
        new Address(kp.publicKey()).toScVal(), // admin
        vkeyScVal // vkey
    );

    const tx = new TransactionBuilder(account, {
        fee: "100000", // 0.01 XLM
        networkPassphrase: NETWORK_PASSPHRASE
    })
        .addOperation(op)
        .setTimeout(30)
        .build();

    tx.sign(kp);

    // 5. Simulate & Send
    console.log("Simulating...");
    const sim = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) {
        console.error("❌ Simulation Failed:", JSON.stringify(sim, null, 2));
        process.exit(1);
    }

    console.log("Simulation Successful. Resources cost:", sim.minResourceFee);

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(kp);
    console.log("Submitting...");
    const result = await server.sendTransaction(preparedTx);

    if (result.status !== "PENDING") {
        console.error("❌ Submission Failed:", result);
        process.exit(1);
    }

    console.log(`✅ Transaction sent! Hash: ${result.hash}`);

    console.log("Waiting for confirmation...");
    let status = await server.getTransaction(result.hash);
    let retries = 0;
    while (status.status === "NOT_FOUND" && retries < 20) {
        await new Promise(r => setTimeout(r, 2000));
        status = await server.getTransaction(result.hash);
        retries++;
    }

    if (status.status === "SUCCESS") {
        console.log("✅ Initialization confirmed on-chain.");
        console.log(`\n🎉 CONTRACT INITIALIZED: ${contractId}`);
    } else {
        console.warn("⚠️  Transaction status:", status.status);
    }
}

main().catch(err => {
    console.error("Script Error:", err);
    process.exit(1);
});
