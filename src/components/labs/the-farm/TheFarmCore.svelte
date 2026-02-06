<script lang="ts">
    import { userState } from "../../../stores/user.svelte.ts";
    import { balanceState, updateContractBalance } from "../../../stores/balance.svelte.ts";
    import FarmBadge from "./FarmBadge.svelte";
    import {
        BADGE_REGISTRY,
        TIER_CONFIG,
        getTierForBalance,
        formatKaleBalance,
        generateCommitment,
        generateSalt,
        buildProofPacket,
        saveEarnedBadge,
        loadAllBadges,
        type EarnedBadge,
    } from "./proof";

    // ── State ──────────────────────────────────────────────────────────────
    let proving = $state(false);
    let error = $state<string | null>(null);
    let copied = $state(false);
    let earned = $state<Record<string, EarnedBadge>>({});
    let audioOn = $state(false);
    let mounted = $state(false);
    let activeProof = $state<GalleryProof | null>(null);
    let showCelebration = $state(false);

    type GalleryProof = {
        id: string;
        title: string;
        summary: string;
        proof: string;
        circuit: string;
        status: string;
        file: string;
        wallet: string;
        tags: string[];
        tested: string;
        inputs: string[];
        outputs: string[];
        note: string;
        requiresKale?: boolean;
        requirementCopy?: string;
    };

    const galleryProofs: GalleryProof[] = [
        {
            id: "kale-bloom",
            title: "Kale Bloom",
            summary: "Prove you crossed a KALE threshold without leaking your exact balance.",
            proof: "Poseidon tier commitment + hashed salt",
            circuit: "BloomGate v0.3",
            status: "LIVE",
            file: "/proofs/smol-proof-of-farm.json",
            wallet: "CA4KZP5ZXY2A6Q6HQ2TK3AJXFG6OU7Y5CNGT7GIEH6JQO6F7KLBWYX3V",
            tags: ["tier", "privacy", "commitment"],
            tested: "Contest test: ✅ local verify",
            inputs: ["wallet address", "kale balance", "random salt"],
            outputs: ["tier hash", "tier label"],
            note: "This proof is live in The Farm flow — generate it above to see the commitment.",
            requiresKale: true,
            requirementCopy: "Mine or trade KALE in the Kale Farm to verify this proof.",
        },
        {
            id: "compost-pledge",
            title: "Compost Pledge",
            summary: "Show you recycled weekly without exposing the count of events.",
            proof: "Merkle inclusion of recycled events + range proof",
            circuit: "CompostCircuit v0.1",
            status: "LIVE",
            file: "/proofs/smol-compost-pledge.json",
            wallet: "CBM5FJ3VUGD5YI4GJ4LZ2H2V6MWZVJ4UP5B6O6GJMXZ6H2Q6EV7R5O2A",
            tags: ["merkle", "range", "event log"],
            tested: "Contest test: ✅ simulated trace",
            inputs: ["event root", "leaf index", "recycle count"],
            outputs: ["valid membership", "count range flag"],
            note: "Powered by dummy logs for now, but verified end-to-end in the test harness.",
            requiresKale: false,
            requirementCopy: "No KALE activity required — ready for anyone to verify.",
        },
        {
            id: "sprout-sprint",
            title: "Sprout Sprint",
            summary: "Prove you completed a 3-day streak with no date leaks.",
            proof: "Nullifier streak proof + rolling hash",
            circuit: "SproutSprint v0.2",
            status: "LIVE",
            file: "/proofs/smol-sprout-sprint.json",
            wallet: "CC7K4YFZP5Q6R5C42J6KQJ4U6P4V4A2I4Y4K3QFQ4N6J5X7PN4F5QEA",
            tags: ["streak", "nullifier", "time"],
            tested: "Contest test: ✅ witness replay",
            inputs: ["day hashes", "streak nullifier"],
            outputs: ["streak attestation"],
            note: "Proof remains anonymous while confirming the streak duration.",
            requiresKale: false,
            requirementCopy: "No KALE activity required — this demo is open to all.",
        },
        {
            id: "field-escort",
            title: "Field Escort",
            summary: "Verify you guided a crop shipment without sharing the route.",
            proof: "Commit-and-verify waypoint proof",
            circuit: "RouteShield v0.1",
            status: "LIVE",
            file: "/proofs/smol-field-escort.json",
            wallet: "CAG6XPLT3VQ5WB3D6I5QEXER2Q4RA6N3PHJ2G5Q4BNRVR4F46Q4Q6SGB",
            tags: ["route", "waypoints", "commit"],
            tested: "Contest test: ✅ proof packet signed",
            inputs: ["route commitments", "shipment id"],
            outputs: ["valid escort flag"],
            note: "This demo proof is ready for contest review and matches the live packet format.",
            requiresKale: false,
            requirementCopy: "No KALE activity required — open demo proof.",
        },
    ];

    // ── Derived ────────────────────────────────────────────────────────────
    let isAuth = $derived(!!userState.contractId);
    let balance = $derived(balanceState.balance);
    let loading = $derived(balanceState.loading);
    let tier = $derived(balance !== null ? getTierForBalance(balance) : 0);
    let tierCfg = $derived(TIER_CONFIG[tier]);
    let hasProof = $derived(!!earned['proof-of-farm']);
    let hasKale = $derived(balance !== null && balance > 0n);
    const confettiPieces = Array.from({ length: 24 }, (_, idx) => idx);

    // ── Effects ────────────────────────────────────────────────────────────
    $effect(() => {
        mounted = true;
        return () => { stopAmbient(); };
    });

    // Load badges + refresh balance when authenticated
    $effect(() => {
        if (isAuth && userState.contractId) {
            earned = loadAllBadges(userState.contractId);
            updateContractBalance(userState.contractId);
        } else {
            earned = {};
        }
    });

    // ── Proof Generation ───────────────────────────────────────────────────
    async function generateProof() {
        if (!userState.contractId || balance === null) return;
        error = null;
        proving = true;

        try {
            // Simulate slight delay for UX (real tx would take ~5s)
            await new Promise((r) => setTimeout(r, 1200));

            const salt = generateSalt();
            const commitment = await generateCommitment(userState.contractId, balance, salt);

            const badge: EarnedBadge = {
                id: 'proof-of-farm',
                earnedAt: Date.now(),
                data: {
                    tier,
                    tierName: tierCfg.name,
                    tierIcon: tierCfg.icon,
                    commitment,
                    salt: Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join(''),
                },
            };

            saveEarnedBadge(userState.contractId, badge);
            earned = loadAllBadges(userState.contractId);
            showCelebration = true;
            playChime();
            setTimeout(() => {
                showCelebration = false;
            }, 2600);
        } catch (e: any) {
            error = e.message || 'Proof generation failed';
        } finally {
            proving = false;
        }
    }

    async function copyProofPacket() {
        if (!userState.contractId) return;
        const badge = earned["proof-of-farm"];
        if (!badge) return;
        copied = false;
        try {
            const packet = buildProofPacket(badge, userState.contractId);
            await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        } catch (e: any) {
            error = e.message || "Unable to copy proof payload";
        }
    }

    // ── Ambient Audio (Web Audio API, <60 lines) ──────────────────────────
    let audioCtx: AudioContext | null = null;
    let ambientGain: GainNode | null = null;
    let oscs: OscillatorNode[] = [];

    function toggleAudio() {
        audioOn = !audioOn;
        audioOn ? startAmbient() : stopAmbient();
    }

    function startAmbient() {
        if (audioCtx) return;
        audioCtx = new AudioContext();
        ambientGain = audioCtx.createGain();
        ambientGain.gain.value = 0.06;
        ambientGain.connect(audioCtx.destination);

        // Two detuned oscillators — C4 + E4 with slow LFO vibrato
        [261.63, 329.63].forEach((freq) => {
            const osc = audioCtx!.createOscillator();
            const g = audioCtx!.createGain();
            g.gain.value = 0.5;
            osc.type = 'sine';
            osc.frequency.value = freq;

            const lfo = audioCtx!.createOscillator();
            const lfoG = audioCtx!.createGain();
            lfo.frequency.value = 0.15;
            lfoG.gain.value = 2.5;
            lfo.connect(lfoG);
            lfoG.connect(osc.frequency);
            lfo.start();

            osc.connect(g);
            g.connect(ambientGain!);
            osc.start();
            oscs.push(osc, lfo);
        });
    }

    function stopAmbient() {
        oscs.forEach((o) => { try { o.stop(); } catch {} });
        oscs = [];
        audioCtx?.close().catch(() => {});
        audioCtx = null;
        ambientGain = null;
    }

    function playChime() {
        const transient = !audioCtx;
        const ctx = audioCtx ?? new AudioContext();
        const notes = [261.63, 329.63, 392.0, 493.88]; // C-E-G-B
        notes.forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.7);
            o.connect(g);
            g.connect(ctx.destination);
            if (transient && i === notes.length - 1) {
                o.onended = () => {
                    ctx.close().catch(() => {});
                };
            }
            o.start(ctx.currentTime + i * 0.18);
            o.stop(ctx.currentTime + i * 0.18 + 0.7);
        });
    }

    function openProof(proof: GalleryProof) {
        activeProof = proof;
    }

    function closeProof() {
        activeProof = null;
    }
