import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Existing mainnet farm-attestations contract (SSOT, used by the app default config).
const DEFAULT_CONTRACT_ID =
  process.env.FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ||
  process.env.PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ||
  "CDVJZSMI5KSRK7T6D6GGYVB6UPFCDQLAZAYRGXVJKDBOHLAZOPHHX2FR";

// IMPORTANT: this is the current on-chain admin for the default contract ID (queried via `admin()`).
const DEFAULT_UPGRADER_IDENTITY = process.env.UPGRADER_IDENTITY || "batch-transfer-deployer";

const RPC_URL = process.env.MAINNET_RPC_URL || "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE =
  process.env.MAINNET_NETWORK_PASSPHRASE || "Public Global Stellar Network ; September 2015";

const CONTRACT_DIR = "contracts/farm-attestations";
const WASM_SOURCE = `${CONTRACT_DIR}/target/wasm32v1-none/release/farm_attestations.wasm`;
const WASM_OPTIMIZED = `${CONTRACT_DIR}/target/wasm32v1-none/release/farm_attestations.optimized.wasm`;

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
}

function runInherit(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function parseHash(output) {
  const m = output.match(/[a-f0-9]{64}/);
  if (m) return m[0];
  const last = output.trim().split("\n").pop().trim();
  return last.length === 64 ? last : "";
}

function getIdentityPubkey(identity) {
  return run(`stellar keys public-key ${identity}`, { cwd: rootDir }).trim();
}

function getContractAdmin(contractId, identityForSim) {
  const out = run(
    `stellar contract invoke --id ${contractId} --source-account ${identityForSim} --send no --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- admin`,
    { cwd: rootDir },
  ).trim();
  return out.replaceAll('"', "").trim();
}

async function main() {
  const contractId = DEFAULT_CONTRACT_ID;
  const upgraderIdentity = DEFAULT_UPGRADER_IDENTITY;

  console.log("Upgrade: farm-attestations (mainnet)");
  console.log(`Contract ID: ${contractId}`);
  console.log(`Upgrader identity: ${upgraderIdentity}`);

  const upgraderPubkey = getIdentityPubkey(upgraderIdentity);
  console.log(`Upgrader pubkey: ${upgraderPubkey}`);

  const onchainAdmin = getContractAdmin(contractId, upgraderIdentity);
  console.log(`On-chain admin: ${onchainAdmin}`);

  if (onchainAdmin !== upgraderPubkey) {
    console.error("\nRefusing to upgrade: local identity is not the on-chain admin.");
    console.error("Fix: set UPGRADER_IDENTITY to the identity controlling the admin address.");
    process.exit(1);
  }

  // 1) Build
  runInherit("cargo build --target wasm32v1-none --release", {
    cwd: path.join(rootDir, CONTRACT_DIR),
  });

  // 2) Optimize
  runInherit(`stellar contract optimize --wasm "${WASM_SOURCE}" --wasm-out "${WASM_OPTIMIZED}"`, {
    cwd: rootDir,
  });

  // 3) Install new wasm
  let installOut;
  try {
    installOut = run(
      `stellar contract install --wasm "${WASM_OPTIMIZED}" --source ${upgraderIdentity} --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}"`,
      { cwd: rootDir },
    );
  } catch (e) {
    console.error("\nInstall failed.");
    console.error(String(e?.stdout || e?.message || e));
    console.error("\nMost common cause: the upgrader account needs more XLM on mainnet.");
    console.error(`Fund: ${upgraderPubkey}`);
    process.exit(1);
  }

  const wasmHash = parseHash(installOut);
  if (!wasmHash) {
    console.error("Failed to parse wasm hash from install output.");
    process.exit(1);
  }
  console.log(`WASM hash: ${wasmHash}`);

  // 4) Upgrade (writes ledger, must send)
  try {
    runInherit(
      `stellar contract invoke --id ${contractId} --source-account ${upgraderIdentity} --send yes --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- upgrade --new_wasm_hash ${wasmHash}`,
      { cwd: rootDir },
    );
  } catch (e) {
    console.error("\nUpgrade invoke failed.");
    console.error(String(e?.stdout || e?.message || e));
    process.exit(1);
  }

  console.log("\nUpgrade complete.");
  console.log("Next steps:");
  console.log("1) Register VK(s): `node scripts/register-risc0-groth16-vk-mainnet.mjs`");
  console.log("2) Then Room 3 can do trustless on-chain verification via farm-attestations.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

