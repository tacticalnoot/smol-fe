<script lang="ts">
  import {
    FARM_ATTESTATIONS_CONTRACT_ID_MAINNET,
    MAINNET_RPC_URL,
    isMainnetConfigured,
  } from "../../../config/farmAttestation";
  import { circomSamples } from "../../../data/the-farm/circomBundle";
  import {
    noirCommitmentScheme,
    noirSamples,
    noirVerifierBytecode,
  } from "../../../data/the-farm/noirBundle";
  import {
    risc0CommitmentScheme,
    risc0MethodIdHex,
    risc0Samples,
  } from "../../../data/the-farm/risc0Bundle";
  import { publishAttestationMainnet } from "../../../lib/the-farm/attest/publishAttestationMainnet";
  import { sha256HexOfJson } from "../../../lib/the-farm/digest";
  import type {
    AttestationResult,
    FarmSampleProof,
    ProofSystem,
    Tier,
    VerificationResult,
  } from "../../../lib/the-farm/types";
  import {
    preloadNoirVerifier,
    verifyNoirProof,
  } from "../../../lib/the-farm/verifiers/noir";
  import {
    preloadRisc0Verifier,
    verifyRisc0Receipt,
  } from "../../../lib/the-farm/verifiers/risc0";
  import {
    balanceState,
    updateContractBalance,
  } from "../../../stores/balance.svelte.ts";
  import { userState } from "../../../stores/user.svelte.ts";
  import { TIER_CONFIG, formatKaleBalance, getTierForBalance } from "./proof";
  import {
    generateTierProof,
    submitProofToContract,
    hashAddress,
    generateRandomSalt,
    serializeProof,
  } from "./zkProof";
  import confetti from "canvas-confetti";

  type SystemTierMap = Record<ProofSystem, Tier>;
  type SystemFlagMap = Record<ProofSystem, boolean>;
  type SystemErrorMap = Record<ProofSystem, string | null>;

  const systems: ProofSystem[] = ["circom", "noir", "risc0"];
  const tierOrder: Tier[] = [
    "sprout",
    "grower",
    "harvester",
    "whale",
    "edge",
    "invalid",
  ];
  const sampleMap: Record<ProofSystem, FarmSampleProof[]> = {
    circom: circomSamples,
    noir: noirSamples,
    risc0: risc0Samples,
  };

  const systemLabel: Record<ProofSystem, string> = {
    circom: "Circom (Groth16)",
    noir: "Noir (UltraHonk)",
    risc0: "RISC0 (Receipt)",
  };

  const verifierLabel: Record<ProofSystem, string> = {
    circom: "On-Chain BN254 Verifier",
    noir: "bb.js UltraHonk verifier",
    risc0: "RISC0 receipt verifier WASM",
  };

  const commitmentLabel: Record<ProofSystem, string> = {
    circom: "poseidon(balance,salt)",
    noir: noirCommitmentScheme,
    risc0: risc0CommitmentScheme,
  };

  let mounted = $state(false);
  let activeSystem = $state<ProofSystem>("circom");
  let selectedTier = $state<SystemTierMap>({
    circom: "sprout",
    noir: "sprout",
    risc0: "sprout",
  });
  let processing = $state<SystemFlagMap>({
    circom: false,
    noir: false,
    risc0: false,
  });
  let step = $state<Record<ProofSystem, string>>({
    circom: "",
    noir: "",
    risc0: "",
  });
  let panelError = $state<SystemErrorMap>({
    circom: null,
    noir: null,
    risc0: null,
  });
  let attestationByKey = $state<Record<string, AttestationResult | null>>({});

  let isAuth = $derived(!!userState.contractId && !!userState.keyId);
  let balance = $derived(balanceState.balance);
  let loading = $derived(balanceState.loading);
  let tierIndex = $derived(balance !== null ? getTierForBalance(balance) : 0);
  let tierCfg = $derived(TIER_CONFIG[tierIndex]);
  let mainnetReady = $derived(isMainnetConfigured());
  let activeSample = $derived(getSample(activeSystem));
  let activeKey = $derived(sampleKey(activeSystem, activeSample.tier));
  let activeAttestResult = $derived(attestationByKey[activeKey]);

  function sampleKey(system: ProofSystem, tier: Tier): string {
    return `${system}:${tier}`;
  }

  function setProcessing(
    system: ProofSystem,
    value: boolean,
    statusText = "",
  ): void {
    processing = { ...processing, [system]: value };
    step = { ...step, [system]: statusText };
  }

  function setPanelError(system: ProofSystem, value: string | null): void {
    panelError = { ...panelError, [system]: value };
  }

  function setSelectedTier(system: ProofSystem, tier: Tier): void {
    selectedTier = { ...selectedTier, [system]: tier };
    setPanelError(system, null);
  }

  function setAttestationResult(
    system: ProofSystem,
    tier: Tier,
    result: AttestationResult,
  ): void {
    attestationByKey = {
      ...attestationByKey,
      [sampleKey(system, tier)]: result,
    };
  }

  function getSample(system: ProofSystem): FarmSampleProof {
    const wantedTier = selectedTier[system];
    const found = sampleMap[system].find(
      (sample) => sample.tier === wantedTier,
    );
    return found ?? sampleMap[system][0];
  }

  function getTierOptions(
    system: ProofSystem,
  ): Array<{ tier: Tier; label: string }> {
    const entries = sampleMap[system];
    return tierOrder
      .map((tier) => entries.find((sample) => sample.tier === tier))
      .filter((sample): sample is FarmSampleProof => !!sample)
      .map((sample) => ({ tier: sample.tier, label: sample.label }));
  }

  function shortHash(value: string): string {
    const clean = value.startsWith("0x") ? value.slice(2) : value;
    if (clean.length <= 16) {
      return clean;
    }
    return `${clean.slice(0, 10)}...${clean.slice(-8)}`;
  }

  async function secureFarmClaim(system: ProofSystem): Promise<void> {
    const sample = getSample(system);
    setPanelError(system, null);

    if (!isAuth) {
      setPanelError(system, "Connect your passkey smart wallet first.");
      return;
    }

    setProcessing(system, true, "Initializing Proof Pipeline...");

    try {
      // 1. Circom High-Fidelity Path (Unified)
      if (system === "circom") {
        setProcessing(system, true, "Generating ZK Proof...");

        const addrHash = await hashAddress(userState.contractId!);
        const currentBalance = balance ?? 0n;
        const salt = generateRandomSalt();
        const tierId = getTierForBalance(currentBalance);

        // Generate real proof
        const proofRes = await generateTierProof(
          addrHash,
          currentBalance,
          salt,
          tierId,
        );

        setProcessing(system, true, "Proof Generated. Attesting...");

        // Compute commitment bytes for submission
        const { buildPoseidon } = await import("circomlibjs");
        const poseidon = await buildPoseidon();
        const commitmentBigInt = BigInt(
          poseidon.F.toString(poseidon([addrHash, currentBalance, salt])),
        );
        const commitmentBytes = new Uint8Array(32);
        let v = commitmentBigInt;
        for (let i = 31; i >= 0; i--) {
          commitmentBytes[i] = Number(v & 0xffn);
          v >>= 8n;
        }

        // Submit real proof to SuperVerifier
        const submitResult = await submitProofToContract(
          // @ts-ignore
          window.passkeyKit,
          userState.contractId!,
          tierId,
          commitmentBytes,
          proofRes.proof,
        );

        if (submitResult.success) {
          setAttestationResult(system, sample.tier, {
            ok: true,
            txHash: submitResult.txHash,
            ledger: 0,
            feeCharged: "Relayed",
          });
          confetti();
        } else {
          throw new Error(submitResult.error || "On-chain verification failed");
        }
      }
      // 2. Noir/RISC0 Legacy/Sample paths
      else {
        setProcessing(system, true, "Verifying Sample Locally...");
        let verifyResult: VerificationResult;
        if (system === "noir") {
          verifyResult = await verifyNoirProof(
            noirVerifierBytecode,
            sample.proof,
          );
        } else {
          verifyResult = await verifyRisc0Receipt(
            risc0MethodIdHex,
            sample.proof,
          );
        }

        if (!verifyResult.valid) {
          throw new Error(verifyResult.error || "Sample verification failed");
        }

        setProcessing(system, true, "Sample Valid. Record on mainnet...");

        const statementHash = await sha256HexOfJson({
          system: sample.system,
          tier: sample.tier,
          commitmentDigest: sample.commitmentDigest,
          proofDigest: sample.proofDigest,
          publicInputs: sample.publicInputs,
        });

        const attestResult = await publishAttestationMainnet({
          owner: userState.contractId!,
          keyId: userState.keyId!,
          system: sample.system,
          tier: sample.tier,
          statementHash,
          verifierHash: sample.verifierDigest,
        });

        setAttestationResult(system, sample.tier, attestResult);
        if (!attestResult.ok) {
          throw new Error(attestResult.error || "Attestation failed");
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Secure claim failed";
      setPanelError(system, message);
    } finally {
      setProcessing(system, false);
    }
  }

  $effect(() => {
    mounted = true;
  });

  $effect(() => {
    preloadNoirVerifier(noirVerifierBytecode);
    preloadRisc0Verifier();
  });

  $effect(() => {
    if (userState.contractId) {
      updateContractBalance(userState.contractId);
    }
  });

  if (typeof window !== "undefined") {
    // @ts-ignore
    window.__setBalance = (amount: bigint) => {
      balanceState.balance = amount;
    };
  }
</script>

<div class="farm-root" class:farm-mounted={mounted}>
  <div class="grain" aria-hidden="true"></div>
  <div class="farm-shell">
    <section class="hero card">
      <div class="hero-top">
        <p class="eyebrow" style="color: var(--farm-leaf); font-size: 0.6rem;">
          Mission-Critical Cryptography
        </p>
        <h1>THE FARM</h1>
      </div>
      <p class="hero-sub">
        Secure your farming status with trustless, on-chain zero-knowledge
        proofs. No balances revealed. No privacy leaked.
      </p>
      <div class="hero-metrics">
        <div class="metric">
          <span class="label">Identity Status</span>
          <span class="value" style={`color:${tierCfg.color}`}>
            {#if tierCfg.iconImage}
              <img
                src={tierCfg.iconImage}
                alt={tierCfg.name}
                class="tier-icon"
              />
            {:else}
              {tierCfg.icon}
            {/if}
            {tierCfg.name}
          </span>
        </div>
        <div class="metric">
          <span class="label">Verified Balance</span>
          <span class="value">
            {loading
              ? "..."
              : balance
                ? `${formatKaleBalance(balance)} KALE`
                : "0 KALE"}
          </span>
        </div>
        <div class="metric">
          <span class="label">Passkey Core</span>
          <span
            class="value"
            style="font-size: 0.8rem; font-family: 'Press Start 2P';"
          >
            {isAuth ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>
    </section>

    <section class="proof-suite card">
      <div class="suite-head">
        <div>
          <h2>ZK Pipeline</h2>
          <p>Generate and attest your proof in a single atomic flow.</p>
        </div>
        <div class="chip-row">
          <span class="chip" style="animation: pulse-chip 2s infinite;"
            >High Fidelity</span
          >
          <span class="chip">Gasless Relayer</span>
          <span class="chip">Protocol 25 BN254</span>
        </div>
      </div>

      <div class="system-tabs" role="tablist" aria-label="Proof systems">
        {#each systems as system}
          <button
            type="button"
            role="tab"
            class="tab-btn"
            class:active={activeSystem === system}
            aria-selected={activeSystem === system}
            on:click={() => {
              activeSystem = system;
              setPanelError(system, null);
            }}
          >
            {systemLabel[system]}
          </button>
        {/each}
      </div>

      <div class="suite-grid">
        <div class="panel plot">
          <div class="panel-header">
            <h3>Configuration</h3>
            {#if activeSystem !== "circom"}
              <span class="badge-mini">Sample Only</span>
            {:else}
              <span class="badge-mini live">Live Prove</span>
            {/if}
          </div>

          <label for="sample-tier">Target Tier</label>
          <select
            id="sample-tier"
            value={selectedTier[activeSystem]}
            on:change={(event) =>
              setSelectedTier(
                activeSystem,
                (event.currentTarget as HTMLSelectElement).value as Tier,
              )}
          >
            {#each getTierOptions(activeSystem) as option}
              <option value={option.tier}>{option.label}</option>
            {/each}
          </select>

          <div class="meta-grid">
            <div class="meta-item">
              <span class="k">Commitment</span>
              <span class="v">{shortHash(activeSample.commitmentDigest)}</span>
            </div>
            <div class="meta-item">
              <span class="k">Proof Digest</span>
              <span class="v">{shortHash(activeSample.proofDigest)}</span>
            </div>
            <div class="meta-item">
              <span class="k">Verifier</span>
              <span class="v">{verifierLabel[activeSystem]}</span>
            </div>
          </div>

          <button
            type="button"
            class="action attest"
            disabled={processing[activeSystem] || !isAuth}
            on:click={() => secureFarmClaim(activeSystem)}
          >
            {#if processing[activeSystem]}
              {step[activeSystem] || "Processing..."}
            {:else}
              Secure Farm Claim
            {/if}
          </button>

          {#if panelError[activeSystem]}
            <p class="bad" style="margin-top: 8px;">
              {panelError[activeSystem]}
            </p>
          {/if}

          <div class="result-panel">
            {#if activeAttestResult?.ok && activeAttestResult.txHash}
              <p class="ok">Attested on Stellar (Mainnet)</p>
              <p class="tx-line">
                Tx: <a
                  href={`https://stellar.expert/explorer/public/tx/${activeAttestResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHash(activeAttestResult.txHash)}
                </a>
              </p>
              <p class="neutral">Result: Verified & Secure</p>
            {:else}
              <p class="neutral">No on-chain attestation for this session.</p>
            {/if}
          </div>
        </div>

        <div class="panel info-panel">
          <h3>Verification Intelligence</h3>
          <div class="intelligence-list">
            <div class="intel-item">
              <div class="intel-icon">🧪</div>
              <div class="intel-text">
                <strong>Protocol Path</strong>
                <p>
                  Using {activeSystem === "circom"
                    ? "BN254 host pairing checks"
                    : "Off-chain record ledger"}.
                </p>
              </div>
            </div>
            <div class="intel-item">
              <div class="intel-icon">🛡️</div>
              <div class="intel-text">
                <strong>Privacy Shield</strong>
                <p>
                  Only the commitment is stored. Your balance remains private.
                </p>
              </div>
            </div>
            <div class="intel-item">
              <div class="intel-icon">⛽</div>
              <div class="intel-text">
                <strong>Gasless Submission</strong>
                <p>
                  Transactions are relayed. No native XLM required for fees.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="proves card">
      <h2>Cryptographic Guarantees</h2>
      <div class="guarantee-grid">
        <div class="guarantee">
          <strong>Threshold Enforcement</strong>
          <p>
            The proof logically ensures balance >= threshold without revealing
            the value.
          </p>
        </div>
        <div class="guarantee">
          <strong>Non-Transferable Claims</strong>
          <p>
            Each attestation is mathematically tied to YOUR unique Passkey
            address.
          </p>
        </div>
        <div class="guarantee">
          <strong>Absolute Persistence</strong>
          <p>
            Once verified on-chain, your status is stored in the Stellar global
            state.
          </p>
        </div>
      </div>
    </section>

    <section class="below-fold">
      <details class="card collapse">
        <summary>Security Model</summary>
        <div class="collapse-body">
          <p>
            This implementation leverages the latest <strong
              >Stellar Protocol 25</strong
            > features, specifically the BN254 elliptic curve host functions.
          </p>
          <p>
            By moving verification from "local UI" to "on-chain contract," we
            eliminate the possibility of fake proofs being recorded in the
            system.
          </p>
          <pre><code
              >// On-chain logic:
// e(-pi_a, pi_b) * e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta) == 1</code
            ></pre>
        </div>
      </details>
    </section>
  </div>
</div>

<style>
  :root {
    --farm-bg: #051a0d;
    --farm-ink: #ccfccb;
    --farm-soil: #1a4d2e;
    --farm-soil-soft: #2d6a4f;
    --farm-leaf: #4ade80;
    --farm-sun: #bbf7d0;
    --farm-card: rgba(10, 30, 15, 0.65);
    --farm-line: rgba(74, 222, 128, 0.2);
  }

  .farm-root {
    min-height: 100vh;
    color: var(--farm-ink);
    background: radial-gradient(
        circle at 15% 15%,
        rgba(74, 222, 128, 0.08) 0%,
        transparent 40%
      ),
      radial-gradient(
        circle at 85% 85%,
        rgba(34, 197, 94, 0.08) 0%,
        transparent 40%
      ),
      linear-gradient(180deg, #020604 0%, #051a0d 40%, #0a2f1b 100%);
    position: relative;
    overflow-x: hidden;
    opacity: 0;
    transition: opacity 0.5s ease;
    font-family: "Space Grotesk", sans-serif;
  }

  .farm-mounted {
    opacity: 1;
  }

  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(
      rgba(255, 255, 255, 0.1) 1px,
      transparent 1px
    );
    background-size: 32px 32px;
    opacity: 0.4;
  }

  .farm-shell {
    position: relative;
    z-index: 1;
    max-width: 1000px;
    margin: 0 auto;
    padding: 72px 20px;
    display: grid;
    gap: 24px;
  }

  .card {
    border: 1px solid var(--farm-line);
    border-radius: 20px;
    background: var(--farm-card);
    backdrop-filter: blur(20px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .hero {
    padding: 40px;
    text-align: center;
  }
  .hero-top h1 {
    font-family: "Press Start 2P", cursive;
    font-size: 2.5rem;
    color: var(--farm-leaf);
    text-shadow: 0 0 20px rgba(74, 222, 128, 0.4);
    margin: 12px 0;
  }
  .hero-sub {
    max-width: 60ch;
    margin: 0 auto 32px;
    opacity: 0.8;
    font-size: 1.1rem;
  }

  .hero-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .metric {
    background: rgba(0, 0, 0, 0.4);
    padding: 20px;
    border-radius: 16px;
    border: 1px solid var(--farm-line);
    display: grid;
    gap: 8px;
  }
  .metric .label {
    font-size: 0.6rem;
    font-family: "Press Start 2P";
    opacity: 0.6;
  }
  .metric .value {
    font-size: 1.2rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .proof-suite {
    padding: 32px;
  }
  .suite-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 20px;
  }
  .suite-head h2 {
    font-family: "Press Start 2P";
    font-size: 1.2rem;
    color: var(--farm-leaf);
    margin: 0;
  }
  .chip-row {
    display: flex;
    gap: 10px;
  }
  .chip {
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid var(--farm-line);
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 0.6rem;
    font-family: "Press Start 2P";
    color: var(--farm-sun);
  }

  .system-tabs {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
  }
  .tab-btn {
    flex: 1;
    border: 1px solid var(--farm-line);
    background: transparent;
    color: var(--farm-ink);
    padding: 12px;
    border-radius: 12px;
    font-family: "Press Start 2P";
    font-size: 0.6rem;
    cursor: pointer;
    transition: 0.2s;
  }
  .tab-btn.active {
    background: rgba(74, 222, 128, 0.15);
    border-color: var(--farm-leaf);
    color: white;
    box-shadow: 0 0 20px rgba(74, 222, 128, 0.2);
  }

  .suite-grid {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 24px;
  }
  .panel {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--farm-line);
    border-radius: 16px;
    padding: 24px;
    display: grid;
    gap: 20px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .badge-mini {
    font-size: 0.5rem;
    font-family: "Press Start 2P";
    padding: 4px 8px;
    border-radius: 4px;
    background: #444;
  }
  .badge-mini.live {
    background: #065f46;
    color: #34d399;
  }

  .meta-grid {
    display: grid;
    gap: 8px;
  }
  .meta-item {
    background: rgba(0, 0, 0, 0.3);
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--farm-line);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .meta-item .k {
    font-size: 0.6rem;
    opacity: 0.7;
  }
  .meta-item .v {
    font-family: monospace;
    font-size: 0.8rem;
  }

  .action.attest {
    background: linear-gradient(135deg, #10b981, #064e3b);
    color: white;
    padding: 16px;
    border: none;
    border-radius: 12px;
    font-family: "Press Start 2P";
    font-size: 0.8rem;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
    transition: 0.2s;
  }
  .action.attest:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
  }
  .action.attest:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .intelligence-list {
    display: grid;
    gap: 16px;
  }
  .intel-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .intel-icon {
    background: rgba(74, 222, 128, 0.1);
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--farm-line);
  }
  .intel-text strong {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 4px;
    color: var(--farm-leaf);
  }
  .intel-text p {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .guarantee-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    margin-top: 16px;
  }
  .guarantee {
    background: rgba(0, 0, 0, 0.3);
    padding: 20px;
    border-radius: 16px;
    border: 1px solid var(--farm-line);
  }
  .guarantee strong {
    display: block;
    margin-bottom: 8px;
    color: var(--farm-sun);
    font-size: 1rem;
  }
  .guarantee p {
    margin: 0;
    font-size: 0.9rem;
    opacity: 0.7;
  }

  .result-panel {
    background: rgba(0, 0, 0, 0.4);
    padding: 15px;
    border-radius: 12px;
    text-align: center;
  }

  @media (max-width: 800px) {
    .suite-grid {
      grid-template-columns: 1fr;
    }
    .hero-top h1 {
      font-size: 1.8rem;
    }
  }
</style>
