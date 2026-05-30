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
    "Sequel prompt",
    "Post in your voice",
    "Poster idea",
  ];

  const INITIAL_VISIBLE_RESULTS = 24;
  const RESULTS_INCREMENT = 24;

  let smols = $state<any[]>([]);
  let search = $state("");
  let selectedIndex = $state(0);
  let visibleResultCount = $state(INITIAL_VISIBLE_RESULTS);
  let selectorExpanded = $state(true);
  let isLoading = $state(true);
  let loadError = $state("");
  let input = $state("");
  let chatHistory = $state<ChatMessage[]>([]);
  let isAsking = $state(false);
  let statusMessage = $state("Preview ready while Gemini status is unknown.");
  let lastMode = $state<"llm" | "preview" | "error">("preview");
  let apiError = $state("");
  let inspectorOpen = $state(false);

  const normalizedSmols = $derived(smols.map((smol) => normalizeSmol(smol)));
  const matchingEntries = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const entries = normalizedSmols.map((context, index) => ({ context, index }));
    if (!q) return entries;
    return entries.filter(({ context }) => [
      context.title,
      context.id,
      context.creator || "",
      context.artist || "",
      context.tags.join(" "),
    ].join(" ").toLowerCase().includes(q));
  });
  const filteredEntries = $derived(matchingEntries.slice(0, visibleResultCount));
  const hiddenResultCount = $derived(Math.max(matchingEntries.length - filteredEntries.length, 0));
  const selectedContext = $derived(normalizedSmols[selectedIndex] || normalizedSmols[0]);
  const promptPreview = $derived(selectedContext
    ? buildSmolPersonaPrompt(selectedContext, input || "Explain yourself", chatHistory)
    : null);
  const modeLabel = $derived(lastMode === "llm" ? "Gemini" : lastMode === "error" ? "Error" : "Preview");
  const selectedPreviewText = $derived(
    selectedContext
      ? selectedContext.styleText || selectedContext.promptText || selectedContext.lyricsText || "No style, prompt, or lyrics preview found in the loaded record."
      : "",
  );

  $effect(() => {
    search;
    visibleResultCount = INITIAL_VISIBLE_RESULTS;
  });

  onMount(async () => {
    try {
      isLoading = true;
      smols = await safeFetchSmols({ limit: 5000 });
      if (smols.length === 0) {
        loadError = "No Smols loaded from the canonical data source or snapshot fallback.";
      } else {
        statusMessage = `Loaded ${smols.length} Smols from the live/snapshot data path.`;
      }
    } catch (error: any) {
      loadError = error?.message || "Failed to load Smols.";
    } finally {
      isLoading = false;
    }
  });

  function selectSmol(index: number) {
    selectedIndex = index;
    selectorExpanded = false;
    chatHistory = [];
    apiError = "";
    lastMode = "preview";
    statusMessage = "Selected a new Smol. Persona context rebuilt from metadata.";
  }

  function showMoreResults() {
    visibleResultCount += RESULTS_INCREMENT;
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
        statusMessage = "Gemini mode — live song-spirit response.";
        chatHistory = [...chatHistory, { role: "assistant", content: result.reply, mode: "llm" }];
        return;
      }

      apiError = result.error || "LLM unavailable. Falling back to local preview.";
      lastMode = "preview";
      statusMessage = "Preview fallback — no working LLM response available.";
      chatHistory = [
        ...chatHistory,
        { role: "assistant", content: localPreviewReply(selectedContext, message, outgoingHistory), mode: "preview" },
      ];
    } catch (error: any) {
      apiError = error?.message || "Ask the Smol API unavailable. Falling back to local preview.";
      lastMode = "preview";
      statusMessage = "Preview fallback — API call did not complete.";
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

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="ask-smol-shell min-h-screen bg-[#050505] px-3 pb-10 pt-20 font-mono text-white sm:px-4 md:px-6">
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 md:gap-6">
    <header class="rounded-[1.5rem] border border-[#9ae600]/30 bg-[#9ae600]/5 p-4 shadow-[0_0_40px_rgba(154,230,0,0.08)] md:rounded-3xl md:p-7">
      <a href="/labs" class="inline-flex min-h-11 items-center text-xs uppercase tracking-[0.22em] text-[#9ae600]/80 underline-offset-4 hover:text-[#9ae600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9ae600]">← Back to Labs</a>
      <div class="mt-3 flex min-w-0 flex-col gap-3 md:mt-5 md:flex-row md:items-end md:justify-between">
        <div class="min-w-0">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <p class="inline-flex rounded-full border border-[#FDDA24]/30 bg-[#FDDA24]/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#FDDA24]">Lab experiment</p>
            <span class={`inline-flex rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${lastMode === "llm" ? "border-[#9ae600]/30 bg-[#9ae600]/10 text-[#9ae600]" : apiError || loadError ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-[#FDDA24]/30 bg-[#FDDA24]/10 text-[#FDDA24]"}`}>{modeLabel}</span>
          </div>
          <h1 class="text-[clamp(2rem,13vw,4.75rem)] font-black leading-none tracking-tight">Ask the Smol</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-200 md:text-base">Search any Smol, pick a song-spirit, and ask it questions in a fictional voice shaped by its metadata.</p>
        </div>
        <p class="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs leading-5 text-slate-300 md:max-w-sm">
          Fictional persona only — not a real person, the artist, or professional advice.
        </p>
      </div>
    </header>

    <div class="ask-smol-layout grid gap-4 md:gap-6 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
      <aside class="selector-panel min-w-0 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 md:rounded-3xl md:p-4 lg:sticky lg:top-24 lg:max-h-[calc(100svh-7rem)] lg:overflow-hidden">
        <div class="flex min-w-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-bold">Find a Smol</h2>
            <p class="text-xs leading-5 text-slate-400">Search title, tag, artist metadata, or id.</p>
          </div>
          <span class="shrink-0 rounded-full bg-[#9ae600]/10 px-2 py-1 text-[10px] text-[#9ae600]">{smols.length} loaded</span>
        </div>

        <label class="mt-4 block text-xs uppercase tracking-[0.18em] text-slate-500" for="ask-smol-search">Search</label>
        <input
          id="ask-smol-search"
          bind:value={search}
          class="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-base text-white outline-none placeholder:text-slate-600 focus:border-[#9ae600] md:text-sm"
          placeholder="Search every Smol…"
          onfocus={() => (selectorExpanded = true)}
        />

        {#if selectedContext && !selectorExpanded}
          <button class="mt-3 flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-[#9ae600]/25 bg-[#9ae600]/10 p-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9ae600]" onclick={() => (selectorExpanded = true)}>
            {#if selectedContext.imageUrl}
              <img class="h-10 w-10 shrink-0 rounded-xl bg-slate-900 object-cover" src={selectedContext.imageUrl} alt="" loading="lazy" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold text-white">{selectedContext.title}</span>
              <span class="block truncate text-[11px] text-slate-400">Tap to change Smol</span>
            </span>
          </button>
        {/if}

        {#if isLoading}
          <div class="mt-4 rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-slate-300">Loading Smol data…</div>
        {:else if loadError}
          <div class="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">{loadError}</div>
        {:else if selectorExpanded}
          <div class="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{matchingEntries.length} match{matchingEntries.length === 1 ? "" : "es"}</span>
            {#if matchingEntries.length > filteredEntries.length}
              <span>showing {filteredEntries.length}</span>
            {/if}
          </div>
          <div class="smol-results mt-3 space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100svh-20rem)]">
            {#each filteredEntries as entry (entry.context.id + entry.index)}
              <button
                class={`smol-row w-full rounded-2xl border p-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9ae600] ${entry.index === selectedIndex ? "border-[#9ae600] bg-[#9ae600]/10" : "border-white/10 bg-black/35 hover:border-white/25 hover:bg-white/[0.06]"}`}
                onclick={() => selectSmol(entry.index)}
              >
                <span class="flex min-w-0 gap-3">
                  {#if entry.context.imageUrl}
                    <img class="h-12 w-12 shrink-0 rounded-xl bg-slate-900 object-cover" src={entry.context.imageUrl} alt="" loading="lazy" />
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-bold text-white">{entry.context.title}</span>
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-slate-500">{entry.context.creator || entry.context.artist || entry.context.id}</span>
                    <span class="mt-1 flex min-w-0 gap-1 overflow-hidden">
                      {#each entry.context.tags.slice(0, 3) as tag}
                        <span class="max-w-[6.8rem] truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">#{tag}</span>
                      {/each}
                    </span>
                  </span>
                </span>
              </button>
            {/each}
          </div>
          {#if hiddenResultCount > 0}
            <button class="mt-3 min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-slate-200 hover:border-[#9ae600]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9ae600]" onclick={showMoreResults}>
              Show {Math.min(RESULTS_INCREMENT, hiddenResultCount)} more
            </button>
          {/if}
        {/if}
      </aside>

      <main class="grid min-w-0 gap-4 md:gap-6">
        <section class="min-w-0 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 md:rounded-3xl md:p-4">
          {#if selectedContext}
            <div class="selected-card grid min-w-0 gap-3 rounded-2xl border border-white/10 bg-black/50 p-3 sm:grid-cols-[5.5rem_minmax(0,1fr)] md:p-4">
              {#if selectedContext.imageUrl}
                <img class="h-24 w-24 rounded-2xl bg-slate-950 object-cover sm:h-[5.5rem] sm:w-[5.5rem]" src={selectedContext.imageUrl} alt={selectedContext.title} loading="lazy" />
              {/if}
              <div class="min-w-0 space-y-3">
                <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <p class="text-[10px] uppercase tracking-[0.22em] text-[#9ae600]">Selected song-spirit</p>
                    <h2 class="mt-1 overflow-wrap-anywhere text-xl font-black leading-tight md:text-2xl">{selectedContext.title}</h2>
                    <p class="mt-1 overflow-wrap-anywhere text-xs text-slate-500">ID: {selectedContext.id}</p>
                  </div>
                  <button class="min-h-11 shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200 hover:border-[#9ae600]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9ae600] lg:hidden" onclick={() => (selectorExpanded = true)}>Change</button>
                </div>

                <div class="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
                  {#each selectedContext.tags.slice(0, 6) as tag}
                    <span class="shrink-0 rounded-full border border-[#9ae600]/20 bg-[#9ae600]/10 px-2.5 py-1 text-xs text-[#9ae600]">#{tag}</span>
                  {/each}
                  {#if selectedContext.tags.length === 0}
                    <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400">No tags supplied</span>
                  {/if}
                </div>

                <p class="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-300">{selectedPreviewText}</p>

                {#if selectedContext.audioUrl}
                  <audio class="w-full max-w-full" controls src={selectedContext.audioUrl}>Audio preview unavailable.</audio>
                {/if}
              </div>
            </div>
          {:else}
            <div class="rounded-2xl border border-white/10 bg-black/40 p-6 text-slate-300">Load or select a Smol to begin.</div>
          {/if}
        </section>

        <section class="chat-panel flex min-w-0 flex-col rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 md:rounded-3xl md:p-5">
          <div class="flex min-w-0 flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <h2 class="text-xl font-black">Chat</h2>
              <p class="mt-1 text-xs text-slate-400">Mode: <span class={lastMode === "llm" ? "text-[#9ae600]" : "text-[#FDDA24]"}>{lastMode === "llm" ? "Gemini" : "Local preview fallback"}</span></p>
              <p class="mt-1 overflow-wrap-anywhere text-xs text-slate-500">{statusMessage}</p>
              {#if apiError}
                <p class="mt-2 overflow-wrap-anywhere rounded-xl border border-[#FDDA24]/20 bg-[#FDDA24]/10 px-3 py-2 text-xs leading-5 text-[#FDDA24]">{apiError}</p>
              {/if}
            </div>
          </div>

          <div class="messages min-w-0 flex-1 space-y-3 overflow-y-auto py-4" aria-live="polite">
            {#if chatHistory.length === 0}
              <div class="rounded-2xl border border-dashed border-white/15 bg-black/30 p-4 text-sm leading-6 text-slate-300">
                Pick a starter or ask your own question. The same universal prompt is used for every Smol; only the normalized context changes.
              </div>
            {/if}
            {#each chatHistory as message, i (`${message.role}-${i}`)}
              <div class={`message-bubble max-w-[94%] rounded-2xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-[#9ae600] text-black" : "mr-auto border border-white/10 bg-black/55 text-slate-100"}`}>
                {#if message.role === "assistant" && message.mode === "preview"}
                  <p class="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#FDDA24]">Local preview fallback</p>
                {/if}
                <p class="whitespace-pre-wrap">{message.content}</p>
              </div>
            {/each}
            {#if isAsking}
              <div class="mr-auto rounded-2xl border border-white/10 bg-black/55 p-3 text-sm text-slate-300">Waking the song-spirit…</div>
            {/if}
          </div>

          <div class="composer space-y-3 border-t border-white/10 pt-4">
            <div class="starter-strip flex gap-2 overflow-x-auto pb-1">
              {#each STARTERS as starter}
                <button class="min-h-11 shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-[#9ae600] hover:text-[#9ae600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9ae600]" onclick={() => ask(starter)} disabled={isAsking || !selectedContext}>{starter}</button>
              {/each}
            </div>
            <form class="composer-form flex min-w-0 gap-2" onsubmit={submit}>
              <textarea
                bind:value={input}
                rows="2"
                class="min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-base text-white outline-none placeholder:text-slate-600 focus:border-[#9ae600] disabled:opacity-60 md:text-sm"
                placeholder="Ask the Smol anything…"
                disabled={isAsking || !selectedContext}
              ></textarea>
              <button class="min-h-14 rounded-2xl bg-[#9ae600] px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50" disabled={isAsking || !input.trim() || !selectedContext}>Ask</button>
            </form>
          </div>

          {#if selectedContext && promptPreview}
            <details bind:open={inspectorOpen} class="prompt-inspector mt-4 min-w-0 rounded-2xl border border-[#9ae600]/20 bg-black/70 text-xs leading-5 text-slate-300">
              <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-white">
                <span>Prompt Inspector</span>
                <span class="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">{modeLabel}</span>
              </summary>
              <div class="max-h-[55svh] min-w-0 overflow-y-auto border-t border-white/10 p-4">
                <p class="mb-3 overflow-wrap-anywhere rounded-xl bg-white/[0.04] p-3 text-slate-300">Provider error: {apiError || "None"}</p>
                <details open class="mb-3">
                  <summary class="min-h-10 cursor-pointer text-white">Mode</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{modeLabel}</pre>
                </details>
                <details class="mb-3">
                  <summary class="min-h-10 cursor-pointer text-white">Normalized context</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{JSON.stringify(selectedContext, null, 2)}</pre>
                </details>
                <details class="mb-3">
                  <summary class="min-h-10 cursor-pointer text-white">Universal prompt</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{promptPreview.systemPrompt}</pre>
                </details>
                <details class="mb-3">
                  <summary class="min-h-10 cursor-pointer text-white">Normalized context block</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{promptPreview.contextBlock}</pre>
                </details>
                <details class="mb-3">
                  <summary class="min-h-10 cursor-pointer text-white">Recent message payload</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{JSON.stringify({ userMessage: promptPreview.userMessage, chatHistory: promptPreview.chatHistory }, null, 2)}</pre>
                </details>
                <details>
                  <summary class="min-h-10 cursor-pointer text-white">Final composed prompt</summary>
                  <pre class="inspector-pre mt-2 rounded-xl bg-white/[0.04] p-3">{promptPreview.finalPrompt}</pre>
                </details>
              </div>
            </details>
          {/if}
        </section>
      </main>
    </div>
  </div>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  .ask-smol-shell {
    overflow-x: hidden;
    overflow-x: clip;
    padding-left: max(0.75rem, env(safe-area-inset-left));
    padding-right: max(0.75rem, env(safe-area-inset-right));
  }

  .ask-smol-layout,
  .selector-panel,
  .chat-panel,
  .selected-card,
  .message-bubble,
  .prompt-inspector {
    min-width: 0;
  }

  .overflow-wrap-anywhere,
  .message-bubble,
  .inspector-pre {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .smol-results {
    max-height: min(42svh, 25rem);
  }

  .smol-row {
    min-height: 4.25rem;
  }

  .chat-panel {
    min-height: min(76svh, 42rem);
  }

  .messages {
    max-height: 46svh;
  }

  .starter-strip,
  .selected-card .overflow-x-auto {
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }

  .inspector-pre {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
  }

  .prompt-inspector summary::-webkit-details-marker {
    display: none;
  }

  @media (max-width: 430px) {
    .composer-form {
      flex-direction: column;
    }

    .composer-form button {
      width: 100%;
    }
  }

  @media (min-width: 768px) {
    .messages {
      max-height: 34rem;
    }
  }

  @media (min-width: 1024px) {
    .smol-results {
      max-height: calc(100svh - 20rem);
    }
  }
</style>
