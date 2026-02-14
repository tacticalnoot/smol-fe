import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const RPC_URL = process.env.MAINNET_RPC_URL || "https://mainnet.sorobanrpc.com";
const NETWORK_PASSPHRASE =
  process.env.MAINNET_NETWORK_PASSPHRASE || "Public Global Stellar Network ; September 2015";

const ADMIN_IDENTITY = process.env.ADMIN_IDENTITY || "batch-transfer-deployer";

const FARM_ATTESTATIONS_ID =
  process.env.FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ||
  process.env.PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ||
  "CDVJZSMI5KSRK7T6D6GGYVB6UPFCDQLAZAYRGXVJKDBOHLAZOPHHX2FR";

const CONTRACT_DIR = "contracts/ultrahonk-verifier";
const WASM_SOURCE = `${CONTRACT_DIR}/target/wasm32v1-none/release/ultrahonk_verifier.wasm`;
const WASM_OPTIMIZED = `${CONTRACT_DIR}/target/wasm32v1-none/release/ultrahonk_verifier.optimized.wasm`;

const VK_PATH = process.env.NOIR_VK_PATH || "zk/noir-tier/artifacts/vk";

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
}

function runInherit(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function parseContractId(output) {
  const m = output.match(/C[A-Z0-9]{55}/);
  return m ? m[0] : "";
}

function getIdentityPubkey(identity) {
  return run(`stellar keys public-key ${identity}`, { cwd: rootDir }).trim();
}

async function main() {
  console.log("Deploy: ultrahonk-verifier (mainnet)");
  console.log(`Admin identity: ${ADMIN_IDENTITY}`);
  console.log(`Farm attestations: ${FARM_ATTESTATIONS_ID}`);
  console.log(`VK path: ${VK_PATH}`);

  const adminPubkey = getIdentityPubkey(ADMIN_IDENTITY);
  console.log(`Admin pubkey: ${adminPubkey}`);

  const vkAbs = path.join(rootDir, VK_PATH);
  if (!fs.existsSync(vkAbs)) {
    throw new Error(`Missing VK file: ${vkAbs}`);
  }

  // 1) Build
  runInherit("cargo build --target wasm32v1-none --release", {
    cwd: path.join(rootDir, CONTRACT_DIR),
  });

  // 2) Optimize
  runInherit(`stellar contract optimize --wasm "${WASM_SOURCE}" --wasm-out "${WASM_OPTIMIZED}"`, {
    cwd: rootDir,
  });

  // 3) Deploy
  const deployOut = run(
    `stellar contract deploy --wasm "${WASM_OPTIMIZED}" --source ${ADMIN_IDENTITY} --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}"`,
    { cwd: rootDir },
  );
  const contractId = parseContractId(deployOut);
  if (!contractId) {
    throw new Error(`Failed to parse contract id from deploy output:\n${deployOut}`);
  }
  console.log(`Contract ID: ${contractId}`);

  // 4) Init admin
  runInherit(
    `stellar contract invoke --id ${contractId} --source-account ${ADMIN_IDENTITY} --send yes --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- init_admin --admin ${adminPubkey}`,
    { cwd: rootDir },
  );

  // 5) Set VK bytes (admin-only)
  runInherit(
    `stellar contract invoke --id ${contractId} --source-account ${ADMIN_IDENTITY} --send yes --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- set_vk --vk_bytes-file-path ${VK_PATH}`,
    { cwd: rootDir },
  );

  // 6) Configure farm-attestations verifier bridge (admin-only)
  runInherit(
    `stellar contract invoke --id ${FARM_ATTESTATIONS_ID} --source-account ${ADMIN_IDENTITY} --send yes --network mainnet --rpc-url ${RPC_URL} --network-passphrase "${NETWORK_PASSPHRASE}" -- set_ultrahonk_verifier --verifier ${contractId}`,
    { cwd: rootDir },
  );

  fs.writeFileSync(path.join(rootDir, "deployed-ultrahonk-verifier-id.txt"), `${contractId}\n`);

  console.log("\nDone.");
  console.log(`ultrahonk-verifier: ${contractId}`);
  console.log("Recorded to deployed-ultrahonk-verifier-id.txt");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

