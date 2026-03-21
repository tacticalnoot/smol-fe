<script lang="ts">
    import { onMount } from "svelte";

    // ---- TYPES ----
    interface Balance {
        asset: string; code: string; issuer: string | null;
        balance: number; xlmValue: number | null; usdValue: number | null; priced: boolean;
    }
    interface Trade { pair: string; pnlXLM: number; timestamp: string; notionalXLM: number; }
    interface Profile {
        address: string;
        fetchedAt: string;
        dataCompleteness: { totalTrades: number; tradesCapped: boolean; paymentsCapped: boolean; pnlConfidence: number; xlmUsdPrice: number | null };
        identity: { createdAt: string | null; walletAgeDays: number | null; homeDomain: string | null; directoryTags: string[]; warnings: string[]; signerCount: number; trustlineCount: number; subentryCount: number };
        balances: Balance[];
        headline: { portfolioValueXLM: number; portfolioValueUSD: number | null; lifetimeValueTradedXLM: number; totalTrades: number; netXlmFlow: number; netXlmFromTrading: number; netXlmFromTransfers: number; feesSpentXLM: number; estimatedRealizedPnlXLM: number; pnlConfidence: number };
        activity: { paymentsIn: number; paymentsOut: number; counterpartyCount: number; offersCreated: number; pathPayments: number; lpDeposits: number; lpWithdrawals: number; largestInboundXLM: number; largestOutboundXLM: number };
        trading: { favoritePairs: { pair: string; count: number }[]; uniquePairsCount: number; bestTrade: Trade | null; worstTrade: Trade | null; avgHoldHours: number; winRatePct: number; avgTradeXLM: number; medianTradeXLM: number; biggestFillXLM: number; totalSaleCount: number; wins: number; losses: number; tradesByHour: number[]; tradesByDay: number[] };
        scores: { conviction: number; degeneracy: number; lpFarmer: number; pathWizard: number; diamondHands: number; whale: number; coffinPortfolio: number; aura: number };
        narrative: { archetype: string; archetypeEmoji: string; traits: string[]; summary: string };
        lifetimeClaims: { aqua: number; blnd: number; pho: number; dataCapped: boolean };
    }

    // ---- STATE ----
    let inputAddress = $state("");
    let loading = $state(false);
    let profile = $state<Profile | null>(null);
    let error = $state<string | null>(null);
    let loadingStep = $state(0);
    let mounted = $state(false);
    let scoresVisible = $state(false);

    const EXAMPLE_ADDRESSES = [
        { label: "Binance", addr: "GAX3BRBNB5WTJ2GNEFFH7A4CZKT2FORYABDDBZR5FIIT3P7FLS2EFOZ" },
        { label: "StellarX", addr: "GDDBG2IA36WS6G3VKFPXZBBWNRQVL2IHGKHQH6DXNTJRXLJQHGZYBWJ" },
        { label: "Example A", addr: "GDBBQHYLL2I24PSWT5INW2EIDHJL4F2CNLF4BV3TLZWNHK3GI45OJLB4" },
    ];

    const LOADING_STEPS = [
        "Locating account on Stellar ledger…",
        "Mining trade history from Horizon…",
        "Computing FIFO position ledger…",
        "Scoring behavioral genome…",
        "Generating archetype profile…",
        "Sequencing complete.",
    ];

    let loadingInterval: ReturnType<typeof setInterval> | null = null;

    onMount(() => {
        mounted = true;
        const q = new URLSearchParams(window.location.search).get("address");
        if (q && isValidGAddress(q)) {
            inputAddress = q;
            runScan(q);
        }
    });

    function isValidGAddress(addr: string): boolean {
        return /^G[A-Z2-7]{55}$/.test(addr.trim());
    }

    function fmt(n: number, dec = 2): string {
        if (n === 0) return "0";
        if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
        if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
        return n.toFixed(dec);
    }

    function fmtDate(iso: string | null): string {
        if (!iso) return "Unknown";
        return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }

    function fmtHoldTime(hrs: number): string {
        if (hrs < 1) return `${Math.round(hrs * 60)}m`;
        if (hrs < 24) return `${Math.round(hrs)}h`;
        if (hrs < 168) return `${Math.round(hrs / 24)}d`;
        if (hrs < 720) return `${Math.round(hrs / 168)}w`;
        return `${Math.round(hrs / 720)}mo`;
    }

    function scoreColor(s: number): string {
        if (s >= 75) return "#00ff88";
        if (s >= 50) return "#fdda24";
        if (s >= 25) return "#ff8c42";
        return "#ff424c";
    }

    function pnlColor(n: number): string {
        if (n > 0) return "#00ff88";
        if (n < 0) return "#ff424c";
        return "#aaa";
    }

    async function runScan(addr?: string) {
        const target = (addr ?? inputAddress).trim();
        if (!isValidGAddress(target)) {
            error = "Please enter a valid Stellar G-address (56 chars starting with G)";
            return;
        }

        error = null;
        profile = null;
        loading = true;
        loadingStep = 0;
        scoresVisible = false;

        // Update URL without navigation
        const url = new URL(window.location.href);
        url.searchParams.set("address", target);
        window.history.replaceState({}, "", url.toString());

        loadingInterval = setInterval(() => {
            loadingStep = Math.min(loadingStep + 1, LOADING_STEPS.length - 1);
        }, 900);

        try {
            const res = await fetch(`/api/labs/trader-genome/${encodeURIComponent(target)}`);
            const data = await res.json();
            if (!res.ok) {
                error = data.error ?? "Unknown error";
            } else {
                profile = data;
                // Trigger score animation after render
                setTimeout(() => { scoresVisible = true; }, 150);
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Network error";
        } finally {
            loading = false;
            if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; }
        }
    }

    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const HOUR_LABELS = ["0", "3", "6", "9", "12", "15", "18", "21"];

    function heatColor(value: number, max: number): string {
        if (max === 0) return "#1a1a1a";
        const t = value / max;
        if (t === 0) return "#1a1a1a";
        if (t < 0.25) return "#0d2b1a";
        if (t < 0.5) return "#0a4a2a";
        if (t < 0.75) return "#009944";
        return "#00ff88";
    }
