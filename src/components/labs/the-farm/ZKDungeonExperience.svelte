<script lang="ts">
    const ZK_DUNGEON_CONTRACT_ID = "CA34IFEOQADUHTDIMJGTQ2I7O34QYHL4FFXFOJYTUSPVRMJQCS3UAY6N";
    const GAME_HUB_CONTRACT_ID = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";
    const FLOOR_LORE = [
        {
            id: 1,
            title: "Customs Gate",
            stack: "circom",
            coOp: false,
            real: "Border declaration sealed without exposing cargo",
        },
        {
            id: 2,
            title: "Freight Scales",
            stack: "circom",
            coOp: false,
            real: "Weigh-station ticket that proves compliance",
        },
        {
            id: 3,
            title: "Vault Ledger",
            stack: "circom",
            coOp: false,
            real: "Timestamped notary entry for a document hash",
        },
        {
            id: 4,
            title: "Mirror of Intent",
            stack: "noir",
            coOp: false,
            real: "Witness oath recorded without revealing the secret",
        },
        {
            id: 5,
            title: "Twin Locks",
            stack: "noir",
            coOp: true,
            real: "Dual-control keys for a high-stakes launch",
        },
        {
            id: 6,
            title: "Labyrinth Map",
            stack: "noir",
            coOp: false,
            real: "Signed flight plan validated without sharing route",
        },
        {
            id: 7,
            title: "Resonance Choir",
            stack: "noir",
            coOp: false,
            real: "Biometric liveness proven without sharing the sample",
        },
        {
            id: 8,
            title: "Blackbox Furnace",
            stack: "risc0",
            coOp: false,
            real: "Tamper-proof ML score verified with a sealed receipt",
        },
        {
            id: 9,
            title: "Time Dilation Test",
            stack: "risc0",
            coOp: false,
            real: "Flight recorder attests to a vehicle path for claims",
        },
        {
            id: 10,
            title: "Stellar Confluence",
            stack: "mixed",
            coOp: true,
            real: "Compliance bundle tying KYC, audit, and compute receipts",
        },
    ];

    const STACK_COPY = [
        {
            label: "Cipher Rings",
            stack: "circom",
            desc: "Fast edge locks for the opening doors—tight constraints, instant seals.",
        },
        {
            label: "Veil Scripts",
            stack: "noir",
            desc: "Mid-run oaths and co-op gates; crisp arithmetic with room for story.",
        },
        {
            label: "Starfoundry",
            stack: "risc0",
            desc: "Heavy compute floors; attested outputs from a sealed zkVM forge.",
        },
        {
            label: "Confluence",
            stack: "mixed",
            desc: "Final weave tying receipts, hub calls, and both players’ routes together.",
        },
    ];

    const shortHash = (value: string, head = 6, tail = 6) =>
        `${value.slice(0, head)}…${value.slice(-tail)}`;
</script>

