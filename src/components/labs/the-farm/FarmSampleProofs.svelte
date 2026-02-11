<script lang="ts">
    import { FARM_SAMPLE_PROOFS, type FarmSampleProof } from "../../../data/farmSampleProofs";
    import { TIER_CONFIG } from "./zkTypes";

    let copiedId = $state<string | null>(null);
    let usedId = $state<string | null>(null);
    let errorId = $state<string | null>(null);

    function tierIcon(tierIndex: number): string {
        return TIER_CONFIG[tierIndex]?.icon ?? "🌱";
    }

    function tierColor(tierIndex: number): string {
        return TIER_CONFIG[tierIndex]?.color ?? "#86efac";
    }

    async function copyJson(sample: FarmSampleProof) {
        const payload = {
            _demo: true,
            id: sample.id,
            tier: sample.tier,
            proofPacket: sample.proofPacket,
            proofResult: sample.proofResult,
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            copiedId = sample.id;
            setTimeout(() => { if (copiedId === sample.id) copiedId = null; }, 2000);
        } catch {
            // Fallback: select a temporary textarea
            const ta = document.createElement("textarea");
            ta.value = JSON.stringify(payload, null, 2);
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            copiedId = sample.id;
            setTimeout(() => { if (copiedId === sample.id) copiedId = null; }, 2000);
        }
    }

    function useProof(sample: FarmSampleProof) {
        if (!sample.isValid) {
            errorId = sample.id;
            setTimeout(() => { if (errorId === sample.id) errorId = null; }, 4000);
            return;
        }

        // Look for a proof input on the page (textarea or input)
        const textarea = document.querySelector<HTMLTextAreaElement>(
            'textarea[name*="proof"], textarea[data-proof], textarea.proof-input'
        );
        const input = document.querySelector<HTMLInputElement>(
            'input[name*="proof"], input[data-proof], input.proof-input'
        );

        const payload = JSON.stringify(sample.proofResult, null, 2);

        if (textarea) {
            textarea.value = payload;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (input) {
            input.value = payload;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Signal success regardless — the proof is "loaded"
        usedId = sample.id;
        setTimeout(() => { if (usedId === sample.id) usedId = null; }, 2000);
    }
</script>

<section class="sample-proofs">
    <h2 class="sp-heading">Sample Proofs</h2>
    <p class="sp-description">
        Demo proofs for testing. These never leave your browser.
    </p>

    <div class="sp-grid">
        {#each FARM_SAMPLE_PROOFS as sample (sample.id)}
            <div
                class="sp-card"
                class:sp-card--invalid={!sample.isValid}
                style="--tier-color: {tierColor(sample.tierIndex)}"
            >
                <div class="sp-card-header">
                    <span class="sp-card-icon">{tierIcon(sample.tierIndex)}</span>
                    <div class="sp-card-titles">
                        <h3 class="sp-card-label">{sample.label}</h3>
                        <span class="sp-card-tier">Tier: {sample.tier}</span>
                    </div>
                    {#if !sample.isValid}
                        <span class="sp-badge sp-badge--invalid">Invalid</span>
                    {:else if sample.isEdgeCase}
                        <span class="sp-badge sp-badge--edge">Edge Case</span>
                    {/if}
                </div>

                <p class="sp-card-desc">{sample.description}</p>

                {#if errorId === sample.id}
                    <p class="sp-card-error" aria-live="polite">
                        This proof didn't pass verification — that's expected for this demo!
                    </p>
                {/if}

                <div class="sp-card-actions">
                    <button
                        class="sp-btn sp-btn--use"
                        onclick={() => useProof(sample)}
                    >
                        {#if usedId === sample.id}
                            Loaded!
                        {:else}
                            Use This Proof
                        {/if}
                    </button>

                    <button
                        class="sp-btn sp-btn--copy"
                        onclick={() => copyJson(sample)}
                    >
                        {#if copiedId === sample.id}
                            Copied!
                        {:else}
                            Copy JSON
                        {/if}
                    </button>
                </div>
            </div>
        {/each}
    </div>
</section>

<style>
    .sample-proofs {
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 20px 64px;
    }

    .sp-heading {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.5px;
        color: #e8f2ff;
        margin: 0 0 8px;
    }

    .sp-description {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 14px;
        color: #8899aa;
        margin: 0 0 32px;
    }

    .sp-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
    }

    @media (min-width: 640px) {
        .sp-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    @media (min-width: 1024px) {
        .sp-grid {
            grid-template-columns: repeat(3, 1fr);
        }
    }

    .sp-card {
        background: rgba(10, 18, 30, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .sp-card:hover {
        border-color: var(--tier-color, rgba(255, 255, 255, 0.15));
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
    }

    .sp-card--invalid {
        border-color: rgba(239, 68, 68, 0.25);
    }

    .sp-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .sp-card-icon {
        font-size: 24px;
        line-height: 1;
    }

    .sp-card-titles {
        flex: 1;
        min-width: 0;
    }

    .sp-card-label {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 16px;
        font-weight: 700;
        color: #e8f2ff;
        margin: 0;
        line-height: 1.2;
    }

    .sp-card-tier {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 11px;
        color: var(--tier-color, #8899aa);
        letter-spacing: 0.5px;
    }

    .sp-badge {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 3px 8px;
        border-radius: 6px;
        white-space: nowrap;
    }

    .sp-badge--invalid {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
        border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .sp-badge--edge {
        background: rgba(250, 204, 21, 0.1);
        color: #facc15;
        border: 1px solid rgba(250, 204, 21, 0.25);
    }

    .sp-card-desc {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 13px;
        color: #8899aa;
        line-height: 1.5;
        margin: 0;
    }

    .sp-card-error {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 12px;
        color: #fca5a5;
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 8px;
        padding: 8px 12px;
        margin: 0;
        line-height: 1.4;
    }

    .sp-card-actions {
        display: flex;
        gap: 8px;
        margin-top: auto;
        padding-top: 8px;
    }

    .sp-btn {
        font-family: "Inter", system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        white-space: nowrap;
    }

    .sp-btn--use {
        background: rgba(122, 255, 207, 0.1);
        color: #7affcf;
        border-color: rgba(122, 255, 207, 0.25);
    }

    .sp-btn--use:hover {
        background: rgba(122, 255, 207, 0.2);
        border-color: rgba(122, 255, 207, 0.4);
    }

    .sp-btn--copy {
        background: rgba(255, 255, 255, 0.05);
        color: #b6c8dd;
    }

    .sp-btn--copy:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
    }
</style>