</script>

<div class="space-y-6">

    <!-- SEARCH BAR -->
    <div class="border border-[#2a2a2a] rounded-xl bg-[#0a0a0a] p-6 space-y-4">
        <div class="text-[10px] text-[#444] uppercase tracking-widest">Paste any Stellar G-address to decode their on-chain trading DNA</div>
        <div class="flex gap-2 flex-col sm:flex-row">
            <input
                type="text"
                bind:value={inputAddress}
                placeholder="G... (56 chars)"
                maxlength="56"
                onkeydown={(e) => e.key === "Enter" && runScan()}
                class="flex-1 bg-black border border-[#333] rounded-lg px-4 py-3 text-[11px] font-mono text-[#9ae600] placeholder-[#333] focus:outline-none focus:border-[#9ae600] transition-colors"
            />
            <button
                onclick={() => runScan()}
                disabled={loading}
                class="px-6 py-3 bg-[#9ae600] text-black text-[10px] rounded-lg font-bold uppercase tracking-widest hover:bg-[#aaff00] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
                {loading ? "SCANNING…" : "▶ SCAN"}
            </button>
        </div>

        <!-- Example addresses -->
        <div class="flex flex-wrap gap-2 items-center">
            <span class="text-[9px] text-[#333] uppercase">Try:</span>
            {#each EXAMPLE_ADDRESSES as ex}
                <button
                    onclick={() => { inputAddress = ex.addr; runScan(ex.addr); }}
                    class="text-[9px] text-[#444] border border-[#222] rounded px-2 py-1 hover:border-[#9ae600] hover:text-[#9ae600] transition-colors font-mono"
                >
                    {ex.label}
                </button>
            {/each}
        </div>
    </div>

    <!-- ERROR -->
    {#if error}
        <div class="border border-[#ff424c]/40 rounded-xl bg-[#ff424c]/5 p-6 text-[#ff424c] text-[11px] font-mono">
            <span class="text-[#ff424c] font-bold">SCAN FAILED:</span> {error}
        </div>
    {/if}

    <!-- LOADING STATE -->
    {#if loading}
        <div class="border border-[#2a2a2a] rounded-xl bg-[#0a0a0a] p-8 space-y-4">
            <div class="text-[10px] text-[#9ae600] uppercase tracking-widest animate-pulse">◈ GENOME SEQUENCING IN PROGRESS</div>
            <div class="space-y-2 font-mono text-[10px]">
                {#each LOADING_STEPS as step, i}
                    <div class="flex items-center gap-3 {i > loadingStep ? 'opacity-20' : ''}">
                        <span class="w-4 text-center">
                            {#if i < loadingStep}
                                <span class="text-[#00ff88]">✓</span>
                            {:else if i === loadingStep}
                                <span class="text-[#fdda24] animate-pulse">◌</span>
                            {:else}
                                <span class="text-[#333]">○</span>
                            {/if}
                        </span>
                        <span class="{i === loadingStep ? 'text-[#fdda24]' : i < loadingStep ? 'text-[#00ff88]' : 'text-[#333]'}">{step}</span>
                    </div>
                {/each}
            </div>
            <!-- Progress bar -->
            <div class="h-px bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                    class="h-full bg-[#9ae600] transition-all duration-700"
                    style="width: {Math.round((loadingStep / (LOADING_STEPS.length - 1)) * 100)}%"
                ></div>
            </div>
        </div>
    {/if}

    <!-- PROFILE RESULT -->
    {#if profile && !loading}
        {@const p = profile}
        {@const sc = p.scores}
        {@const tr = p.trading}
        {@const id = p.identity}
        {@const hl = p.headline}
        {@const ac = p.activity}
        {@const na = p.narrative}
        {@const lc = p.lifetimeClaims}

        <!-- ── IDENTITY CARD ── -->
        <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] overflow-hidden">
            <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 border-b border-[#1a1a1a]">
                <div class="space-y-1">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="text-3xl">{na.archetypeEmoji}</span>
                        <div>
                            <div class="text-[9px] text-[#444] uppercase tracking-widest">Archetype</div>
                            <div class="text-xl text-[#9ae600] font-bold tracking-tight">{na.archetype}</div>
                        </div>
                        <div class="ml-2 px-3 py-1 border border-[#9ae600]/30 rounded-full text-[9px] text-[#9ae600] uppercase tracking-widest">
                            AURA {sc.aura}
                        </div>
                    </div>
                    <div class="font-mono text-[10px] text-[#555] break-all">{p.address}</div>
                </div>
                <div class="text-right space-y-1 flex-shrink-0">
                    {#if id.walletAgeDays != null}
                        <div class="text-[9px] text-[#444] uppercase">Wallet Age</div>
                        <div class="text-[#fdda24] text-sm font-bold">{id.walletAgeDays.toLocaleString()} days</div>
                    {/if}
                    {#if id.createdAt}
                        <div class="text-[8px] text-[#333]">Since {fmtDate(id.createdAt)}</div>
                    {/if}
                    {#if id.homeDomain}
                        <div class="text-[9px] text-[#9ae600]/60">{id.homeDomain}</div>
                    {/if}
                </div>
            </div>

            <!-- Warnings -->
            {#if id.warnings.length > 0}
                <div class="px-6 py-3 bg-[#ff424c]/10 border-b border-[#ff424c]/20">
                    {#each id.warnings as w}
                        <div class="text-[10px] text-[#ff424c] font-bold">⚠ {w}</div>
                    {/each}
                </div>
            {/if}

            <!-- Directory tags -->
            {#if id.directoryTags.length > 0}
                <div class="px-6 py-3 flex flex-wrap gap-2 border-b border-[#1a1a1a]">
                    {#each id.directoryTags as tag}
                        <span class="text-[8px] px-2 py-1 border border-[#333] rounded-full text-[#555] uppercase">{tag}</span>
                    {/each}
                </div>
            {/if}

            <!-- Meta row -->
            <div class="px-6 py-3 grid grid-cols-3 gap-4 text-center">
                <div>
                    <div class="text-[8px] text-[#444] uppercase">Signers</div>
                    <div class="text-[#aaa] text-sm">{id.signerCount}</div>
                </div>
                <div>
                    <div class="text-[8px] text-[#444] uppercase">Trustlines</div>
                    <div class="text-[#aaa] text-sm">{id.trustlineCount}</div>
                </div>
                <div>
                    <div class="text-[8px] text-[#444] uppercase">Subentries</div>
                    <div class="text-[#aaa] text-sm">{id.subentryCount}</div>
                </div>
            </div>
        </div>

        <!-- ── HEADLINE STATS ── -->
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            {#each [
                { label: "Portfolio Value", value: fmt(hl.portfolioValueXLM) + " XLM", sub: hl.portfolioValueUSD != null ? "$" + fmt(hl.portfolioValueUSD) : null, color: "#9ae600" },
                { label: "Lifetime Traded", value: fmt(hl.lifetimeValueTradedXLM) + " XLM", sub: null, color: "#fdda24" },
                { label: "Total Trades", value: hl.totalTrades.toLocaleString(), sub: p.dataCompleteness.tradesCapped ? "⚠ capped at 1000" : null, color: "#fff" },
                { label: "Net XLM Flow", value: (hl.netXlmFlow >= 0 ? "+" : "") + fmt(hl.netXlmFlow) + " XLM", sub: null, color: pnlColor(hl.netXlmFlow) },
                { label: "Realized P&L", value: (hl.estimatedRealizedPnlXLM >= 0 ? "+" : "") + fmt(hl.estimatedRealizedPnlXLM) + " XLM", sub: hl.pnlConfidence > 0 ? hl.pnlConfidence + "% confidence" : "no data", color: pnlColor(hl.estimatedRealizedPnlXLM) },
                { label: "Win Rate", value: tr.totalSaleCount > 0 ? tr.winRatePct.toFixed(1) + "%" : "N/A", sub: tr.totalSaleCount > 0 ? tr.wins + "W / " + tr.losses + "L" : null, color: tr.winRatePct > 55 ? "#00ff88" : tr.winRatePct > 45 ? "#fdda24" : "#ff424c" },
            ] as stat}
                <div class="border border-[#1a1a1a] rounded-xl bg-[#08080f] p-4 space-y-1">
                    <div class="text-[8px] text-[#444] uppercase tracking-widest">{stat.label}</div>
                    <div class="text-base font-bold" style="color: {stat.color}">{stat.value}</div>
                    {#if stat.sub}
                        <div class="text-[8px] text-[#333]">{stat.sub}</div>
                    {/if}
                </div>
            {/each}
        </div>

        <!-- ── LIFETIME PROTOCOL CLAIMS ── -->
        {#if lc && (lc.aqua > 0 || lc.blnd > 0 || lc.pho > 0)}
            <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-5 space-y-4">
                <div class="flex items-center justify-between border-b border-[#1a1a1a] pb-3">
                    <div class="text-[10px] text-[#555] uppercase tracking-widest">Lifetime Protocol Claims</div>
                    {#if lc.dataCapped}
                        <div class="text-[8px] text-[#444] italic">⚠ partial history</div>
                    {/if}
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <!-- AQUA -->
                    <div class="border border-[#1a3a5c]/60 rounded-lg bg-[#0a1520] p-4 space-y-2">
                        <div class="flex items-center gap-2">
                            <span class="text-base">♒</span>
                            <span class="text-[9px] text-[#4da6ff] uppercase tracking-widest font-bold">AQUA</span>
                        </div>
                        <div class="text-xl font-bold text-[#4da6ff] font-mono">
                            {lc.aqua > 0 ? fmt(lc.aqua) : "—"}
                        </div>
                        <div class="text-[8px] text-[#334]">Aquarius farming claims</div>
                    </div>
                    <!-- PHO -->
                    <div class="border border-[#3a2a00]/60 rounded-lg bg-[#150f00] p-4 space-y-2">
                        <div class="flex items-center gap-2">
                            <span class="text-base">🐉</span>
                            <span class="text-[9px] text-[#ffb830] uppercase tracking-widest font-bold">PHO</span>
                        </div>
                        <div class="text-xl font-bold text-[#ffb830] font-mono">
                            {lc.pho > 0 ? fmt(lc.pho) : "—"}
                        </div>
                        <div class="text-[8px] text-[#443]">Phoenix rewards</div>
                    </div>
                    <!-- BLND -->
                    <div class="border border-[#2a1a3a]/60 rounded-lg bg-[#100a18] p-4 space-y-2">
                        <div class="flex items-center gap-2">
                            <span class="text-base">🧪</span>
                            <span class="text-[9px] text-[#b085ff] uppercase tracking-widest font-bold">BLND</span>
                        </div>
                        <div class="text-xl font-bold text-[#b085ff] font-mono">
                            {lc.blnd > 0 ? fmt(lc.blnd) : "—"}
                        </div>
                        <div class="text-[8px] text-[#332]">Blend emissions</div>
                    </div>
                </div>
            </div>
        {/if}

        <!-- ── SCORE METERS ── -->
        <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-6 space-y-4">
            <div class="text-[10px] text-[#555] uppercase tracking-widest border-b border-[#1a1a1a] pb-3">Behavioral Genome Scores</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {#each [
                    { key: "conviction", label: "Conviction", desc: "Avg hold time", val: sc.conviction },
                    { key: "degeneracy", label: "Degeneracy", desc: "Trade freq × pair diversity", val: sc.degeneracy },
                    { key: "lpFarmer", label: "LP Farmer", desc: "Liquidity provision activity", val: sc.lpFarmer },
                    { key: "pathWizard", label: "Path Wizard", desc: "Path payment usage", val: sc.pathWizard },
                    { key: "diamondHands", label: "Diamond Hands", desc: "Conviction + win rate", val: sc.diamondHands },
                    { key: "whale", label: "Whale Score", desc: "Total notional volume", val: sc.whale },
                    { key: "coffinPortfolio", label: "Coffin Portfolio", desc: "Unpriced / dead assets", val: sc.coffinPortfolio },
                    { key: "aura", label: "Aura", desc: "Overall composite score", val: sc.aura },
                ] as score}
                    <div class="space-y-1">
                        <div class="flex justify-between items-baseline">
                            <span class="text-[9px] text-[#aaa] uppercase tracking-wide">{score.label}</span>
                            <span class="text-[11px] font-bold" style="color: {scoreColor(score.val)}">{score.val}</span>
                        </div>
                        <div class="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                            <div
                                class="h-full rounded-full transition-all duration-700 ease-out"
                                style="width: {scoresVisible ? score.val : 0}%; background-color: {scoreColor(score.val)}"
                            ></div>
                        </div>
                        <div class="text-[8px] text-[#333]">{score.desc}</div>
                    </div>
                {/each}
            </div>
        </div>

        <!-- ── TRADING SECTION ── -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <!-- Favorite Pairs -->
            <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-5 space-y-3">
                <div class="text-[10px] text-[#555] uppercase tracking-widest">Favorite Pairs</div>
                {#if tr.favoritePairs.length === 0}
                    <div class="text-[10px] text-[#333]">No trades found</div>
                {:else}
                    {@const maxCount = tr.favoritePairs[0].count}
                    {#each tr.favoritePairs as pair}
                        <div class="space-y-1">
                            <div class="flex justify-between text-[10px]">
                                <span class="text-[#aaa] font-mono">{pair.pair}</span>
                                <span class="text-[#555]">{pair.count.toLocaleString()}</span>
                            </div>
                            <div class="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                                <div class="h-full bg-[#9ae600]/60 rounded-full" style="width: {Math.round((pair.count / maxCount) * 100)}%"></div>
                            </div>
                        </div>
                    {/each}
                    <div class="text-[8px] text-[#333] pt-1">{tr.uniquePairsCount} unique pairs total</div>
                {/if}
            </div>

            <!-- Trade Metrics -->
            <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-5 space-y-3">
                <div class="text-[10px] text-[#555] uppercase tracking-widest">Trade Metrics</div>
                <div class="space-y-2 font-mono text-[10px]">
                    {#each [
                        { label: "Avg Hold Time", value: tr.avgHoldHours > 0 ? fmtHoldTime(tr.avgHoldHours) : "N/A" },
                        { label: "Avg Trade Size", value: fmt(tr.avgTradeXLM) + " XLM" },
                        { label: "Median Trade", value: fmt(tr.medianTradeXLM) + " XLM" },
                        { label: "Biggest Fill", value: fmt(tr.biggestFillXLM) + " XLM" },
                        { label: "Fees Paid", value: fmt(p.headline.feesSpentXLM, 4) + " XLM" },
                    ] as m}
                        <div class="flex justify-between border-b border-[#0f0f0f] pb-1">
                            <span class="text-[#444]">{m.label}</span>
                            <span class="text-[#aaa]">{m.value}</span>
                        </div>
                    {/each}
                </div>
            </div>
        </div>

        <!-- Best / Worst Trades -->
        {#if tr.bestTrade || tr.worstTrade}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {#if tr.bestTrade}
                    <div class="border border-[#00ff88]/20 rounded-xl bg-[#00ff88]/3 p-5 space-y-2">
                        <div class="text-[9px] text-[#00ff88] uppercase tracking-widest">Best Trade</div>
                        <div class="text-[#00ff88] text-lg font-bold">+{fmt(tr.bestTrade.pnlXLM)} XLM</div>
                        <div class="text-[10px] text-[#555] font-mono">{tr.bestTrade.pair}</div>
                        <div class="text-[8px] text-[#333]">{fmtDate(tr.bestTrade.timestamp)}</div>
                    </div>
                {/if}
                {#if tr.worstTrade}
                    <div class="border border-[#ff424c]/20 rounded-xl bg-[#ff424c]/3 p-5 space-y-2">
                        <div class="text-[9px] text-[#ff424c] uppercase tracking-widest">Worst Trade</div>
                        <div class="text-[#ff424c] text-lg font-bold">{fmt(tr.worstTrade.pnlXLM)} XLM</div>
                        <div class="text-[10px] text-[#555] font-mono">{tr.worstTrade.pair}</div>
                        <div class="text-[8px] text-[#333]">{fmtDate(tr.worstTrade.timestamp)}</div>
                    </div>
                {/if}
            </div>
        {/if}

        <!-- ── ACTIVITY HEATMAPS ── -->
        {#if hl.totalTrades > 0}
            <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-5 space-y-5">
                <div class="text-[10px] text-[#555] uppercase tracking-widest">Trading Activity Patterns</div>

                <!-- Hour of Day heatmap -->
                <div class="space-y-2">
                    <div class="text-[8px] text-[#444] uppercase">Hour of Day (UTC)</div>
                    {@const maxH = Math.max(...tr.tradesByHour, 1)}
                    <div class="flex gap-0.5">
                        {#each tr.tradesByHour as count, i}
                            <div
                                class="flex-1 h-6 rounded-sm transition-colors"
                                style="background-color: {heatColor(count, maxH)}"
                                title="{i}:00 UTC — {count} trades"
                            ></div>
                        {/each}
                    </div>
                    <div class="flex justify-between text-[7px] text-[#333] px-0">
                        {#each HOUR_LABELS as lbl, i}
                            <span style="margin-left: {i === 0 ? '0' : 'auto'}">{lbl}h</span>
                        {/each}
                    </div>
                </div>

                <!-- Day of Week heatmap -->
                <div class="space-y-2">
                    <div class="text-[8px] text-[#444] uppercase">Day of Week</div>
                    {@const maxD = Math.max(...tr.tradesByDay, 1)}
                    <div class="flex gap-1">
                        {#each tr.tradesByDay as count, i}
                            <div class="flex-1 space-y-1 text-center">
                                <div
                                    class="h-8 rounded-sm transition-colors"
                                    style="background-color: {heatColor(count, maxD)}"
                                    title="{DAY_LABELS[i]} — {count} trades"
                                ></div>
                                <div class="text-[7px] text-[#333]">{DAY_LABELS[i].slice(0, 1)}</div>
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}

        <!-- ── PORTFOLIO ── -->
        {#if p.balances.length > 0}
            <div class="border border-[#2a2a2a] rounded-xl bg-[#08080f] p-5 space-y-4">
                <div class="text-[10px] text-[#555] uppercase tracking-widest">Current Holdings</div>
                <div class="overflow-x-auto">
                    <table class="w-full text-[10px] font-mono">
                        <thead>
                            <tr class="text-[#333] text-[8px] uppercase border-b border-[#1a1a1a]">
                                <th class="text-left py-2 pr-4">Asset</th>
                                <th class="text-right py-2 pr-4">Balance</th>
                                <th class="text-right py-2 pr-4">XLM Value</th>
                                <th class="text-right py-2">USD Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each p.balances.slice(0, 15) as b}
                                <tr class="border-b border-[#0f0f0f] hover:bg-[#9ae600]/3 transition-colors">
                                    <td class="py-2 pr-4">
                                        <span class="text-[#9ae600]">{b.code}</span>
                                        {#if !b.priced && b.code !== 'XLM'}
                                            <span class="text-[7px] text-[#333] ml-1">unpriced</span>
                                        {/if}
                                    </td>
                                    <td class="text-right py-2 pr-4 text-[#aaa]">{fmt(b.balance, 4)}</td>
                                    <td class="text-right py-2 pr-4 {b.xlmValue != null ? 'text-[#fdda24]' : 'text-[#333]'}">
                                        {b.xlmValue != null ? fmt(b.xlmValue) : "—"}
                                    </td>
                                    <td class="text-right py-2 {b.usdValue != null ? 'text-[#aaa]' : 'text-[#333]'}">
                                        {b.usdValue != null ? "$" + fmt(b.usdValue) : "—"}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}

        <!-- ── ACTIVITY STATS ── -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            {#each [
                { label: "Payments In", value: ac.paymentsIn.toLocaleString(), color: "#00ff88" },
                { label: "Payments Out", value: ac.paymentsOut.toLocaleString(), color: "#ff424c" },
                { label: "Counterparties", value: ac.counterpartyCount.toLocaleString(), color: "#fdda24" },
                { label: "Path Payments", value: ac.pathPayments.toLocaleString(), color: "#9ae600" },
                { label: "LP Deposits", value: ac.lpDeposits.toLocaleString(), color: "#00ff88" },
                { label: "LP Withdrawals", value: ac.lpWithdrawals.toLocaleString(), color: "#ff424c" },
                { label: "Largest Inbound", value: fmt(ac.largestInboundXLM) + " XLM", color: "#00ff88" },
                { label: "Largest Outbound", value: fmt(ac.largestOutboundXLM) + " XLM", color: "#ff424c" },
            ] as stat}
                <div class="border border-[#1a1a1a] rounded-lg bg-[#08080f] p-3 space-y-1">
                    <div class="text-[8px] text-[#444] uppercase">{stat.label}</div>
                    <div class="text-sm font-bold font-mono" style="color: {stat.color}">{stat.value}</div>
                </div>
            {/each}
        </div>

        <!-- ── NARRATIVE ── -->
        <div class="border border-[#9ae600]/20 rounded-xl bg-[#0a1200] p-6 space-y-4">
            <div class="text-[10px] text-[#9ae600]/60 uppercase tracking-widest">Genome Summary</div>
            <p class="text-[11px] text-[#aaa] leading-relaxed font-mono">{na.summary}</p>
            {#if na.traits.length > 0}
                <div class="flex flex-wrap gap-2 pt-1">
                    {#each na.traits as trait}
                        <span class="px-3 py-1 border border-[#9ae600]/20 rounded-full text-[9px] text-[#9ae600]/70 uppercase tracking-wide">
                            {trait}
                        </span>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- ── FOOTER / DATA CONFIDENCE ── -->
        <div class="border border-[#1a1a1a] rounded-xl bg-[#08080f] p-4 font-mono text-[8px] text-[#333] space-y-1">
            <div class="flex flex-wrap justify-between gap-2">
                <span>Data fetched: {fmtDate(p.fetchedAt)}</span>
                <span>XLM/USD: {p.dataCompleteness.xlmUsdPrice != null ? "$" + p.dataCompleteness.xlmUsdPrice.toFixed(4) : "unavailable"}</span>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
                <span>Trades analyzed: {p.dataCompleteness.totalTrades.toLocaleString()}{p.dataCompleteness.tradesCapped ? " (capped)" : ""}</span>
                <span>P&L confidence: {p.dataCompleteness.pnlConfidence}%</span>
            </div>
            <div class="text-[#222] pt-1">
                P&L uses FIFO costing on XLM-paired trades only. Results are estimates, not financial advice.
                Cached for 10 min. Source: Stellar Horizon + Stellar Expert Directory.
            </div>
        </div>

    {/if}
</div>
