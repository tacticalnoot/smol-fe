import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;
const ADDRESS = "CBNORBI4DCE7LIC42FWMCIWQRULWAUGF2MH2Z7X2RNTFAYNXIACJ33IM";
const READY_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 3000;

function waitForReady(serverProcess) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Dev server did not become ready in time."));
    }, READY_TIMEOUT_MS);

    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes("ready in") || text.includes("Local")) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Dev server exited early with code ${code}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      serverProcess.stdout?.off("data", onData);
      serverProcess.stderr?.off("data", onData);
      serverProcess.off("exit", onExit);
    };

    serverProcess.stdout?.on("data", onData);
    serverProcess.stderr?.on("data", onData);
    serverProcess.on("exit", onExit);
  });
}

async function fetchArtist(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  const body = await response.text();
  return { response, body };
}

function stopServer(serverProcess) {
  return new Promise((resolve) => {
    if (serverProcess.exitCode !== null) {
      resolve();
      return;
    }

    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      serverProcess.off("exit", onExit);
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    serverProcess.once("exit", onExit);
    serverProcess.kill("SIGTERM");
  });
}

test(
  "artist route SSR renders shell with and without query params",
  { timeout: 120000 },
  async () => {
  const server = spawn(
    process.execPath,
    [
      "./node_modules/astro/astro.js",
      "dev",
      "--host",
      "localhost",
      "--port",
      String(PORT),
    ],
    {
      env: {
        ...process.env,
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForReady(server);

    const cases = [
      `/artist/${ADDRESS}`,
      `/artist/${ADDRESS}?shuffle=true&seed=1767826109542`,
    ];

    for (const path of cases) {
      const { response, body } = await fetchArtist(path);

      assert.equal(
        response.status,
        200,
        `Expected 200 response for ${path}, got ${response.status}`,
      );

      assert.match(
        body,
        /data-astro-source-file="[^"]*\/src\/pages\/artist\/\[address\]\.astro"/,
        `Expected SSR shell marker in response for ${path}`,
      );
    }
  } finally {
    await stopServer(server);
  }
  },
);
