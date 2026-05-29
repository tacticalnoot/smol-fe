<script lang="ts">
  import { onMount } from "svelte";
  import { safeFetchSmols } from "../../services/api/smols";
  import { normalizeSmol } from "../../lib/smolPersona/normalizeSmol";
  import { buildSmolPersonaPrompt } from "../../lib/smolPersona/buildSmolPersonaPrompt";
  import { localPreviewReply } from "../../lib/smolPersona/localPreviewReply";
  import { askSmolViaApi } from "../../lib/smolPersona/askSmolClient";
  import type { SmolPersonaChatMessage } from "../../lib/smolPersona/types";

  type ChatMessage = SmolPersonaChatMessage & { mode?: "llm" | "preview" | "error" };

  const STARTERS = [
    "Explain yourself",
    "What are you about?",
    "Give me lore",
    "Write a sequel prompt",
    "Make an X post in your voice",
    "What would you say to your creator?",
    "Roast this market",
    "Turn yourself into a poster idea",
  ];

  let smols = $state<any[]>([]);
  let search = $state("");
  let selectedIndex = $state(0);
  let isLoading = $state(true);
  let loadError = $state("");
  let input = $state("");
  let chatHistory = $state<ChatMessage[]>([]);
  let isAsking = $state(false);
  let statusMessage = $state("Local preview ready while Gemini status is unknown.");
  let lastMode = $state<"llm" | "preview" | "error">("preview");
  let apiError = $state("");
  let inspectorOpen = $state(false);

  const normalizedSmols = $derived(smols.map((smol) => normalizeSmol(smol)));
  const filteredEntries = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const entries = normalizedSmols.map((context, index) => ({ context, index }));
    if (!q) return entries.slice(0, 80);
    return entries
      .filter(({ context }) => [
        context.title,
        context.id,
        context.creator || "",
        context.artist || "",
        context.tags.join(" "),
      ].join(" ").toLowerCase().includes(q))
      .slice(0, 80);
  });
  const selectedContext = $derived(normalizedSmols[selectedIndex] || normalizedSmols[0]);
  const promptPreview = $derived(selectedContext
    ? buildSmolPersonaPrompt(selectedContext, input || "Explain yourself", chatHistory)
    : null);

  onMount(async () => {
    try {
      isLoading = true;
      smols = await safeFetchSmols({ limit: 5000 });
      if (smols.length === 0) {
        loadError = "No Smols loaded from the canonical data source or snapshot fallback.";
      } else {
        statusMessage = `Loaded ${smols.length} Smols from the canonical live/snapshot data path.`;
      }
    } catch (error: any) {
      loadError = error?.message || "Failed to load Smols.";
    } finally {
      isLoading = false;
    }
  });

  function selectSmol(index: number) {
    selectedIndex = index;
    chatHistory = [];
    apiError = "";
    lastMode = "preview";
    statusMessage = "Selected a new Smol. Persona context rebuilt from metadata.";
  }

  async function ask(messageOverride?: string) {
    const message = (messageOverride || input).trim();
    if (!message || !selectedContext || isAsking) return;

    const outgoingHistory = chatHistory.map(({ role, content }) => ({ role, content }));
    chatHistory = [...chatHistory, { role: "user", content: message }];
    input = "";
    isAsking = true;
    apiError = "";

    try {
      const result = await askSmolViaApi({
        context: selectedContext,
        message,
        chatHistory: outgoingHistory,
      });

      if (result.ok && result.mode === "llm" && result.reply) {
        lastMode = "llm";
        statusMessage = "Gemini/LLM mode — live song-spirit response.";
        chatHistory = [...chatHistory, { role: "assistant", content: result.reply, mode: "llm" }];
        return;
      }

      apiError = result.error || "LLM unavailable. Falling back to local preview.";
      lastMode = "preview";
      statusMessage = "Local preview fallback — no working LLM response available.";
      chatHistory = [
        ...chatHistory,
        { role: "assistant", content: localPreviewReply(selectedContext, message, outgoingHistory), mode: "preview" },
      ];
    } catch (error: any) {
      apiError = error?.message || "Ask the Smol API unavailable. Falling back to local preview.";
      lastMode = "preview";
      statusMessage = "Local preview fallback — API call did not complete.";
      chatHistory = [
        ...chatHistory,
        { role: "assistant", content: localPreviewReply(selectedContext, message, outgoingHistory), mode: "preview" },
      ];
    } finally {
      isAsking = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    ask();
  }
</script>

<div class="min-h-screen bg-[#050505] text-white pt-24 pb-12 px-4 md:px-6 font-mono">
  <div class="mx-auto flex max-w-7xl flex-col gap-6">
    <header class="rounded-3xl border border-[#9ae600]/30 bg-[#9ae600]/5 p-5 md:p-8 shadow-[0_0_40px_rgba(154,230,0,0.08)]">
      <a href="/labs" class="text-xs uppercase tracking-[0.3em] text-[#9ae600]/70 hover:text-[#9ae600]">← Back to Labs</a>
      <div class="mt-5 grid gap-4 md:grid-cols-[1.4fr_0.8fr] md:items-end">
        <div>
          <p class="mb-3 inline-flex rounded-full border border-[#FDDA24]/30 bg-[#FDDA24]/10 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-[#FDDA24]">Lab experiment</p>
          <h1 class="text-4xl font-black tracking-tight md:text-6xl">Ask the Smol</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">Every song has a tiny fictional oracle. Pick one and talk to it.</p>
          <p class="mt-3 text-xs uppercase tracking-[0.22em] text-[#9ae600]">Every Smol has a soul. Ask it questions.</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-5 text-slate-300">
          <strong class="text-white">Safety note:</strong> This is a fictional persona derived from song metadata. It is not the creator, not a real person, and not financial, legal, medical, or political advice.
        </div>
      </div>
    </header>

    <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
      <aside class="rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-hidden">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold">Smol selector</h2>
            <p class="text-xs text-slate-400">Search title, tag, creator, or id.</p>
          </div>
          <span class="rounded-full bg-[#9ae600]/10 px-2 py-1 text-[10px] text-[#9ae600]">{smols.length} loaded</span>
        </div>
        <input
          bind:value={search}
          class="mt-4 w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[#9ae600]"
          placeholder="Search every Smol…"
        />

        {#if isLoading}
          <div class="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-slate-300">Loading canonical Smol data…</div>
        {:else if loadError}
          <div class="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">{loadError}</div>
        {:else}
          <div class="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-16rem)]">
            {#each filteredEntries as entry (entry.context.id + entry.index)}
              <button
                class={`w-full rounded-2xl border p-3 text-left transition ${entry.index === selectedIndex ? "border-[#9ae600] bg-[#9ae600]/10" : "border-white/10 bg-black/35 hover:border-white/25 hover:bg-white/[0.06]"}`}
                onclick={() => selectSmol(entry.index)}
              >
                <div class="flex gap-3">
                  {#if entry.context.imageUrl}
                    <img class="h-14 w-14 shrink-0 rounded-xl bg-slate-900 object-cover" src={entry.context.imageUrl} alt={entry.context.title} loading="lazy" />
                  {/if}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-bold text-white">{entry.context.title}</p>
                    <p class="truncate text-[11px] text-slate-500">{entry.context.creator || entry.context.artist || entry.context.id}</p>
                    <div class="mt-2 flex flex-wrap gap-1">
                      {#each entry.context.tags.slice(0, 3) as tag}
                        <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">#{tag}</span>
                      {/each}
                    </div>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </aside>

      <main class="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section class="rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          {#if selectedContext}
            <div class="overflow-hidden rounded-2xl border border-white/10 bg-black/50">
              {#if selectedContext.imageUrl}
                <img class="aspect-square w-full bg-slate-950 object-cover" src={selectedContext.imageUrl} alt={selectedContext.title} />
              {/if}
              <div class="space-y-4 p-4">
                <div>
                  <p class="text-[10px] uppercase tracking-[0.25em] text-[#9ae600]">Selected song-spirit</p>
                  <h2 class="mt-1 text-2xl font-black">{selectedContext.title}</h2>
                  <p class="mt-1 break-all text-xs text-slate-500">ID: {selectedContext.id}</p>
                  {#if selectedContext.creator || selectedContext.artist}
                    <p class="mt-2 text-sm text-slate-300">Creator/artist metadata: {selectedContext.creator || selectedContext.artist}</p>
                  {/if}
                </div>

                <div class="flex flex-wrap gap-2">
                  {#each selectedContext.tags.slice(0, 10) as tag}
                    <span class="rounded-full border border-[#9ae600]/20 bg-[#9ae600]/10 px-2.5 py-1 text-xs text-[#9ae600]">#{tag}</span>
                  {/each}
                  {#if selectedContext.tags.length === 0}
                    <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400">No tags supplied</span>
                  {/if}
                </div>

                {#if selectedContext.audioUrl}
                  <audio class="w-full" controls src={selectedContext.audioUrl}>Audio preview unavailable.</audio>
                {/if}

                <div class="space-y-3 text-xs leading-5 text-slate-300">
                  <div class="rounded-2xl bg-white/[0.04] p-3">
                    <p class="mb-1 font-bold text-white">Style / prompt preview</p>
                    <p class="line-clamp-6 whitespace-pre-wrap">{selectedContext.styleText || selectedContext.promptText || "No style or prompt text found in the loaded record."}</p>
                  </div>
                  <div class="rounded-2xl bg-white/[0.04] p-3">
                    <p class="mb-1 font-bold text-white">Lyrics preview</p>
                    <p class="line-clamp-6 whitespace-pre-wrap">{selectedContext.lyricsText || "No lyrics found in the loaded record."}</p>
                  </div>
                </div>
              </div>
            </div>
          {:else}
            <div class="rounded-2xl border border-white/10 bg-black/40 p-6 text-slate-300">Load or select a Smol to begin.</div>
          {/if}
        </section>

        <section class="flex min-h-[620px] flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <h2 class="text-xl font-black">Chat with the fictional oracle</h2>
              <p class="mt-1 text-xs text-slate-400">Mode: <span class={lastMode === "llm" ? "text-[#9ae600]" : "text-[#FDDA24]"}>{lastMode === "llm" ? "Gemini/LLM" : "Local preview fallback"}</span></p>
              <p class="mt-1 text-xs text-slate-500">{statusMessage}</p>
              {#if apiError}
                <p class="mt-2 rounded-xl border border-[#FDDA24]/20 bg-[#FDDA24]/10 px-3 py-2 text-xs text-[#FDDA24]">{apiError}</p>
              {/if}
            </div>
            <button class="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-[#9ae600] hover:text-[#9ae600]" onclick={() => (inspectorOpen = !inspectorOpen)}>
              {inspectorOpen ? "Hide" : "Show"} Prompt Inspector
            </button>
          </div>

          <div class="flex-1 space-y-3 overflow-y-auto py-4">
            {#if chatHistory.length === 0}
              <div class="rounded-2xl border border-dashed border-white/15 bg-black/30 p-5 text-sm leading-6 text-slate-300">
                Pick a starter below or ask your own question. The same universal prompt is used for every Smol; only the normalized context changes.
              </div>
            {/if}
            {#each chatHistory as message, i (`${message.role}-${i}`)}
              <div class={`max-w-[92%] rounded-2xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-[#9ae600] text-black" : "mr-auto border border-white/10 bg-black/55 text-slate-100"}`}>
                {#if message.role === "assistant" && message.mode === "preview"}
                  <p class="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#FDDA24]">Local preview fallback</p>
                {/if}
                <p class="whitespace-pre-wrap">{message.content}</p>
              </div>
            {/each}
            {#if isAsking}
              <div class="mr-auto rounded-2xl border border-white/10 bg-black/55 p-3 text-sm text-slate-300">Waking the song-spirit…</div>
            {/if}
          </div>

          <div class="space-y-3 border-t border-white/10 pt-4">
            <div class="flex flex-wrap gap-2">
              {#each STARTERS as starter}
                <button class="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 hover:border-[#9ae600] hover:text-[#9ae600]" onclick={() => ask(starter)} disabled={isAsking || !selectedContext}>{starter}</button>
              {/each}
            </div>
            <form class="flex gap-2" onsubmit={submit}>
              <textarea
                bind:value={input}
                rows="2"
                class="min-h-14 flex-1 resize-none rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[#9ae600]"
                placeholder="Ask the Smol anything…"
                disabled={isAsking || !selectedContext}
              ></textarea>
              <button class="rounded-2xl bg-[#9ae600] px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50" disabled={isAsking || !input.trim() || !selectedContext}>Ask</button>
            </form>
          </div>

          {#if inspectorOpen && selectedContext && promptPreview}
            <div class="mt-5 max-h-[520px] overflow-y-auto rounded-2xl border border-[#9ae600]/20 bg-black/80 p-4 text-xs leading-5 text-slate-300">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-bold text-[#9ae600]">Prompt Inspector</h3>
                <span class="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em]">{lastMode === "llm" ? "Gemini/LLM" : "Local preview fallback"}</span>
              </div>
              <details open class="mb-3">
                <summary class="cursor-pointer text-white">Normalized Smol context JSON</summary>
                <pre class="mt-2 overflow-x-auto rounded-xl bg-white/[0.04] p-3">{JSON.stringify(selectedContext, null, 2)}</pre>
              </details>
              <details class="mb-3">
                <summary class="cursor-pointer text-white">Universal system prompt</summary>
                <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3">{promptPreview.systemPrompt}</pre>
              </details>
              <details class="mb-3">
                <summary class="cursor-pointer text-white">Smol context block</summary>
                <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3">{promptPreview.contextBlock}</pre>
              </details>
              <details class="mb-3">
                <summary class="cursor-pointer text-white">Final composed prompt</summary>
                <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3">{promptPreview.finalPrompt}</pre>
              </details>
              <details class="mb-3">
                <summary class="cursor-pointer text-white">Final user message</summary>
                <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3">{promptPreview.userMessage}</pre>
              </details>
              <details>
                <summary class="cursor-pointer text-white">Recent chat history being sent</summary>
                <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3">{JSON.stringify(promptPreview.chatHistory, null, 2)}</pre>
              </details>
            </div>
          {/if}
        </section>
      </main>
    </div>
  </div>
</div>
