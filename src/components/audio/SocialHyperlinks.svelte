<script lang="ts">
    import { fade, slide, scale } from "svelte/transition";
    import { quintOut } from "svelte/easing";

    let expanded = $state(false);

    const socials = [
        {
            name: "X",
            icon: "social_x",
            url: "https://x.com/smolxyz",
            color: "hover:text-white",
        },
        {
            name: "Discord",
            icon: "social_discord",
            url: "https://discord.gg/smol",
            color: "hover:text-[#5865F2]",
        },
        {
            name: "Telegram",
            icon: "social_telegram",
            url: "https://t.me/smol_xyz",
            color: "hover:text-[#24A1DE]",
        },
        {
            name: "Facebook",
            icon: "social_facebook",
            url: "https://facebook.com/smolxyz",
            color: "hover:text-[#1877F2]",
        },
    ];

    function toggle() {
        expanded = !expanded;
    }
</script>

<div class="relative flex items-center">
    {#if expanded}
        <div
            class="absolute right-full mr-2 flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-2xl"
            transition:slide={{ axis: "x", duration: 400, easing: quintOut }}
        >
            {#each socials as social, i}
                <a
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="group relative flex items-center justify-center w-8 h-8 transition-all duration-300 {social.color} hover:scale-125"
                    title={social.name}
                    transition:scale={{ delay: i * 50, duration: 200 }}
                >
                    <div
                        class="absolute inset-0 bg-white/5 rounded-full scale-0 group-hover:scale-100 transition-transform duration-300"
                    ></div>
                    {#if social.name === "X"}
                        <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.25 2.25h6.663l4.715 6.175 5.616-6.175zM17.083 19.77h1.833L7.084 4.126H5.117L17.083 19.77z"
                            /></svg
                        >
                    {:else if social.name === "Discord"}
                        <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057c2.052 1.507 4.041 2.422 5.992 3.029a.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.607 3.95-1.522 6.002-3.029a.077.077 0 0 0 .032-.057c.545-5.223-1.058-9.67-4.33-13.66a.07.07 0 0 0-.032-.027zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.956 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z"
                            /></svg
                        >
                    {:else if social.name === "Telegram"}
                        <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06-.01.13-.02.2z"
                            /></svg
                        >
                    {:else if social.name === "Facebook"}
                        <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h2V1.5c-.8-.12-1.7-.2-2.5-.2-3.5 0-6 2.1-6 6v3h-3v4h3V24h5v-10.5z"
                            /></svg
                        >
                    {/if}
                    <span
                        class="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-950 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/10 uppercase tracking-widest font-bold"
                    >
                        {social.name}
                    </span>
                </a>
            {/each}
        </div>
    {/if}

    <button
        onclick={toggle}
        class="group relative w-10 h-10 flex items-center justify-center text-white/70 hover:text-lime-400 transition-all duration-300 {expanded
            ? 'bg-lime-400/20 text-lime-300'
            : 'bg-white/5'} border border-white/10 rounded-full overflow-hidden"
        aria-label="Social Links"
    >
        <div
            class="absolute inset-0 bg-gradient-to-tr from-lime-500/0 via-lime-500/0 to-lime-500/20 opacity-0 group-hover:opacity-100 transition-opacity"
        ></div>

        {#if expanded}
            <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                />
            </svg>
        {:else}
            <div class="flex flex-col items-center justify-center gap-0.5">
                <div
                    class="w-4 h-0.5 bg-current rounded-full transition-all group-hover:w-5"
                ></div>
                <div
                    class="w-3 h-0.5 bg-current rounded-full transition-all group-hover:w-4"
                ></div>
                <div
                    class="w-4 h-0.5 bg-current rounded-full transition-all group-hover:w-5"
                ></div>
            </div>
        {/if}

        <div
            class="absolute inset-0 ring-1 ring-inset ring-white/20 rounded-full group-hover:ring-lime-400/50 transition-all"
        ></div>
    </button>
</div>

<style>
    .backdrop-blur-xl {
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
    }
</style>
