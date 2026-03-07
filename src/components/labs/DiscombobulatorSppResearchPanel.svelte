<script lang="ts">
    import {
        getSppResearchModel,
        type SppResearchContractSurface,
        type SppResearchStatus,
        type SppResearchStoreSurface,
        type SppResearchWorkstream,
    } from "../../utils/discombobulator-spp-research";

    type ResearchTab = "contracts" | "state" | "coverage";

    const model = getSppResearchModel();

    let isExpanded = $state(false);
    let activeTab = $state<ResearchTab>("contracts");

    function getStatusClasses(status: SppResearchStatus): string {
        if (status === "present") {
            return "border-[#22c55e]/30 bg-[#052e16]/60 text-[#86efac]";
        }
        if (status === "shadowed") {
            return "border-[#f59e0b]/30 bg-[#1f1300]/60 text-[#fbbf24]";
        }
        return "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8]";
    }

    function getStatusLabel(status: SppResearchStatus): string {
        if (status === "present") return "BOUND";
        if (status === "shadowed") return "SHADOWED";
        return "MISSING";
    }
</script>

<div class="mt-3 rounded-lg border border-[#1e293b] bg-[#020617]/70 p-3">
    <div class="flex items-center justify-between gap-3">
        <div>
            <div class="text-[8px] uppercase tracking-[0.18em] text-[#7dd3fc]">
                SPP Research Surface
            </div>
            <div class="mt-1 text-[8px] text-[#94a3b8]">
                Contract model, local state model, and integration coverage mapped
                from the Nethermind SPP repo.
            </div>
        </div>
        <button
            class="rounded-md border border-[#1e293b] bg-[#0f172a]/50 px-2 py-1 text-[8px] text-[#7dd3fc] transition-all hover:border-[#7dd3fc]/40 hover:bg-[#0f172a]/80"
            onclick={() => (isExpanded = !isExpanded)}
        >
            {isExpanded ? "Hide Surface" : "Show Surface"}
        </button>
    </div>

    <div class="mt-2 grid grid-cols-3 gap-2 text-[8px] text-[#cbd5e1]">
        <div class="rounded-md border border-[#1e293b] bg-[#0f172a]/40 p-2">
            <div class="text-[#64748b]">Contracts</div>
            <div class="mt-1 text-[#e2e8f0]">{model.summary.contractCount}</div>
        </div>
        <div class="rounded-md border border-[#1e293b] bg-[#0f172a]/40 p-2">
            <div class="text-[#64748b]">Stores</div>
            <div class="mt-1 text-[#e2e8f0]">{model.summary.storeCount}</div>
        </div>
        <div class="rounded-md border border-[#1e293b] bg-[#0f172a]/40 p-2">
            <div class="text-[#64748b]">Workstreams</div>
            <div class="mt-1 text-[#e2e8f0]">{model.summary.workstreamCount}</div>
        </div>
    </div>

    <div class="mt-2 flex flex-wrap gap-2 text-[8px]">
        <span class="rounded-md border border-[#22c55e]/30 bg-[#052e16]/60 px-2 py-1 text-[#86efac]">
            Bound: {model.summary.presentCount}
        </span>
        <span class="rounded-md border border-[#f59e0b]/30 bg-[#1f1300]/60 px-2 py-1 text-[#fbbf24]">
            Shadowed: {model.summary.shadowedCount}
        </span>
        <span class="rounded-md border border-[#1e293b] bg-[#0f172a]/50 px-2 py-1 text-[#94a3b8]">
            Missing: {model.summary.missingCount}
        </span>
    </div>

    {#if isExpanded}
        <div class="mt-3 flex flex-wrap gap-2">
            <button
                class={`rounded-md border px-2 py-1 text-[8px] transition-all ${activeTab === "contracts" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                onclick={() => (activeTab = "contracts")}
            >
                CONTRACTS
            </button>
            <button
                class={`rounded-md border px-2 py-1 text-[8px] transition-all ${activeTab === "state" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                onclick={() => (activeTab = "state")}
            >
                STATE
            </button>
            <button
                class={`rounded-md border px-2 py-1 text-[8px] transition-all ${activeTab === "coverage" ? "border-[#7dd3fc]/40 bg-[#0f172a]/80 text-[#7dd3fc]" : "border-[#1e293b] bg-[#0f172a]/50 text-[#94a3b8] hover:border-[#7dd3fc]/30 hover:text-[#7dd3fc]"}`}
                onclick={() => (activeTab = "coverage")}
            >
                COVERAGE
            </button>
        </div>

        {#if activeTab === "contracts"}
            <div class="mt-3 flex flex-col gap-2">
                {#each model.contracts as contract (contract.id)}
                    <div
                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/40 p-3"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="text-[9px] text-[#e2e8f0]">
                                    {contract.label}
                                </div>
                                <div class="mt-1 text-[8px] text-[#94a3b8]">
                                    {contract.role}
                                </div>
                            </div>
                            <span
                                class={`rounded-md border px-2 py-1 text-[8px] ${getStatusClasses(contract.status)}`}
                            >
                                {getStatusLabel(contract.status)}
                            </span>
                        </div>

                        <div class="mt-2 text-[8px] text-[#cbd5e1]">
                            <span class="text-[#64748b]">Constructor</span>
                            <div class="mt-1 break-all text-[#e2e8f0]">
                                {contract.constructorSignature}
                            </div>
                        </div>

                        <div class="mt-2 flex flex-wrap gap-1">
                            {#each contract.entrypoints as entrypoint (entrypoint.name)}
                                <span class="rounded-md border border-[#1e293b] bg-[#020617]/60 px-2 py-1 text-[8px] text-[#7dd3fc]">
                                    {entrypoint.name}
                                </span>
                            {/each}
                        </div>

                        <div class="mt-2 text-[8px] text-[#94a3b8]">
                            {contract.labBinding}
                        </div>

                        <div class="mt-2 text-[8px] text-[#cbd5e1]">
                            <span class="text-[#64748b]">Emits / returns</span>
                            <div class="mt-1 flex flex-wrap gap-1">
                                {#each contract.emittedData as emitted (emitted)}
                                    <span class="rounded-md border border-[#1e293b] bg-[#0b1120]/70 px-2 py-1 text-[8px] text-[#cbd5e1]">
                                        {emitted}
                                    </span>
                                {/each}
                            </div>
                        </div>

                        <div class="mt-2">
                            <a
                                href={contract.sourceHref}
                                target="_blank"
                                rel="noreferrer"
                                class="text-[8px] text-[#7dd3fc] transition-colors hover:text-[#bae6fd]"
                            >
                                Open source
                            </a>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if activeTab === "state"}
            <div class="mt-3 grid gap-2">
                {#each model.stores as store (store.name)}
                    <div
                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/40 p-3"
                    >
                        <div class="text-[9px] text-[#e2e8f0]">{store.name}</div>
                        <div class="mt-1 text-[8px] text-[#94a3b8]">
                            {store.purpose}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if activeTab === "coverage"}
            <div class="mt-3 grid gap-2">
                {#each model.workstreams as workstream (workstream.id)}
                    <div
                        class="rounded-lg border border-[#1e293b] bg-[#0f172a]/40 p-3"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div class="text-[9px] text-[#e2e8f0]">
                                {workstream.label}
                            </div>
                            <span
                                class={`rounded-md border px-2 py-1 text-[8px] ${getStatusClasses(workstream.status)}`}
                            >
                                {getStatusLabel(workstream.status)}
                            </span>
                        </div>
                        <div class="mt-1 text-[8px] text-[#94a3b8]">
                            {workstream.summary}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>
