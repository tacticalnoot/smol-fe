<script lang="ts">
  import {
    FARM_ATTESTATIONS_CONTRACT_ID_MAINNET,
    MAINNET_RPC_URL,
    isMainnetConfigured,
  } from "../../../config/farmAttestation";
  import {
    circomSamples,
    circomVerificationKey,
  } from "../../../data/the-farm/circomBundle";
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

  function setVerifyResult(
    system: ProofSystem,
    tier: Tier,
    result: VerificationResult,
  ): void {
    verificationByKey = {
      ...verificationByKey,
      [sampleKey(system, tier)]: result,
    };
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

  function formatDuration(ms: number): string {
    return `${ms.toFixed(0)}ms`;
  }

  function canPublish(system: ProofSystem, sample: FarmSampleProof): boolean {
    const key = sampleKey(system, sample.tier);
    const verifyResult = verificationByKey[key];
    return (
      !!verifyResult?.valid && sample.expectedValid && sample.tier !== "invalid"
    );
  }

  async function verifyLocally(system: ProofSystem): Promise<void> {
    const sample = getSample(system);
    setPanelError(system, null);
    setVerifying(system, true);

    try {
      let result: VerificationResult;

      if (system === "circom") {
        result = await verifyCircomGroth16(
          circomVerificationKey,
          sample.proof,
          sample.publicInputs,
        );
      } else if (system === "noir") {
        result = await verifyNoirProof(noirVerifierBytecode, sample.proof);
      } else {
        result = await verifyRisc0Receipt(risc0MethodIdHex, sample.proof);
      }

      setVerifyResult(system, sample.tier, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Local verification failed";
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
      setPanelError(
        system,
        `Missing env: ${getMissingMainnetVars().join(", ")}`,
      );
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
      const message =
        error instanceof Error ? error.message : "Mainnet attestation failed";
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
        Three independent proof systems. Local cryptographic verification
        in-browser. Mainnet passkey-signed attestations on Stellar.
      </p>
      <div class="hero-metrics">
        <div class="metric">
          <span class="label">Wallet Tier</span>
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
          <span class="label">KALE Balance</span>
          <span class="value"
            >{loading
              ? "Loading..."
              : balance
                ? `${formatKaleBalance(balance)} KALE`
                : "0 KALE"}</span
          >
        </div>
        <div class="metric">
          <span class="label">Wallet</span>
          <span class="value"
            >{isAuth ? "Passkey Connected" : "Connect Passkey Wallet"}</span
          >
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
              <span class="v" title={activeSample.proofDigest}
                >{shortHash(activeSample.proofDigest)}</span
              >
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
                <p class="ok">
                  Verified locally (cryptographic) in {formatDuration(
                    activeVerifyResult.durationMs,
                  )}
                </p>
              {:else}
                <p class="bad">
                  Invalid proof - {activeVerifyResult.error ??
                    "verification returned false"}
                </p>
              {/if}
            {:else}
              <p class="neutral">
                Run local verification to produce a cryptographic result.
              </p>
            {/if}
          </div>
        </div>

        <div class="panel plot">
          <h3>Attest on Mainnet</h3>
          <p class="small">
            Publish only digest-level claim data for this verified sample using
            your passkey smart wallet.
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
                setAcknowledged(
                  activeSystem,
                  (event.currentTarget as HTMLInputElement).checked,
                )}
            />
            <span>I understand this is MAINNET and costs real XLM.</span>
          </label>

          <button
            type="button"
            class="action attest"
            disabled={!canPublish(activeSystem, activeSample) ||
              !acknowledgedMainnet[activeSystem] ||
              publishing[activeSystem] ||
              !mainnetReady ||
              !isAuth}
            on:click={() => attestOnMainnet(activeSystem)}
          >
            {publishing[activeSystem]
              ? "Submitting to Mainnet..."
              : "Attest on Mainnet"}
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
              <p class="neutral">
                Ledger: {activeAttestResult.ledger ?? "n/a"}
              </p>
              <p class="neutral">
                Fee Charged: {activeAttestResult.feeCharged ?? "n/a"}
              </p>
            {:else if activeAttestResult && !activeAttestResult.ok}
              <p class="bad">
                {activeAttestResult.error ?? "Mainnet attestation failed"}
              </p>
            {:else}
              <p class="neutral">
                No mainnet attestation submitted for this sample yet.
              </p>
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
          <span
            class="tip"
            title="The proof enforces balance >= selected threshold.">ⓘ</span
          >
        </li>
        <li>
          <span>Commitment binds hidden value</span>
          <span
            class="tip"
            title="Commitment digest is tied to private witness values without revealing them."
            >ⓘ</span
          >
        </li>
        <li>
          <span>Passkey smart wallet signed the claim on mainnet</span>
          <span
            class="tip"
            title="The attest transaction is signed by your passkey wallet and posted to Stellar Mainnet."
            >ⓘ</span
          >
        </li>
      </ul>
    </section>

    <section class="below-fold">
      <details class="card collapse">
        <summary>Field Guide</summary>
        <div class="collapse-body">
          <h3>How each proof system works</h3>
          <p>
            <strong>Circom:</strong> Groth16 over bundled verification key with local
            `snarkjs` verification.
          </p>
          <p>
            <strong>Noir:</strong> UltraHonk proof checked in a worker through `bb.js`
            verifier logic.
          </p>
          <p>
            <strong>RISC0:</strong> Receipt verification in a local WASM verifier
            against the method ID digest.
          </p>

          <h3>What gets published on-chain</h3>
          <p>
            Only `statementHash` and `verifierHash` digests plus
            owner/system/tier metadata. Proof material is never published.
          </p>

          <h3>Threat model</h3>
          <p>
            Local verification blocks forged samples. Invalid or tampered proof
            artifacts fail verification and cannot be attested from the UI.
          </p>

          <h3>Repro commands</h3>
          <pre><code
              >bash zk/circom-tier/scripts/verify_samples.sh
bash zk/noir-tier/scripts/verify_samples.sh
bash zk/risc0-tier/scripts/verify_samples.sh
bash scripts/the-farm/no-stubs.sh
bash scripts/the-farm/no-leaks.sh</code
            ></pre>
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
            <p>
              Three local proof systems plus mainnet digest attestations signed
              by passkeys.
            </p>
          </article>
          <article class="slide">
            <h4>3. Architecture</h4>
            <p>
              Browser verifier workers -> digest build -> Soroban attest
              contract on Stellar Mainnet.
            </p>
          </article>
          <article class="slide">
            <h4>4. Proof Comparison</h4>
            <p>
              Circom Groth16, Noir UltraHonk, RISC0 receipts, each independently
              verifiable.
            </p>
          </article>
          <article class="slide">
            <h4>5. Mainnet Attestation</h4>
            <p>
              Passkey smart wallet signs `attest(owner, system, tier,
              statementHash, verifierHash)`.
            </p>
          </article>
          <article class="slide">
            <h4>6. Privacy Guarantees</h4>
            <p>
              Proof/witness/salt are never sent to server and never stored in
              browser persistence.
            </p>
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
        rgba(255, 255, 255, 0.15) 1px,
        transparent 1px
      ),
      radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px);
    background-size:
      24px 24px,
      42px 42px;
    background-position:
      0 0,
      12px 18px;
    opacity: 0.6;
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
    border-radius: 16px;
    background: var(--farm-card);
    backdrop-filter: blur(12px);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .hero {
    padding: 26px;
    display: grid;
    gap: 12px;
  }

  .hero-top h1 {
    margin: 0;
    font-family: "Press Start 2P", cursive;
    font-size: clamp(1.5rem, 2.5vw, 2.2rem);
    line-height: 1.4;
    letter-spacing: 0.05em;
    color: var(--farm-leaf);
    text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
  }

  .eyebrow {
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.7rem;
    color: var(--farm-sun);
    font-family: "Press Start 2P", cursive;
  }

  .hero-sub {
    margin: 0;
    max-width: 72ch;
    color: var(--farm-ink);
    font-size: 1rem;
    line-height: 1.6;
    opacity: 0.9;
  }

  .hero-metrics {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
  }

  .metric {
    border: 1px solid var(--farm-line);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.3);
    padding: 14px;
    display: grid;
    gap: 6px;
  }

  .metric .label {
    font-size: 0.65rem;
    color: var(--farm-leaf);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: "Press Start 2P", cursive;
    opacity: 0.8;
  }

  .metric .value {
    font-size: 1rem;
    color: #fff;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .metric .value img.tier-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }

  .proof-suite {
    padding: 24px;
    display: grid;
    gap: 20px;
  }

  .suite-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .suite-head h2 {
    margin: 0;
    font-family: "Press Start 2P", cursive;
    font-size: 1.1rem;
    color: var(--farm-leaf);
    text-shadow: 0 0 8px rgba(74, 222, 128, 0.4);
  }

  .suite-head p {
    margin: 8px 0 0;
    color: var(--farm-ink);
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  .chip {
    border: 1px solid var(--farm-line);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 0.6rem;
    font-family: "Press Start 2P", cursive;
    color: var(--farm-sun);
    background: rgba(74, 222, 128, 0.1);
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.1);
  }

  @keyframes pulse-chip {
    0%,
    100% {
      box-shadow: 0 0 8px rgba(74, 222, 128, 0.1);
    }
    50% {
      box-shadow: 0 0 12px rgba(74, 222, 128, 0.3);
    }
  }

  .system-tabs {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .tab-btn {
    border: 1px solid var(--farm-line);
    background: rgba(0, 0, 0, 0.3);
    color: var(--farm-ink);
    border-radius: 8px;
    padding: 12px;
    font-family: "Press Start 2P", cursive;
    font-size: 0.7rem;
    line-height: 1.4;
    transition: all 0.2s ease;
    cursor: pointer;
    text-align: center;
  }

  .tab-btn:hover {
    transform: translateY(-2px);
    border-color: var(--farm-leaf);
    box-shadow: 0 0 10px rgba(74, 222, 128, 0.2);
  }

  .tab-btn.active {
    border-color: var(--farm-leaf);
    background: rgba(74, 222, 128, 0.15);
    color: #fff;
    box-shadow: 0 0 15px rgba(74, 222, 128, 0.25);
  }

  .suite-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }

  .panel {
    border: 1px solid var(--farm-line);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
    padding: 18px;
    display: grid;
    gap: 14px;
  }

  .plot {
    position: relative;
    overflow: hidden;
  }

  .plot::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
        90deg,
        rgba(74, 222, 128, 0.05) 1px,
        transparent 1px
      ),
      linear-gradient(0deg, rgba(74, 222, 128, 0.05) 1px, transparent 1px);
    background-size: 20px 20px;
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
    border: 1px solid var(--farm-line);
    border-radius: 9px;
    padding: 7px 9px;
    background: rgba(0, 0, 0, 0.4);
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
    gap: 7px;
    align-items: center;
  }

  .meta-item .k {
    font-size: 0.67rem;
    color: var(--farm-leaf);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .meta-item .v {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.76rem;
    color: #fff;
    opacity: 0.9;
    overflow-wrap: anywhere;
  }

  .action {
    border: none;
    border-radius: 11px;
    padding: 10px 14px;
    font-weight: 800;
    cursor: pointer;
    transition:
      transform 0.16s ease,
      filter 0.16s ease,
      opacity 0.16s ease;
    z-index: 1;
    font-family: "Press Start 2P", cursive;
    font-size: 0.7rem;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .action:hover:not(:disabled) {
    transform: translateY(-1px) scale(1.006);
    filter: brightness(1.2);
    box-shadow: 0 0 12px var(--farm-leaf);
  }

  .action:disabled {
    opacity: 0.56;
    cursor: not-allowed;
    filter: grayscale(1);
  }

  .action.verify {
    background: linear-gradient(145deg, #166534, #14532d);
    color: #f0fdf4;
    border: 1px solid #22c55e;
  }

  .action.attest {
    background: linear-gradient(145deg, #064e3b, #022c22);
    color: #ecfdf5;
    border: 1px solid #10b981;
  }

  .result-panel {
    border: 1px dashed var(--farm-line);
    border-radius: 10px;
    padding: 9px 10px;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1;
  }

  .small {
    margin: 0;
    color: var(--farm-ink);
    font-size: 0.86rem;
    line-height: 1.4;
    opacity: 0.8;
  }

  .ok,
  .bad,
  .neutral,
  .tx-line {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.36;
    font-family: "Press Start 2P", cursive;
    font-size: 0.65rem;
  }

  .ok {
    color: #4ade80;
    text-shadow: 0 0 5px rgba(74, 222, 128, 0.5);
  }

  .bad {
    color: #ef4444;
    text-shadow: 0 0 5px rgba(239, 68, 68, 0.5);
  }

  .neutral {
    color: var(--farm-ink);
    opacity: 0.7;
  }

  .tx-line a {
    color: #60a5fa;
    text-decoration: underline;
  }

  .warning {
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 10px;
    background: rgba(66, 32, 6, 0.6);
    padding: 9px 10px;
    z-index: 1;
  }

  .warning-title {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #fbbf24;
    font-family: "Press Start 2P", cursive;
  }

  .warning-desc {
    margin: 6px 0 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.74rem;
    color: #fcd34d;
    overflow-wrap: anywhere;
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--farm-ink);
    z-index: 1;
  }

  .checkbox input {
    margin-top: 2px;
    accent-color: var(--farm-leaf);
  }

  .proves {
    padding: 16px 18px;
    display: grid;
    gap: 8px;
  }

  .proves h2 {
    margin: 0;
    font-family: "Press Start 2P", cursive;
    font-size: 1rem;
    color: var(--farm-leaf);
  }

  .proves ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .proves li {
    border: 1px solid var(--farm-line);
    border-radius: 10px;
    padding: 10px 11px;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--farm-ink);
  }

  .tip {
    font-size: 0.94rem;
    color: var(--farm-sun);
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
    font-size: 0.7rem;
    color: var(--farm-leaf);
    border-bottom: 1px solid var(--farm-line);
    font-family: "Press Start 2P", cursive;
    line-height: 1.5;
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
    font-size: 0.7rem;
    color: var(--farm-sun);
    font-family: "Press Start 2P", cursive;
  }

  .collapse-body p {
    margin: 0;
    color: var(--farm-ink);
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .collapse-body pre {
    margin: 0;
    border: 1px solid var(--farm-line);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.6);
    padding: 9px 11px;
    overflow: auto;
  }

  .collapse-body code {
    font-size: 0.76rem;
    color: #a7f3d0;
  }

  .deck-grid {
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .slide {
    border: 1px solid var(--farm-line);
    border-radius: 12px;
    padding: 12px;
    background: rgba(10, 30, 20, 0.6);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease;
  }

  .slide:hover {
    transform: translateY(-2px);
    box-shadow: 0 0 15px rgba(74, 222, 128, 0.2);
    border-color: var(--farm-leaf);
  }

  .slide h4 {
    margin: 0 0 8px;
    font-family: "Press Start 2P", cursive;
    font-size: 0.7rem;
    color: var(--farm-leaf);
    line-height: 1.4;
  }

  .slide p {
    margin: 0;
    font-size: 0.86rem;
    color: var(--farm-ink);
    line-height: 1.4;
    opacity: 0.8;
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
