
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Constants
const CONTRACT_ID = "CDLA6S76Q362EWX5NF232AFFMHAANI3QPXI4W67YCRMS2FKV6E64AGL6";
const WASM_PATH = "contracts/tier-verifier/target/wasm32-unknown-unknown/release/tier_verifier.optimized.wasm";

async function main() {
    console.log("🔍 Starting deployment process...");

    // 1. Get Key
    let secretKey;
    try {
        const extractKeyPath = path.join(rootDir, 'extract_key.py');
        console.log(`🔑 Extracting key using: ${extractKeyPath}`);

        // Ensure we run from root
        const output = execSync(`python "${extractKeyPath}"`, { encoding: 'utf8', cwd: rootDir });

        if (output.includes("SECRET:")) {
            secretKey = output.match(/SECRET:(S[A-Z0-9]+)/)[1];
            console.log("✅ Key derived successfully.");
        } else {
            throw new Error("Could not derive key via Python. Output: " + output);
        }
    } catch (e) {
        console.error("❌ Failed to derive key:", e.message);
        if (e.stdout) console.log("STDOUT:", e.stdout.toString());
        if (e.stderr) console.error("STDERR:", e.stderr.toString());
        process.exit(1);
    }

    // 2. Optimize WASM
    console.log("\n🔨 Optimizing WASM...");
    try {
        // Must run cargo build first if not built? Assume user built or we build.
        // Let's safe-guard by running build if wasm missing? No, user might not have cargo.
        // But we are in dev environment.
        // Let's proceed with optimize.
        execSync("soroban contract optimize --wasm contracts/tier-verifier/target/wasm32-unknown-unknown/release/tier_verifier.wasm --wasm-out contracts/tier-verifier/target/wasm32-unknown-unknown/release/tier_verifier.optimized.wasm", { stdio: 'inherit', cwd: rootDir });
    } catch (e) {
        console.error("❌ Optimization failed. Ensure soroban-cli is installed.");
        process.exit(1);
    }

    const optimizedPath = "contracts/tier-verifier/target/wasm32-unknown-unknown/release/tier_verifier.optimized.wasm";

    // 3. Install WASM
    console.log("\n📤 Installing WASM to Mainnet...");
    const installCmd = `soroban contract install --wasm "${optimizedPath}" --network mainnet --source "${secretKey}"`;

    let newWasmHash;
    try {
        console.log(`> soroban contract install ...`);
        const installOutput = execSync(installCmd, { encoding: 'utf8', cwd: rootDir });
        // console.log(installOutput);

        const hashMatch = installOutput.match(/Hash:\s*([a-f0-9]{64})/i) || installOutput.match(/wasm_hash\s*([a-f0-9]{64})/i);
        const alreadyInstalledMatch = installOutput.match(/already installed[:\s]+([a-f0-9]{64})/i);

        if (hashMatch) newWasmHash = hashMatch[1];
        else if (alreadyInstalledMatch) newWasmHash = alreadyInstalledMatch[1];
        else throw new Error("Could not parse WASM Hash from output. Output: " + installOutput);

        console.log(`✅ WASM Installed. Hash: ${newWasmHash}`);
    } catch (e) {
        // If standard error contains "already installed", sometimes output is in stderr?
        if (e.stderr && e.stderr.toString().includes("already installed")) {
            const match = e.stderr.toString().match(/already installed[:\s]+([a-f0-9]{64})/i);
            if (match) {
                newWasmHash = match[1];
                console.log(`✅ WASM Already Installed. Hash: ${newWasmHash}`);
            } else {
                console.error("❌ Install failed (already installed but no hash found):", e.stderr.toString());
                process.exit(1);
            }
        } else {
            console.error("❌ Install failed:", e.message);
            if (e.stderr) console.error(e.stderr.toString());
            process.exit(1);
        }
    }

    // 4. Upgrade Contract
    console.log("\n🚀 Upgrading Contract...");
    try {
        const upgradeCmd = `soroban contract invoke --id ${CONTRACT_ID} --network mainnet --source "${secretKey}" -- upgrade --new_wasm_hash ${newWasmHash}`;
        console.log(`> soroban contract invoke ... upgrade ...`);
        execSync(upgradeCmd, { stdio: 'inherit', cwd: rootDir });
        console.log("✅ Contract Upgraded!");
    } catch (e) {
        console.error("❌ Upgrade failed:", e.message);
        process.exit(1);
    }

    // 5. Set Verification Key
    console.log("\n🔐 Setting Verification Key...");
    try {
        const formatVkeyPath = path.join(rootDir, 'format_vkey.py');
        const vkeyCmdOutput = execSync(`python "${formatVkeyPath}"`, { encoding: 'utf8', cwd: rootDir });
        const cmdLines = vkeyCmdOutput.split('\n');
        const cmdStart = cmdLines.findIndex(l => l.includes("soroban contract invoke"));
        if (cmdStart === -1) {
            throw new Error("Could not generate vkey command from format_vkey.py");
        }

        let fullVkeyCmd = cmdLines.slice(cmdStart).join("\n").replace(/<YOUR_SECRET_KEY>/g, secretKey).trim();
        fullVkeyCmd = fullVkeyCmd.replace(/\\\n/g, " ").replace(/\n/g, " ");

        console.log("Running set_vkey...");
        execSync(fullVkeyCmd, { stdio: 'inherit', cwd: rootDir });
        console.log("✅ Verification Key Set!");
        console.log("\n🎉 DEPLOYMENT COMPLETE!");
    } catch (e) {
        console.error("❌ Failed to set verification key:", e.message);
        process.exit(1);
    }
}

main();
