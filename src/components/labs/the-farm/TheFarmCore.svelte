<script lang="ts">
  import {
    FARM_ATTESTATIONS_CONTRACT_ID_MAINNET,
    MAINNET_RPC_URL,
    isMainnetConfigured,
  } from "../../../config/farmAttestation";
  import { circomSamples, circomVerificationKey } from "../../../data/the-farm/circomBundle";
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
  import { verifyCircomGroth16 } from "../../../lib/the-farm/verifiers/circomGroth16";
  import { preloadNoirVerifier, verifyNoirProof } from "../../../lib/the-farm/verifiers/noir";
  import { preloadRisc0Verifier, verifyRisc0Receipt } from "../../../lib/the-farm/verifiers/risc0";
  import { balanceState, updateContractBalance } from "../../../stores/balance.svelte.ts";
  import { userState } from "../../../stores/user.svelte.ts";
  import { TIER_CONFIG, formatKaleBalance, getTierForBalance } from "./proof";

  type SystemTierMap = Record<ProofSystem, Tier>;
  type SystemFlagMap = Record<ProofSystem, boolean>;
  type SystemErrorMap = Record<ProofSystem, string | null>;

  const systems: ProofSystem[] = ["circom", "noir", "risc0"];
  const tierOrder: Tier[] = ["sprout", "grower", "harvester", "whale", "edge", "invalid"];
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
    circom: "snarkjs.groth16.verify",
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
  let verifying = $state<SystemFlagMap>({
    circom: false,
    noir: false,
    risc0: false,
  });
  let publishing = $state<SystemFlagMap>({
    circom: false,
    noir: false,
    risc0: false,
  });
  let acknowledgedMainnet = $state<SystemFlagMap>({
    circom: false,
    noir: false,
    risc0: false,
  });
  let panelError = $state<SystemErrorMap>({
    circom: null,
    noir: null,
    risc0: null,
  });
  let verificationByKey = $state<Record<string, VerificationResult | null>>({});
  let attestationByKey = $state<Record<string, AttestationResult | null>>({});

  let isAuth = $derived(!!userState.contractId && !!userState.keyId);
  let balance = $derived(balanceState.balance);
  let loading = $derived(balanceState.loading);
  let tierIndex = $derived(balance !== null ? getTierForBalance(balance) : 0);
  let tierCfg = $derived(TIER_CONFIG[tierIndex]);
  let mainnetReady = $derived(isMainnetConfigured());
  let activeSample = $derived(getSample(activeSystem));
  let activeKey = $derived(sampleKey(activeSystem, activeSample.tier));
  let activeVerifyResult = $derived(verificationByKey[activeKey]);
  let activeAttestResult = $derived(attestationByKey[activeKey]);

  function getMissingMainnetVars(): string[] {
    const missing: string[] = [];
    if (!MAINNET_RPC_URL.trim()) {
      missing.push("PUBLIC_MAINNET_RPC_URL");
    }
    if (!FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim()) {
      missing.push("PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET");
    }
    return missing;
  }

  function sampleKey(system: ProofSystem, tier: Tier): string {
    return `${system}:${tier}`;
  }

  function setVerifying(system: ProofSystem, value: boolean): void {
    verifying = { ...verifying, [system]: value };
  }

  function setPublishing(system: ProofSystem, value: boolean): void {
    publishing = { ...publishing, [system]: value };
  }

  function setAcknowledged(system: ProofSystem, value: boolean): void {
    acknowledgedMainnet = { ...acknowledgedMainnet, [system]: value };
  }

  function setPanelError(system: ProofSystem, value: string | null): void {
    panelError = { ...panelError, [system]: value };
  }

  function setSelectedTier(system: ProofSystem, tier: Tier): void {
    selectedTier = { ...selectedTier, [system]: tier };
    setPanelError(system, null);
  }

  function setVerifyResult(system: ProofSystem, tier: Tier, result: VerificationResult): void {
    verificationByKey = { ...verificationByKey, [sampleKey(system, tier)]: result };
  }

  function setAttestationResult(system: ProofSystem, tier: Tier, result: AttestationResult): void {
    attestationByKey = { ...attestationByKey, [sampleKey(system, tier)]: result };
  }

  function getSample(system: ProofSystem): FarmSampleProof {
    const wantedTier = selectedTier[system];
    const found = sampleMap[system].find((sample) => sample.tier === wantedTier);
    return found ?? sampleMap[system][0];
  }

  function getTierOptions(system: ProofSystem): Array<{ tier: Tier; label: string }> {
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

  function formatDuration(ms: number): string {
    return `${ms.toFixed(0)}ms`;
  }

  function canPublish(system: ProofSystem, sample: FarmSampleProof): boolean {
    const key = sampleKey(system, sample.tier);
    const verifyResult = verificationByKey[key];
    return !!verifyResult?.valid && sample.expectedValid && sample.tier !== "invalid";
  }

  async function verifyLocally(system: ProofSystem): Promise<void> {
    const sample = getSample(system);
    setPanelError(system, null);
    setVerifying(system, true);

    try {
      let result: VerificationResult;

      if (system === "circom") {
        result = await verifyCircomGroth16(circomVerificationKey, sample.proof, sample.publicInputs);
      } else if (system === "noir") {
        result = await verifyNoirProof(noirVerifierBytecode, sample.proof);
      } else {
        result = await verifyRisc0Receipt(risc0MethodIdHex, sample.proof);
      }

      setVerifyResult(system, sample.tier, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local verification failed";
      setVerifyResult(system, sample.tier, {
        valid: false,
        durationMs: 0,
        error: message,
      });
    } finally {
      setVerifying(system, false);
    }
  }

  async function attestOnMainnet(system: ProofSystem): Promise<void> {
    const sample = getSample(system);
    const key = sampleKey(system, sample.tier);
    const verifyResult = verificationByKey[key];

    setPanelError(system, null);

    if (!verifyResult?.valid) {
      setPanelError(system, "Run local verification first.");
      return;
    }
    if (!sample.expectedValid || sample.tier === "invalid") {
      setPanelError(system, "Invalid samples cannot be attested.");
      return;
    }
    if (!acknowledgedMainnet[system]) {
      setPanelError(system, "Confirm mainnet spend acknowledgement.");
      return;
    }
    if (!mainnetReady) {
      setPanelError(system, `Missing env: ${getMissingMainnetVars().join(", ")}`);
      return;
    }
    if (!userState.contractId || !userState.keyId) {
      setPanelError(system, "Connect your passkey smart wallet first.");
      return;
    }

    setPublishing(system, true);

    try {
      const statementHash = await sha256HexOfJson({
        system: sample.system,
        tier: sample.tier,
        commitmentDigest: sample.commitmentDigest,
        proofDigest: sample.proofDigest,
        publicInputs: sample.publicInputs,
      });

      const result = await publishAttestationMainnet({
        owner: userState.contractId,
        keyId: userState.keyId,
        system: sample.system,
        tier: sample.tier,
        statementHash,
        verifierHash: sample.verifierDigest,
      });

      setAttestationResult(system, sample.tier, result);
      if (!result.ok) {
        setPanelError(system, result.error ?? "Mainnet attestation failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mainnet attestation failed";
      setAttestationResult(system, sample.tier, { ok: false, error: message });
      setPanelError(system, message);
    } finally {
      setPublishing(system, false);
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
        <p class="eyebrow">Mainnet Real Triple-ZK</p>
        <h1>THE FARM</h1>
      </div>
      <p class="hero-sub">
        Three independent proof systems. Local cryptographic verification in-browser. Mainnet
        passkey-signed attestations on Stellar.
      </p>
      <div class="hero-metrics">
        <div class="metric">
          <span class="label">Wallet Tier</span>
          <span class="value" style={`color:${tierCfg.color}`}>{tierCfg.icon} {tierCfg.name}</span>
        </div>
        <div class="metric">
          <span class="label">KALE Balance</span>
          <span class="value">{loading ? "Loading..." : balance ? `${formatKaleBalance(balance)} KALE` : "0 KALE"}</span>
        </div>
        <div class="metric">
          <span class="label">Wallet</span>
          <span class="value">{isAuth ? "Passkey Connected" : "Connect Passkey Wallet"}</span>
        </div>
      </div>
    </section>

    <section class="proof-suite card">
      <div class="suite-head">
        <div>
          <h2>Proof Suite</h2>
          <p>Local verification only. No proof data is sent to any server.</p>
        </div>
        <div class="chip-row">
          <span class="chip">Mainnet Only</span>
          <span class="chip">Digest Attestation</span>
          <span class="chip">Tamper-Resistant Samples</span>
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
          <label for="sample-tier">Sample Tier</label>
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
              <span class="v" title={activeSample.commitmentDigest}>
                {shortHash(activeSample.commitmentDigest)}
              </span>
            </div>
            <div class="meta-item">
              <span class="k">Proof Digest</span>
              <span class="v" title={activeSample.proofDigest}>{shortHash(activeSample.proofDigest)}</span>
            </div>
            <div class="meta-item">
              <span class="k">Verifier Digest</span>
              <span class="v" title={activeSample.verifierDigest}>
                {shortHash(activeSample.verifierDigest)}
              </span>
            </div>
            <div class="meta-item">
              <span class="k">Verifier</span>
              <span class="v">{verifierLabel[activeSystem]}</span>
            </div>
            <div class="meta-item">
              <span class="k">Commitment Scheme</span>
              <span class="v">{commitmentLabel[activeSystem]}</span>
            </div>
          </div>

          <button
            type="button"
            class="action verify"
            disabled={verifying[activeSystem]}
            on:click={() => verifyLocally(activeSystem)}
          >
            {verifying[activeSystem] ? "Verifying..." : "Verify locally"}
          </button>

          <div class="result-panel">
            {#if activeVerifyResult}
              {#if activeVerifyResult.valid}
                <p class="ok">Verified locally (cryptographic) in {formatDuration(activeVerifyResult.durationMs)}</p>
              {:else}
                <p class="bad">Invalid proof - {activeVerifyResult.error ?? "verification returned false"}</p>
              {/if}
            {:else}
              <p class="neutral">Run local verification to produce a cryptographic result.</p>
            {/if}
          </div>
        </div>

        <div class="panel plot">
          <h3>Attest on Mainnet</h3>
          <p class="small">
            Publish only digest-level claim data for this verified sample using your passkey smart wallet.
          </p>

          {#if !mainnetReady}
            <div class="warning">
              <p class="warning-title">Mainnet env missing</p>
              <p class="warning-desc">{getMissingMainnetVars().join(", ")}</p>
            </div>
          {/if}

          <label class="checkbox">
            <input
              type="checkbox"
              checked={acknowledgedMainnet[activeSystem]}
              on:change={(event) =>
                setAcknowledged(activeSystem, (event.currentTarget as HTMLInputElement).checked)}
            />
            <span>I understand this is MAINNET and costs real XLM.</span>
          </label>

          <button
            type="button"
            class="action attest"
            disabled={
              !canPublish(activeSystem, activeSample) ||
              !acknowledgedMainnet[activeSystem] ||
              publishing[activeSystem] ||
              !mainnetReady ||
              !isAuth
            }
            on:click={() => attestOnMainnet(activeSystem)}
          >
            {publishing[activeSystem] ? "Submitting to Mainnet..." : "Attest on Mainnet"}
          </button>

          {#if panelError[activeSystem]}
            <p class="bad">{panelError[activeSystem]}</p>
          {/if}

          <div class="result-panel">
            {#if activeAttestResult?.ok && activeAttestResult.txHash}
              <p class="ok">Attested on Stellar (Mainnet)</p>
              <p class="tx-line">
                Tx:
                <a
                  href={`https://stellar.expert/explorer/public/tx/${activeAttestResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHash(activeAttestResult.txHash)}
                </a>
              </p>
              <p class="neutral">Ledger: {activeAttestResult.ledger ?? "n/a"}</p>
              <p class="neutral">Fee Charged: {activeAttestResult.feeCharged ?? "n/a"}</p>
            {:else if activeAttestResult && !activeAttestResult.ok}
              <p class="bad">{activeAttestResult.error ?? "Mainnet attestation failed"}</p>
            {:else}
              <p class="neutral">No mainnet attestation submitted for this sample yet.</p>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <section class="proves card">
      <h2>What this proves</h2>
      <ul>
        <li>
          <span>Tier threshold satisfied</span>
          <span class="tip" title="The proof enforces balance >= selected threshold.">ⓘ</span>
        </li>
        <li>
          <span>Commitment binds hidden value</span>
          <span class="tip" title="Commitment digest is tied to private witness values without revealing them.">ⓘ</span>
        </li>
        <li>
          <span>Passkey smart wallet signed the claim on mainnet</span>
          <span class="tip" title="The attest transaction is signed by your passkey wallet and posted to Stellar Mainnet.">ⓘ</span>
        </li>
      </ul>
    </section>

    <section class="below-fold">
      <details class="card collapse">
        <summary>Field Guide</summary>
        <div class="collapse-body">
          <h3>How each proof system works</h3>
          <p><strong>Circom:</strong> Groth16 over bundled verification key with local `snarkjs` verification.</p>
          <p><strong>Noir:</strong> UltraHonk proof checked in a worker through `bb.js` verifier logic.</p>
          <p><strong>RISC0:</strong> Receipt verification in a local WASM verifier against the method ID digest.</p>

          <h3>What gets published on-chain</h3>
          <p>Only `statementHash` and `verifierHash` digests plus owner/system/tier metadata. Proof material is never published.</p>

          <h3>Threat model</h3>
          <p>Local verification blocks forged samples. Invalid or tampered proof artifacts fail verification and cannot be attested from the UI.</p>

          <h3>Repro commands</h3>
          <pre><code>bash zk/circom-tier/scripts/verify_samples.sh
bash zk/noir-tier/scripts/verify_samples.sh
bash zk/risc0-tier/scripts/verify_samples.sh
bash scripts/the-farm/no-stubs.sh
bash scripts/the-farm/no-leaks.sh</code></pre>
        </div>
      </details>

      <details class="card collapse">
        <summary>Deck Mode</summary>
        <div class="deck-grid">
          <article class="slide">
            <h4>1. Problem</h4>
            <p>Users need tier claims without exposing wallet balances.</p>
          </article>
          <article class="slide">
            <h4>2. Solution</h4>
            <p>Three local proof systems plus mainnet digest attestations signed by passkeys.</p>
          </article>
          <article class="slide">
            <h4>3. Architecture</h4>
            <p>Browser verifier workers -> digest build -> Soroban attest contract on Stellar Mainnet.</p>
          </article>
          <article class="slide">
            <h4>4. Proof Comparison</h4>
            <p>Circom Groth16, Noir UltraHonk, RISC0 receipts, each independently verifiable.</p>
          </article>
          <article class="slide">
            <h4>5. Mainnet Attestation</h4>
            <p>Passkey smart wallet signs `attest(owner, system, tier, statementHash, verifierHash)`.</p>
          </article>
          <article class="slide">
            <h4>6. Privacy Guarantees</h4>
            <p>Proof/witness/salt are never sent to server and never stored in browser persistence.</p>
          </article>
          <article class="slide">
            <h4>7. Roadmap</h4>
            <p>On-chain proof verification path and expanded tier policies.</p>
          </article>
        </div>
      </details>
    </section>
  </div>
</div>

<style>
  :root {
    --farm-bg: #f3eadb;
    --farm-ink: #1f1b16;
    --farm-soil: #5a3c2d;
    --farm-soil-soft: #7a5640;
    --farm-leaf: #39673d;
    --farm-sun: #f2c975;
    --farm-card: rgba(255, 253, 248, 0.78);
    --farm-line: rgba(88, 55, 36, 0.24);
  }

  .farm-root {
    min-height: 100vh;
    color: var(--farm-ink);
    background:
      radial-gradient(circle at 12% 4%, #ffe7be 0%, transparent 42%),
      radial-gradient(circle at 87% 1%, #f6d5a4 0%, transparent 35%),
      linear-gradient(180deg, #efe3d1 0%, #ead8c1 44%, #dfc8aa 100%);
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
    background-image:
      radial-gradient(rgba(72, 40, 17, 0.09) 0.7px, transparent 0.7px),
      radial-gradient(rgba(72, 40, 17, 0.05) 0.7px, transparent 0.7px);
    background-size: 13px 13px, 17px 17px;
    background-position: 0 0, 6px 9px;
    opacity: 0.45;
  }

  .farm-shell {
    position: relative;
    z-index: 1;
    max-width: 1080px;
    margin: 0 auto;
    padding: 72px 18px 88px;
    display: grid;
    gap: 18px;
  }

  .card {
    border: 1px solid var(--farm-line);
    border-radius: 20px;
    background: var(--farm-card);
    backdrop-filter: blur(8px);
    box-shadow:
      0 8px 24px rgba(74, 40, 18, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  .hero {
    padding: 26px;
    display: grid;
    gap: 12px;
  }

  .hero-top h1 {
    margin: 0;
    font-family: "Fraunces", serif;
    font-size: clamp(2rem, 3vw, 3rem);
    letter-spacing: 0.03em;
    color: #3f281d;
  }

  .eyebrow {
    margin: 0 0 2px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.68rem;
    color: #8d5e45;
    font-weight: 700;
  }

  .hero-sub {
    margin: 0;
    max-width: 72ch;
    color: #6a4a3a;
    font-size: 0.97rem;
    line-height: 1.45;
  }

  .hero-metrics {
    margin-top: 4px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 10px;
  }

  .metric {
    border: 1px solid rgba(105, 66, 43, 0.24);
    border-radius: 12px;
    background: rgba(255, 248, 237, 0.78);
    padding: 10px 12px;
    display: grid;
    gap: 2px;
  }

  .metric .label {
    font-size: 0.72rem;
    color: #7d6049;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .metric .value {
    font-size: 0.92rem;
    font-weight: 700;
    color: #2f2019;
  }

  .proof-suite {
    padding: 20px;
    display: grid;
    gap: 14px;
  }

  .suite-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .suite-head h2 {
    margin: 0;
    font-family: "Fraunces", serif;
    font-size: 1.5rem;
    color: #3f281d;
  }

  .suite-head p {
    margin: 2px 0 0;
    color: #684834;
    font-size: 0.9rem;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  .chip {
    border: 1px solid rgba(96, 61, 41, 0.36);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 0.72rem;
    font-weight: 700;
    color: #5f3e2d;
    background: rgba(246, 233, 212, 0.82);
    animation: pulse-chip 2.8s ease-in-out infinite;
  }

  @keyframes pulse-chip {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-1px);
    }
  }

  .system-tabs {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .tab-btn {
    border: 1px solid rgba(94, 59, 40, 0.3);
    background:
      linear-gradient(145deg, rgba(121, 85, 56, 0.13), rgba(198, 149, 109, 0.16));
    color: #5b3b2d;
    border-radius: 12px;
    padding: 10px 12px;
    font-weight: 700;
    font-size: 0.83rem;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
    cursor: pointer;
  }

  .tab-btn:hover {
    transform: translateY(-1px);
    border-color: rgba(90, 122, 66, 0.58);
  }

  .tab-btn.active {
    border-color: rgba(54, 100, 56, 0.72);
    background:
      linear-gradient(145deg, rgba(112, 174, 106, 0.28), rgba(204, 178, 112, 0.22));
    color: #214826;
  }

  .suite-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .panel {
    border: 1px solid rgba(90, 58, 41, 0.26);
    background: rgba(255, 251, 243, 0.75);
    border-radius: 14px;
    padding: 14px;
    display: grid;
    gap: 10px;
  }

  .plot {
    position: relative;
    overflow: hidden;
  }

  .plot::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(70, 108, 60, 0.05) 1px, transparent 1px),
      linear-gradient(0deg, rgba(70, 108, 60, 0.05) 1px, transparent 1px);
    background-size: 18px 18px;
    pointer-events: none;
  }

  .panel h3,
  .panel label {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6a4b3b;
  }

  select {
    border: 1px solid rgba(95, 61, 42, 0.28);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.84);
    color: #2f1f17;
    padding: 8px 10px;
    font-size: 0.9rem;
    z-index: 1;
  }

  .meta-grid {
    display: grid;
    gap: 7px;
    z-index: 1;
  }

  .meta-item {
    border: 1px solid rgba(93, 57, 38, 0.19);
    border-radius: 9px;
    padding: 7px 9px;
    background: rgba(255, 246, 233, 0.84);
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
    gap: 7px;
    align-items: center;
  }

  .meta-item .k {
    font-size: 0.67rem;
    color: #7a5a45;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .meta-item .v {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.76rem;
    color: #2d1d15;
    overflow-wrap: anywhere;
  }

  .action {
    border: none;
    border-radius: 11px;
    padding: 10px 14px;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease;
    z-index: 1;
  }

  .action:hover:not(:disabled) {
    transform: translateY(-1px) scale(1.006);
    filter: brightness(1.02);
  }

  .action:disabled {
    opacity: 0.56;
    cursor: not-allowed;
  }

  .action.verify {
    background: linear-gradient(145deg, #507a3f, #3d6131);
    color: #f4ffe8;
  }

  .action.attest {
    background: linear-gradient(145deg, #6a4d37, #4f3a29);
    color: #fff8ef;
  }

  .result-panel {
    border: 1px dashed rgba(92, 58, 39, 0.32);
    border-radius: 10px;
    padding: 9px 10px;
    background: rgba(255, 250, 239, 0.86);
    z-index: 1;
  }

  .small {
    margin: 0;
    color: #6b4d3d;
    font-size: 0.86rem;
    line-height: 1.4;
  }

  .ok,
  .bad,
  .neutral,
  .tx-line {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.36;
  }

  .ok {
    color: #1e5a2d;
    font-weight: 700;
  }

  .bad {
    color: #8b271d;
    font-weight: 700;
  }

  .neutral {
    color: #6a4a39;
  }

  .tx-line a {
    color: #1f4f8f;
    text-decoration: underline;
  }

  .warning {
    border: 1px solid rgba(144, 93, 11, 0.3);
    border-radius: 10px;
    background: rgba(255, 236, 196, 0.73);
    padding: 9px 10px;
    z-index: 1;
  }

  .warning-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7a4c05;
  }

  .warning-desc {
    margin: 3px 0 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.74rem;
    color: #5f3e0f;
    overflow-wrap: anywhere;
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.8rem;
    color: #5e4232;
    z-index: 1;
  }

  .checkbox input {
    margin-top: 2px;
  }

  .proves {
    padding: 16px 18px;
    display: grid;
    gap: 8px;
  }

  .proves h2 {
    margin: 0;
    font-family: "Fraunces", serif;
    font-size: 1.3rem;
    color: #3f281d;
  }

  .proves ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .proves li {
    border: 1px solid rgba(93, 58, 39, 0.21);
    border-radius: 10px;
    padding: 10px 11px;
    background: rgba(255, 249, 238, 0.84);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.9rem;
    color: #3f2c20;
  }

  .tip {
    font-size: 0.94rem;
    color: #6f503d;
    cursor: help;
  }

  .below-fold {
    display: grid;
    gap: 12px;
  }

  .collapse {
    padding: 0;
    overflow: hidden;
  }

  .collapse summary {
    list-style: none;
    cursor: pointer;
    padding: 14px 16px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-size: 0.82rem;
    color: #5b3b2d;
    border-bottom: 1px solid rgba(95, 59, 39, 0.17);
  }

  .collapse summary::-webkit-details-marker {
    display: none;
  }

  .collapse-body {
    padding: 14px 16px 16px;
    display: grid;
    gap: 8px;
  }

  .collapse-body h3 {
    margin: 6px 0 0;
    font-size: 0.9rem;
    color: #453126;
  }

  .collapse-body p {
    margin: 0;
    color: #5f4232;
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .collapse-body pre {
    margin: 0;
    border: 1px solid rgba(86, 56, 38, 0.2);
    border-radius: 10px;
    background: rgba(255, 246, 229, 0.84);
    padding: 9px 11px;
    overflow: auto;
  }

  .collapse-body code {
    font-size: 0.76rem;
    color: #2d1d14;
  }

  .deck-grid {
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .slide {
    border: 1px solid rgba(87, 54, 36, 0.26);
    border-radius: 12px;
    padding: 12px;
    background:
      linear-gradient(180deg, rgba(255, 249, 238, 0.95), rgba(251, 238, 214, 0.8));
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }

  .slide:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 18px rgba(80, 49, 30, 0.16);
  }

  .slide h4 {
    margin: 0 0 6px;
    font-family: "Fraunces", serif;
    font-size: 1rem;
    color: #4b2f22;
  }

  .slide p {
    margin: 0;
    font-size: 0.86rem;
    color: #604334;
    line-height: 1.4;
  }

  @media (max-width: 900px) {
    .suite-grid {
      grid-template-columns: 1fr;
    }

    .system-tabs {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .farm-shell {
      padding: 58px 14px 76px;
    }

    .hero,
    .proof-suite {
      padding: 14px;
    }
  }
</style>