<section class="zkdungeon">
    <div class="backdrop">
        <div class="nebula"></div>
        <div class="grid"></div>
        <div class="stars"></div>
    </div>

    <header class="hero">
        <p class="eyebrow">Live Testnet Run · Two-Player</p>
        <h1>THE FARM — ZK DUNGEON</h1>
        <p class="lede">
            Ten sealed rooms, every door choice notarized on-chain. Race with a partner, sync on
            gate floors, and prove your run without leaking the path.
        </p>
        <div class="cta-row">
            <a class="cta primary" href="/labs/the-farm">Play the live build</a>
            <a
                class="cta ghost"
                href="https://stellar.expert/explorer/testnet/contract/CA34IFEOQADUHTDIMJGTQ2I7O34QYHL4FFXFOJYTUSPVRMJQCS3UAY6N"
                target="_blank"
                rel="noreferrer"
            >
                View contract on explorer
            </a>
            <a class="cta ghost" href="/labs/the-farm#devlog">Read build log</a>
        </div>
        <div class="stats">
            <span>Dungeon {shortHash(ZK_DUNGEON_CONTRACT_ID, 10, 8)}</span>
            <span>Hub {shortHash(GAME_HUB_CONTRACT_ID, 10, 8)}</span>
            <span>Network: Testnet</span>
            <span>Ledger cadence: ~5s</span>
        </div>
    </header>

    <section class="panel panel-glow">
        <div class="panel-head">
            <p class="kicker">Run Brief</p>
            <h2>What happens when you drop in</h2>
        </div>
        <div class="brief-grid">
            <div class="brief-card">
                <p class="brief-title">Every door is notarized</p>
                <p>
                    Each pick submits a sealed proof and a transaction. Wrong answers trigger traps,
                    right answers open the next floor.
                </p>
            </div>
            <div class="brief-card">
                <p class="brief-title">Two-player sync</p>
                <p>
                    Floors 1 and 5 lock until both players clear. You see your partner’s phantom and
                    their current floor beacon.
                </p>
            </div>
            <div class="brief-card">
                <p class="brief-title">No main login risk</p>
                <p>
                    Testnet-only wallet track with its own keys. Main auth flow stays untouched.
                </p>
            </div>
            <div class="brief-card">
                <p class="brief-title">Hub lifecycle</p>
                <p>
                    start_game is called when lobby seals; end_game fires on a floor 10 finish. Both
                    are visible in event logs.
                </p>
            </div>
        </div>
    </section>

    <section class="panel">
        <div class="panel-head">
            <p class="kicker">Stack Rotation</p>
            <h2>Each arc uses the right tool</h2>
            <p class="panel-copy">
                Three proof families across ten floors. Lightweight rings to open, deep forges to
                finish, a weave at the end.
            </p>
        </div>
        <div class="stack-grid">
            {#each STACK_COPY as stack}
                <div class={`stack-card stack-${stack.stack}`}>
                    <div class="stack-pill">{stack.label}</div>
                    <p class="stack-name">{stack.stack.toUpperCase()}</p>
                    <p class="stack-desc">{stack.desc}</p>
                </div>
            {/each}
        </div>
    </section>

    <section class="panel panel-glow">
        <div class="panel-head">
            <p class="kicker">Floor Legends</p>
            <h2>Ten rooms, ten real-world seals</h2>
            <p class="panel-copy">
                Every floor maps to something you’d actually sign in the field—cargo gates, dual
                control, flight logs, sealed ML receipts.
            </p>
        </div>
        <div class="floor-grid">
            {#each FLOOR_LORE as floor}
                <div class="floor-card">
                    <div class="floor-top">
                        <span class="floor-id">F{floor.id}</span>
                        <span class={`pill pill-${floor.stack}`}>
                            {floor.stack}{floor.coOp ? " · co-op" : ""}
                        </span>
                    </div>
                    <p class="floor-title">{floor.title}</p>
                    <p class="floor-real">{floor.real}</p>
                </div>
            {/each}
        </div>
    </section>

    <section class="panel">
        <div class="panel-head">
            <p class="kicker">Feel the run</p>
            <h2>Fullscreen, pointer-lock, no chrome</h2>
            <p class="panel-copy">
                WASD + mouse on desktop, touch stick on mobile. Proving runs in a worker so the
                camera never stutters. Overlay pulses show proving → submitting → confirming.
            </p>
        </div>
        <div class="feel-grid">
            <div class="feel-card">
                <p class="feel-title">Immersive shell</p>
                <p>HUD hovers; fog and light bands give depth without crushing FPS.</p>
            </div>
            <div class="feel-card">
                <p class="feel-title">Ledger rhythm</p>
                <p>UI beats to ~5s finality; traps snap, doors glide.</p>
            </div>
            <div class="feel-card">
                <p class="feel-title">Re-entry safe</p>
                <p>Reconnect keeps lobby and floor state; you drop back where you left.</p>
            </div>
        </div>
        <div class="cta-row alt">
            <a class="cta primary" href="/labs/the-farm">Enter dungeon</a>
            <a class="cta ghost" href="/labs/the-farm#devlog">See build evidence</a>
        </div>
    </section>
</section>

<style>
    :global(body) {
        background: #05070c;
    }
    .zkdungeon {
        position: relative;
        min-height: 100vh;
        color: #e8f0ff;
        padding: 32px 18px 120px;
        overflow: hidden;
        font-family: "Inter", system-ui, -apple-system, sans-serif;
    }
    .backdrop {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        overflow: hidden;
    }
    .nebula {
        position: absolute;
        inset: -20%;
        background: radial-gradient(circle at 30% 30%, rgba(90, 153, 255, 0.28), transparent 45%),
            radial-gradient(circle at 70% 70%, rgba(255, 140, 196, 0.24), transparent 42%),
            radial-gradient(circle at 60% 20%, rgba(82, 255, 201, 0.24), transparent 40%);
        filter: blur(65px);
        opacity: 0.9;
        animation: drift 18s ease-in-out infinite alternate;
    }
    .grid {
        position: absolute;
        inset: 0;
        background: linear-gradient(
                rgba(255, 255, 255, 0.04) 1px,
                transparent 1px
            ),
            linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
        background-size: 60px 60px;
        mask-image: radial-gradient(circle at 50% 50%, black 30%, transparent 70%);
        opacity: 0.35;
    }
    .stars {
        position: absolute;
        inset: 0;
        background-image: radial-gradient(1px 1px at 20% 20%, rgba(255, 255, 255, 0.7), transparent),
            radial-gradient(1px 1px at 80% 40%, rgba(255, 255, 255, 0.6), transparent),
            radial-gradient(1px 1px at 60% 70%, rgba(255, 255, 255, 0.5), transparent);
        opacity: 0.7;
    }
    .hero {
        position: relative;
        z-index: 1;
        max-width: 960px;
        margin: 0 auto 28px;
        text-align: center;
    }
    .eyebrow {
        color: #9ad0ff;
        letter-spacing: 2px;
        text-transform: uppercase;
        font-size: 12px;
        margin-bottom: 8px;
    }
    h1 {
        font-size: clamp(32px, 6vw, 72px);
        margin: 0 0 12px;
        letter-spacing: 1px;
    }
    .lede {
        max-width: 760px;
        margin: 0 auto 20px;
        color: #d5e6ff;
        font-size: 16px;
        line-height: 1.6;
    }
    .cta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
        margin-bottom: 16px;
    }
    .cta {
        padding: 12px 18px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #e8f0ff;
        text-decoration: none;
        font-weight: 700;
        letter-spacing: 0.4px;
        background: rgba(255, 255, 255, 0.04);
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    }
    .cta.primary {
        background: linear-gradient(135deg, #4ad0ff, #9b7bff 60%, #ffc47a);
        color: #0a0c16;
        border-color: transparent;
        box-shadow: 0 8px 30px rgba(154, 223, 255, 0.35);
    }
    .cta:hover {
        transform: translateY(-2px);
        border-color: rgba(255, 255, 255, 0.35);
    }
    .stats {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        justify-content: center;
        color: #b9c9e4;
        font-size: 13px;
        opacity: 0.9;
    }
    .panel {
        position: relative;
        z-index: 1;
        max-width: 1080px;
        margin: 28px auto 0;
        padding: 22px 20px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(8, 12, 18, 0.78);
        backdrop-filter: blur(8px);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
    }
    .panel-glow {
        border-color: rgba(154, 223, 255, 0.22);
        box-shadow: 0 18px 60px rgba(58, 146, 255, 0.22);
    }
    .panel-head h2 {
        margin: 4px 0 6px;
        font-size: 26px;
        letter-spacing: 0.4px;
    }
    .panel-head .kicker {
        text-transform: uppercase;
        letter-spacing: 1.6px;
        font-size: 11px;
        color: #8ac8ff;
        margin: 0;
    }
    .panel-copy {
        margin: 4px 0 12px;
        color: #c7d7f0;
        line-height: 1.55;
    }
    .brief-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
    }
    .brief-card {
        padding: 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.03);
    }
    .brief-title {
        margin: 0 0 6px;
        font-weight: 700;
        color: #f0f6ff;
    }
    .brief-card p {
        margin: 0;
        color: #c7d7f0;
        line-height: 1.5;
        font-size: 14px;
    }
    .stack-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
    }
    .stack-card {
        padding: 14px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: linear-gradient(150deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
    }
    .stack-card .stack-pill {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        font-size: 11px;
        letter-spacing: 0.4px;
        color: #dce9ff;
    }
    .stack-name {
        margin: 8px 0 4px;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.8px;
    }
    .stack-desc {
        margin: 0;
        color: #c7d7f0;
        line-height: 1.5;
    }
    .stack-circom {
        border-color: rgba(255, 191, 140, 0.2);
    }
    .stack-noir {
        border-color: rgba(140, 196, 255, 0.2);
    }
    .stack-risc0 {
        border-color: rgba(107, 255, 198, 0.2);
    }
    .stack-mixed {
        border-color: rgba(255, 255, 255, 0.22);
    }
    .floor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
    }
    .floor-card {
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .floor-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #dce9ff;
    }
    .floor-id {
        letter-spacing: 1px;
        font-weight: 700;
    }
    .pill {
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 11px;
    }
    .pill-circom {
        color: #ffd5b1;
        border-color: rgba(255, 191, 140, 0.35);
    }
    .pill-noir {
        color: #d8e7ff;
        border-color: rgba(140, 196, 255, 0.35);
    }
    .pill-risc0 {
        color: #c8ffe9;
        border-color: rgba(107, 255, 198, 0.35);
    }
    .pill-mixed {
        color: #f3f3f3;
        border-color: rgba(255, 255, 255, 0.24);
    }
    .floor-title {
        margin: 6px 0 4px;
        font-size: 15px;
        letter-spacing: 0.4px;
    }
    .floor-real {
        margin: 0;
        color: #c7d7f0;
        font-size: 13px;
        line-height: 1.5;
    }
    .feel-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
    }
    .feel-card {
        padding: 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
    }
    .feel-title {
        margin: 0 0 6px;
        font-weight: 700;
    }
    .feel-card p {
        margin: 0;
        color: #c7d7f0;
        line-height: 1.5;
    }
    .cta-row.alt {
        margin-top: 18px;
    }
    @keyframes drift {
        from {
            transform: translate3d(0, 0, 0) scale(1);
        }
        to {
            transform: translate3d(4%, -3%, 0) scale(1.06);
        }
    }
    @media (max-width: 640px) {
        .zkdungeon {
            padding: 22px 14px 100px;
        }
        .panel {
            padding: 18px 14px;
        }
    }
</style>