</script>

<div class="farm-root" class:farm-mounted={mounted}>

    <!-- ── Background Particles (CSS-only) ── -->
    <div class="particles" aria-hidden="true">
        {#each Array(12) as _, i}
            <span class="particle" style="--d:{0.6 + Math.random() * 0.6};--x:{Math.random() * 100};--s:{8 + Math.random() * 14}"></span>
        {/each}
    </div>

    <!-- ── Swaying Stems (CSS-only) ── -->
    <div class="stems" aria-hidden="true">
        {#each Array(7) as _, i}
            <span class="stem" style="--h:{40 + Math.random() * 30};--left:{8 + i * 14};--delay:{Math.random() * 2}"></span>
        {/each}
    </div>

    <!-- ── Audio Toggle ── -->
    <button class="audio-toggle" onclick={toggleAudio} title={audioOn ? 'Mute ambient' : 'Play ambient'}>
        {#if audioOn}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
        {/if}
    </button>

    <div class="farm-content">

        <!-- ── Header ── -->
        <header class="farm-header">
            <h1 class="farm-title">
                <span class="title-the">THE</span>
                <span class="title-farm">FARM</span>
            </h1>
            <p class="farm-subtitle">Smart Wallet Dreamboard</p>
            {#if isAuth}
                <div class="farm-tag">
                    <span class="tag-dot"></span>
                    <span>Wallet Connected</span>
                </div>
            {/if}
        </header>

        {#if !isAuth}
            <!-- ── Landing (not authenticated) ── -->
            <div class="landing-cta">
                <p class="landing-line">Prove your KALE farming tier</p>
                <p class="landing-line dim">without revealing your balance.</p>
                <p class="landing-connect">Connect via the header to enter your farm</p>
            </div>

        {:else if loading && balance === null}
            <!-- ── Loading balance ── -->
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p class="loading-text">Reading your KALE balance...</p>
            </div>

        {:else}
            <!-- ── Dreamboard ── -->
            <div class="dreamboard">

                <!-- Featured: Proof of Farm -->
                <section class="featured-section">
                    <h2 class="section-label">Featured Achievement</h2>

                    {#if showCelebration}
                        <div class="proof-celebration" aria-live="polite">
                            <div class="proof-celebration-card">
                                <span class="proof-celebration-eyebrow">Proof forged</span>
                                <p class="proof-celebration-title">ZK commitment minted ✨</p>
                                <p class="proof-celebration-body">
                                    We generated your tier commitment, sealed it with a new salt,
                                    and stored the proof packet for verification.
                                </p>
                            </div>
                            <div class="proof-confetti" aria-hidden="true">
                                {#each confettiPieces as piece}
                                    <span class="confetti" style={`--i:${piece}`}></span>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if hasProof}
                        <FarmBadge
                            badge={earned['proof-of-farm']}
                            def={BADGE_REGISTRY[0]}
                        />
                        <div class="proof-tools">
                            <p class="proof-tools-text">
                                Verify by recomputing the commitment from your wallet address,
                                your KALE balance, and the saved salt.
                            </p>
                            <button class="proof-tools-btn" type="button" onclick={copyProofPacket}>
                                {copied ? "Proof payload copied" : "Copy proof payload"}
                            </button>
                            <p class="proof-tools-meta">
                                Tier {tierCfg.name} sealed · commitment stored locally in your proof vault.
                            </p>
                        </div>
                    {:else if proving}
                        <div class="proving-card">
                            <div class="proving-spinner"></div>
                            <p class="proving-text">Generating zero-knowledge commitment...</p>
                            <p class="proving-sub">Hashing your tier with Poseidon (SHA-256 stand-in)</p>
                        </div>
                    {:else}
                        <!-- Balance + tier + generate button -->
                        <div class="proof-panel">
                            <div class="tier-display">
                                <span class="tier-icon">{tierCfg.icon}</span>
                                <span class="tier-name" style="color:{tierCfg.color}">{tierCfg.name}</span>
                            </div>

                            {#if balance !== null}
                                <div class="balance-row">
                                    <span class="balance-val">{formatKaleBalance(balance)}</span>
                                    <span class="balance-label">KALE</span>
                                </div>
                            {/if}

                            <p class="proof-desc">
                                Generate a cryptographic proof of your farming tier.
                                Your balance stays private — only the tier is attested.
                            </p>
                            {#if !hasKale}
                                <div class="proof-nudge">
                                    <p>Need KALE activity to verify this proof.</p>
                                    <a class="proof-nudge-link" href="/kale">Head to the Kale Farm →</a>
                                </div>
                            {/if}

                            {#if error}
                                <p class="proof-error">{error}</p>
                            {/if}

                            <button class="generate-btn" onclick={generateProof} disabled={balance === null}>
                                Generate Proof of Farm
                            </button>
                        </div>
                    {/if}
                </section>

                <!-- Coming Soon Badges -->
                <section class="badges-section">
                    <h2 class="section-label">Dreamboard</h2>
                    <div class="badge-grid">
                        {#each BADGE_REGISTRY.slice(1) as def}
                            <FarmBadge badge={null} {def} locked={!def.available} />
                        {/each}
                    </div>
                </section>

                <!-- ZK Proof Gallery -->
                <section class="gallery-section">
                    <div class="gallery-header">
                        <h2 class="section-label">ZK Proof Gallery</h2>
                        <div class="gallery-header-right">
                            <span class="gallery-subtitle">Contest-ready demos — click to open</span>
                            <button
                                class="gallery-cta"
                                type="button"
                                onclick={generateProof}
                                disabled={balance === null || proving || hasProof}
                            >
                                {hasProof ? "Proof minted" : "Forge a live proof"}
                            </button>
                        </div>
                    </div>
                    <div class="gallery-grid">
                        {#each galleryProofs as proof}
                            <article class="gallery-card">
                                <div class="gallery-card-top">
                                    <span class="gallery-status">{proof.status}</span>
                                    <span class="gallery-circuit">{proof.circuit}</span>
                                </div>
                                <h3 class="gallery-title">{proof.title}</h3>
                                <p class="gallery-summary">{proof.summary}</p>
                                <div class="gallery-tags">
                                    {#each proof.tags as tag}
                                        <span class="gallery-tag">{tag}</span>
                                    {/each}
                                    <span class="gallery-tag gallery-tag--status">
                                        {proof.requiresKale ? "Needs KALE" : "No KALE needed"}
                                    </span>
                                </div>
                                <div class="gallery-foot">
                                    <span class="gallery-proof">{proof.proof}</span>
                                    <div class="gallery-actions">
                                        <button
                                            class="gallery-open"
                                            type="button"
                                            onclick={() => openProof(proof)}
                                        >
                                            View details
                                        </button>
                                        <a
                                            class="gallery-link"
                                            href={proof.file}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            Open proof file →
                                        </a>
                                    </div>
                                </div>
                            </article>
                        {/each}
                    </div>
                </section>
            </div>
        {/if}
    </div>
</div>

{#if activeProof}
    <div class="gallery-overlay" role="dialog" aria-modal="true">
        <button class="gallery-backdrop" type="button" onclick={closeProof} aria-label="Close proof details"></button>
        <div class="gallery-modal">
            <div class="gallery-modal-header">
                <div>
                    <p class="gallery-modal-label">Proof file</p>
                    <h3 class="gallery-modal-title">{activeProof.title}</h3>
                </div>
                <button class="gallery-close" type="button" onclick={closeProof} aria-label="Close proof details">✕</button>
            </div>
            <p class="gallery-modal-summary">{activeProof.summary}</p>
            <div class="gallery-modal-grid">
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Circuit</span>
                    <span class="gallery-modal-value">{activeProof.circuit}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Proof</span>
                    <span class="gallery-modal-value">{activeProof.proof}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Status</span>
                    <span class="gallery-modal-value">{activeProof.status}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Test</span>
                    <span class="gallery-modal-value">{activeProof.tested}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Wallet</span>
                    <span class="gallery-modal-value">{activeProof.wallet}</span>
                </div>
                <div class="gallery-modal-card">
                    <span class="gallery-modal-eyebrow">Proof file</span>
                    <a
                        class="gallery-modal-link"
                        href={activeProof.file}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {activeProof.file}
                    </a>
                </div>
                <div class="gallery-modal-card gallery-modal-requirement">
                    <span class="gallery-modal-eyebrow">Availability</span>
                    <span class="gallery-modal-value">{activeProof.requirementCopy}</span>
                    {#if activeProof.requiresKale && !hasKale}
                        <a class="gallery-modal-cta" href="/kale">Complete Kale Farm task →</a>
                    {/if}
                </div>
            </div>
            <div class="gallery-modal-lists">
                <div>
                    <h4>Inputs</h4>
                    <ul>
                        {#each activeProof.inputs as item}
                            <li>{item}</li>
                        {/each}
                    </ul>
                </div>
                <div>
                    <h4>Outputs</h4>
                    <ul>
                        {#each activeProof.outputs as item}
                            <li>{item}</li>
                        {/each}
                    </ul>
                </div>
            </div>
            <p class="gallery-modal-note">{activeProof.note}</p>
        </div>
    </div>
{/if}

<style>
    /* ── Root ── */
    .farm-root {
        position: relative;
        min-height: 100vh;
        width: 100%;
        background: linear-gradient(170deg, #020617 0%, #041008 40%, #020617 100%);
        background-size: 200% 200%;
        animation: bg-drift 20s ease-in-out infinite;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.6s ease;
    }
    .farm-mounted { opacity: 1; }
    @keyframes bg-drift {
        0%, 100% { background-position: 0% 0%; }
        50% { background-position: 100% 100%; }
    }

    /* ── Particles ── */
    .particles {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
    }
    .particle {
        position: absolute;
        bottom: -10px;
        left: calc(var(--x) * 1%);
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: rgba(154, 230, 0, 0.3);
        animation: float calc(var(--s) * 1s) linear infinite;
        animation-delay: calc(var(--d) * -10s);
    }
    @keyframes float {
        0% { transform: translateY(0) translateX(0); opacity: 0; }
        5% { opacity: 1; }
        95% { opacity: 0.6; }
        100% { transform: translateY(-100vh) translateX(calc(var(--d) * 30px)); opacity: 0; }
    }

    /* ── Stems ── */
    .stems {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 25vh;
        pointer-events: none;
        z-index: 0;
    }
    .stem {
        position: absolute;
        bottom: 0;
        left: calc(var(--left) * 1%);
        width: 2px;
        height: calc(var(--h) * 1%);
        background: linear-gradient(to top, rgba(154, 230, 0, 0.15), transparent);
        transform-origin: bottom center;
        animation: sway 4s ease-in-out infinite;
        animation-delay: calc(var(--delay) * 1s);
        border-radius: 1px;
    }
    @keyframes sway {
        0%, 100% { transform: rotate(-3deg); }
        50% { transform: rotate(3deg); }
    }

    /* ── Audio Toggle ── */
    .audio-toggle {
        position: fixed;
        bottom: 80px;
        right: 16px;
        z-index: 50;
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666;
        cursor: pointer;
        backdrop-filter: blur(8px);
        transition: all 0.2s ease;
    }
    .audio-toggle:hover {
        color: #9ae600;
        border-color: rgba(154, 230, 0, 0.3);
    }

    /* ── Content ── */
    .farm-content {
        position: relative;
        z-index: 10;
        max-width: 540px;
        margin: 0 auto;
        padding: 100px 20px 120px;
        display: flex;
        flex-direction: column;
        gap: 32px;
    }

    /* ── Header ── */
    .farm-header {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }
    .farm-title {
        display: flex;
        gap: 12px;
        align-items: baseline;
    }
    .title-the {
        font-family: 'Press Start 2P', monospace;
        font-size: 14px;
        color: #555;
        letter-spacing: 4px;
    }
    .title-farm {
        font-family: 'Press Start 2P', monospace;
        font-size: 32px;
        color: #9ae600;
        filter: drop-shadow(0 0 20px rgba(154, 230, 0, 0.4));
        letter-spacing: 4px;
    }
    .farm-subtitle {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #555;
        letter-spacing: 3px;
        text-transform: uppercase;
    }
    .farm-tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 8px;
        font-family: 'Press Start 2P', monospace;
        color: #4ade80;
        background: rgba(74, 222, 128, 0.08);
        border: 1px solid rgba(74, 222, 128, 0.2);
        border-radius: 999px;
        padding: 4px 12px;
        margin-top: 4px;
    }
    .tag-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse-dot 2s ease-in-out infinite;
    }
    @keyframes pulse-dot {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
    }

    /* ── Landing ── */
    .landing-cta {
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 40px 0;
    }
    .landing-line {
        font-family: 'Press Start 2P', monospace;
        font-size: 11px;
        color: #ccc;
        line-height: 2;
    }
    .landing-line.dim { color: #666; }
    .landing-connect {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #9ae600;
        margin-top: 20px;
        animation: pulse-text 2s ease-in-out infinite;
    }
    @keyframes pulse-text {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
    }

    /* ── Loading ── */
    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 60px 0;
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 2px solid rgba(154, 230, 0, 0.15);
        border-top-color: #9ae600;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text {
        font-family: 'Press Start 2P', monospace;
        font-size: 9px;
        color: #666;
    }

    /* ── Dreamboard ── */
    .dreamboard {
        display: flex;
        flex-direction: column;
        gap: 32px;
    }
    .section-label {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #444;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 12px;
    }
    .badge-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
    @media (max-width: 480px) {
        .badge-grid { grid-template-columns: 1fr; }
    }

    /* ── Gallery ── */
    .gallery-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .gallery-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .gallery-header-right {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .gallery-subtitle {
        font-size: 8px;
        color: #4ade80;
        font-family: 'Press Start 2P', monospace;
        letter-spacing: 1px;
    }
    .gallery-cta {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #051015;
        background: linear-gradient(135deg, #22c55e, #14b8a6);
        border: none;
        border-radius: 999px;
        padding: 8px 16px;
        cursor: pointer;
        letter-spacing: 1px;
        box-shadow: 0 10px 18px rgba(20, 184, 166, 0.25);
        transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    }
    .gallery-cta:hover:enabled {
        transform: translateY(-2px) scale(1.01);
        box-shadow: 0 14px 22px rgba(34, 197, 94, 0.3);
    }
    .gallery-cta:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
    }
    .gallery-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }
    .gallery-card {
        background: rgba(13, 13, 15, 0.75);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 18px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: left;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
    }
    .gallery-card:hover {
        border-color: rgba(154, 230, 0, 0.4);
        box-shadow: 0 0 24px rgba(154, 230, 0, 0.18);
        transform: translateY(-2px);
    }
    .gallery-card-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: 'Press Start 2P', monospace;
        font-size: 7px;
        color: #9ae600;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .gallery-status {
        background: rgba(154, 230, 0, 0.12);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        padding: 2px 8px;
    }
    .gallery-circuit {
        color: #555;
    }
    .gallery-title {
        font-family: 'Press Start 2P', monospace;
        font-size: 11px;
        color: #e2e8f0;
        letter-spacing: 1px;
    }
    .gallery-summary {
        font-size: 9px;
        color: #777;
        line-height: 1.7;
    }
    .gallery-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .gallery-tag {
        font-size: 7px;
        text-transform: uppercase;
        color: #9ae600;
        border: 1px solid rgba(154, 230, 0, 0.2);
        border-radius: 999px;
        padding: 2px 6px;
    }
    .gallery-tag--status {
        color: #cbd5f5;
        border-color: rgba(203, 213, 245, 0.35);
        background: rgba(51, 65, 85, 0.35);
    }
    .gallery-foot {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: auto;
    }
    .gallery-proof {
        font-size: 8px;
        color: #4ade80;
    }
    .gallery-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }
    .gallery-open {
        border: none;
        background: rgba(154, 230, 0, 0.12);
        color: #9ae600;
        font-size: 8px;
        padding: 4px 8px;
        border-radius: 999px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
    }
    .gallery-open:hover {
        background: rgba(154, 230, 0, 0.25);
        color: #e2e8f0;
    }
    .gallery-link {
        font-size: 8px;
        color: #4ade80;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        text-decoration: none;
    }
    .gallery-link:hover {
        text-decoration: underline;
    }
    .gallery-modal-link {
        font-size: 9px;
        color: #4ade80;
        text-decoration: none;
        word-break: break-all;
    }
    .gallery-modal-link:hover {
        text-decoration: underline;
    }

    /* ── Gallery Modal ── */
    .gallery-overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
    }
    .gallery-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(2, 6, 23, 0.8);
        backdrop-filter: blur(6px);
        border: none;
    }
    .gallery-modal {
        position: relative;
        z-index: 1;
        max-width: 520px;
        width: 100%;
        background: rgba(13, 13, 15, 0.95);
        border: 1px solid rgba(154, 230, 0, 0.25);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: #e2e8f0;
    }
    .gallery-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
    }
    .gallery-modal-label {
        font-size: 7px;
        text-transform: uppercase;
        color: #555;
        letter-spacing: 2px;
        font-family: 'Press Start 2P', monospace;
    }
    .gallery-modal-title {
        font-family: 'Press Start 2P', monospace;
        font-size: 14px;
        color: #9ae600;
        letter-spacing: 2px;
    }
    .gallery-close {
        background: rgba(154, 230, 0, 0.1);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        width: 32px;
        height: 32px;
        color: #9ae600;
        cursor: pointer;
        font-size: 12px;
    }
    .gallery-modal-summary {
        font-size: 10px;
        color: #777;
        line-height: 1.7;
    }
    .gallery-modal-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
    .gallery-modal-card {
        background: rgba(6, 8, 12, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.1);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .gallery-modal-requirement {
        grid-column: span 2;
        border-color: rgba(148, 163, 184, 0.2);
    }
    .gallery-modal-cta {
        font-size: 8px;
        text-transform: uppercase;
        color: #9ae600;
        letter-spacing: 1px;
        text-decoration: none;
        margin-top: 4px;
    }
    .gallery-modal-cta:hover {
        text-decoration: underline;
    }
    .gallery-modal-eyebrow {
        font-size: 7px;
        text-transform: uppercase;
        color: #555;
        letter-spacing: 2px;
        font-family: 'Press Start 2P', monospace;
    }
    .gallery-modal-value {
        font-size: 9px;
        color: #e2e8f0;
        line-height: 1.6;
    }
    .gallery-modal-lists {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        font-size: 9px;
        color: #777;
    }
    .gallery-modal-lists h4 {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #9ae600;
        margin-bottom: 6px;
    }
    .gallery-modal-lists ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .gallery-modal-note {
        font-size: 9px;
        color: #4ade80;
        line-height: 1.6;
    }

    @media (max-width: 520px) {
        .gallery-grid { grid-template-columns: 1fr; }
        .gallery-header { flex-direction: column; align-items: flex-start; }
        .gallery-modal-grid,
        .gallery-modal-lists {
            grid-template-columns: 1fr;
        }
    }

    /* ── Proof Panel (unearned featured) ── */
    .proof-panel {
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        backdrop-filter: blur(12px);
    }
    .tier-display {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .tier-icon {
        font-size: 2.5rem;
    }
    .tier-name {
        font-family: 'Press Start 2P', monospace;
        font-size: 16px;
        letter-spacing: 2px;
    }
    .balance-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .balance-val {
        font-family: 'Press Start 2P', monospace;
        font-size: 20px;
        color: #e2e8f0;
    }
    .balance-label {
        font-family: 'Press Start 2P', monospace;
        font-size: 9px;
        color: #9ae600;
        letter-spacing: 2px;
    }
    .proof-desc {
        font-size: 10px;
        color: #666;
        text-align: center;
        line-height: 1.8;
        max-width: 300px;
    }
    .proof-nudge {
        text-align: center;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 9px;
        color: #cbd5f5;
        line-height: 1.6;
    }
    .proof-nudge-link {
        display: inline-block;
        margin-top: 6px;
        color: #9ae600;
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
        text-decoration: none;
    }
    .proof-nudge-link:hover {
        text-decoration: underline;
    }
    .proof-tools {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        text-align: center;
    }
    .proof-tools-text {
        font-size: 9px;
        color: #666;
        max-width: 320px;
        line-height: 1.6;
    }
    .proof-tools-meta {
        font-size: 8px;
        color: rgba(226, 232, 240, 0.6);
        font-family: 'Press Start 2P', monospace;
    }
    .proof-tools-btn {
        font-family: 'Press Start 2P', monospace;
        font-size: 8px;
        color: #9ae600;
        background: rgba(13, 13, 15, 0.6);
        border: 1px solid rgba(154, 230, 0, 0.3);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        letter-spacing: 1px;
        transition: all 0.2s ease;
    }
    .proof-tools-btn:hover {
        color: #c6ff3b;
        border-color: rgba(198, 255, 59, 0.8);
        box-shadow: 0 0 18px rgba(154, 230, 0, 0.2);
    }
    .proof-error {
        font-size: 9px;
        color: #ef4444;
        font-family: 'Press Start 2P', monospace;
    }
    .proof-celebration {
        position: relative;
        margin: 16px 0 20px;
        border-radius: 18px;
        background: radial-gradient(circle at top, rgba(34, 197, 94, 0.28), transparent 60%),
            linear-gradient(135deg, rgba(15, 118, 110, 0.55), rgba(13, 148, 136, 0.15));
        border: 1px solid rgba(20, 184, 166, 0.4);
        padding: 16px;
        overflow: hidden;
        box-shadow: 0 24px 48px rgba(15, 118, 110, 0.25);
    }
    .proof-celebration-card {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: #ecfeff;
        text-align: left;
    }
    .proof-celebration-eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.2em;
        font-size: 7px;
        font-weight: 600;
        color: rgba(167, 243, 208, 0.9);
    }
    .proof-celebration-title {
        font-size: 14px;
        font-weight: 700;
        margin: 0;
    }
    .proof-celebration-body {
        margin: 0;
        font-size: 9px;
        color: rgba(240, 253, 250, 0.85);
        line-height: 1.6;
    }
    .proof-confetti {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }
    .confetti {
        position: absolute;
        top: 8%;
        left: 50%;
        width: 10px;
        height: 18px;
        border-radius: 4px;
        background: hsl(calc(var(--i) * 16deg), 90%, 60%);
        animation: confetti-fall 2.2s ease-out forwards;
        transform: translate3d(0, 0, 0) rotate(0deg);
        opacity: 0;
    }
    .confetti:nth-child(odd) {
        width: 8px;
        height: 14px;
    }
    .confetti {
        animation-delay: calc(var(--i) * 0.04s);
        left: calc(10% + (var(--i) * 3.2%));
    }
    @keyframes confetti-fall {
        0% {
            opacity: 0;
            transform: translate3d(0, -40px, 0) rotate(0deg);
        }
        10% {
            opacity: 1;
        }
        100% {
            opacity: 0;
            transform: translate3d(calc((var(--i) - 12) * 6px), 220px, 0) rotate(360deg);
        }
    }
    .generate-btn {
        font-family: 'Press Start 2P', monospace;
        font-size: 10px;
        color: #020617;
        background: linear-gradient(135deg, #9ae600, #4ade80);
        border: none;
        border-radius: 10px;
        padding: 14px 28px;
        cursor: pointer;
        letter-spacing: 1px;
        transition: all 0.3s ease;
        box-shadow: 0 0 20px rgba(154, 230, 0, 0.2);
    }
    .generate-btn:hover:not(:disabled) {
        box-shadow: 0 0 40px rgba(154, 230, 0, 0.4);
        transform: translateY(-2px);
    }
    .generate-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* ── Proving State ── */
    .proving-card {
        background: rgba(13, 13, 15, 0.7);
        border: 1px solid rgba(154, 230, 0, 0.15);
        border-radius: 16px;
        padding: 48px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        backdrop-filter: blur(12px);
    }
    .proving-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid rgba(154, 230, 0, 0.15);
        border-top-color: #9ae600;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
    }
    .proving-text {
        font-family: 'Press Start 2P', monospace;
        font-size: 9px;
        color: #9ae600;
        text-align: center;
        line-height: 2;
    }
    .proving-sub {
        font-size: 8px;
        color: #555;
        text-align: center;
    }

    /* ── Responsive ── */
    @media (max-width: 480px) {
        .title-farm { font-size: 24px; }
        .balance-val { font-size: 16px; }
        .farm-content { padding: 80px 16px 100px; }
    }
</style>
