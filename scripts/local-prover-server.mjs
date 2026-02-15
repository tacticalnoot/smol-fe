import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const PORT = Number(process.env.PROVER_PORT || "8788");

function windowsPathToWslPath(p) {
  // C:\Users\Jeff\Mixtape Auto\smol-fe -> /mnt/c/Users/Jeff/Mixtape Auto/smol-fe
  const match = /^([a-zA-Z]):\\(.*)$/.exec(p);
  if (!match) return p;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

function sendJson(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  // Basic CORS for local dev.
  res.setHeader("access-control-allow-origin", origin || "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleNoirRole(body) {
  const requiredRole = Number(body?.requiredRole);
  const role = Number(body?.role);
  const salt = String(body?.salt ?? "");

  if (!Number.isFinite(requiredRole) || requiredRole < 0 || requiredRole > 10_000_000) {
    throw new Error("Invalid requiredRole");
  }
  if (!Number.isFinite(role) || role < 0 || role > 10_000_000) {
    throw new Error("Invalid role");
  }
  if (!salt || salt.length > 200) {
    throw new Error("Invalid salt");
  }

  const rootWsl = windowsPathToWslPath(rootDir);
  const cmd = [
    `cd ${rootWsl}/zk/noir-dungeon-role-legacy`,
    `bash scripts/prove_one_wsl.sh ${requiredRole} ${role} ${salt}`,
  ].join(" && ");

  const { stdout } = await execFileAsync("wsl", ["bash", "-lc", cmd], {
    timeout: 6 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(String(stdout).trim());
}

async function handleRisc0Groth16(body) {
  const tierIndex = Number(body?.tierIndex);
  const threshold = Number(body?.threshold);
  const balance = Number(body?.balance);
  const saltByte = Number(body?.saltByte);

  if (!Number.isFinite(tierIndex) || tierIndex < 0 || tierIndex > 255) throw new Error("Invalid tierIndex");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > Number.MAX_SAFE_INTEGER) throw new Error("Invalid threshold");
  if (!Number.isFinite(balance) || balance < 0 || balance > Number.MAX_SAFE_INTEGER) throw new Error("Invalid balance");
  if (!Number.isFinite(saltByte) || saltByte < 0 || saltByte > 255) throw new Error("Invalid saltByte");

  const rootWsl = windowsPathToWslPath(rootDir);
  const cmd = [
    `cd ${rootWsl}/zk/risc0-tier/host`,
    `RISC0_DEV_MODE=0 cargo run --quiet --bin prove_groth16 -- ${tierIndex} ${threshold} ${balance} ${saltByte}`,
  ].join(" && ");

  const { stdout } = await execFileAsync("wsl", ["bash", "-lc", cmd], {
    timeout: 12 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(String(stdout).trim());
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("access-control-allow-origin", origin || "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true }, origin);
      return;
    }

    if (req.method === "POST" && req.url === "/noir-ultrahonk-role") {
      const body = await readJson(req);
      const sample = await handleNoirRole(body);
      sendJson(res, 200, { ok: true, sample }, origin);
      return;
    }

    if (req.method === "POST" && req.url === "/risc0-groth16") {
      const body = await readJson(req);
      const proof = await handleRisc0Groth16(body);
      sendJson(res, 200, { ok: true, proof }, origin);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" }, origin);
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, origin);
  }
});

server.listen(PORT, () => {
  console.log(`[prover] listening on http://localhost:${PORT}`);
  console.log("[prover] routes:");
  console.log("  GET  /health");
  console.log("  POST /noir-ultrahonk-role");
  console.log("  POST /risc0-groth16");
});

