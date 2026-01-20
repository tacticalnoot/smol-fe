<script lang="ts">
    import { onMount } from "svelte";
    import { fade, fly, scale } from "svelte/transition";
    import { useAuthentication } from "../../hooks/useAuthentication";
    import { userState } from "../../stores/user.svelte";
    import { setBackgroundAnimations } from "../../stores/background.svelte.ts";
    import Loader from "../ui/Loader.svelte";
    import { Turnstile } from "svelte-turnstile";

    // State
    let step = $state<"intro" | "username" | "processing" | "success">("intro");
    let username = $state("");
    let error = $state<string | null>(null);
    let turnstileToken = $state("");

    // Check for Direct Relayer Mode (Dev/Preview)
    const isDirectRelayer = !!import.meta.env.PUBLIC_RELAYER_API_KEY;

    // ... (inside script)

    function handleKeydown(e: KeyboardEvent) {
        if (step === "intro") {
            if (e.key === "Enter" || e.key === " ") {
                handleSmartLogin();
            }
        } else if (step === "username") {
            if (e.key === "Enter") {
                submitUsername();
            }
            if (e.key === "Escape") {
                step = "intro";
            }
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
    class="fixed inset-0 bg-transparent text-white overflow-y-auto font-pixel z-[9999]"
>
    <!-- ... (rest of template) -->

                    <!-- Turnstile moved above buttons for better visibility -->
                    {#if !isDirectRelayer}
                    <div
                        class="flex justify-center my-2 scale-90 origin-center min-h-[65px]"
                    >
                        <Turnstile
                            siteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY}
                            on:callback={(e) => {
                                turnstileToken = e.detail.token;
                                error = null;
                            }}
                            on:expired={() => {
                                turnstileToken = "";
                            }}
                            on:error={(e) => {
                                console.error("Turnstile Error:", e);
                                // Check for common "Domain Not Allowed" error (110200)
                                // Note: e.detail may contain the code, or we infer from context
                                if (
                                    window.location.hostname.includes(
                                        "pages.dev",
                                    ) ||
                                    window.location.hostname.includes(
                                        "localhost",
                                    )
                                ) {
                                    error =
                                        "Turnstile Error: Domain not authorized. Add to Cloudflare whitelist.";
                                } else {
                                    error =
                                        "Verification failed. Please refresh.";
                                }
                            }}
                            theme="dark"
                            appearance="interaction-only"
                        />
                    </div>
                    {/if}

                    <div class="flex w-full gap-3 mt-2">
                        <button
                            onclick={() => (step = "intro")}
                            class="flex-1 py-3 border-2 border-white/10 text-white/60 font-pixel uppercase text-xs rounded-lg hover:bg-white/5 hover:text-white transition-colors"
                        >
                            Back
                        </button>
                        <button
                            onclick={() => {
                                if (!username.trim()) {
                                    error = "Please enter a username.";
                                    return;
                                }
                                if (!turnstileToken && !isDirectRelayer) {
                                    error =
                                        "Please complete the verification check above.";
                                    return;
                                }
                                submitUsername();
                            }}
                            class="flex-[2] py-3 bg-lime-500 text-black font-pixel font-bold uppercase text-xs rounded-lg shadow-[0_4px_0_rgba(65,130,22,0.6)]
                                hover:bg-lime-400 active:translate-y-1 active:shadow-none transition-all
                                {!username.trim() || (!turnstileToken && !isDirectRelayer)
                                 ? 'opacity-80 cursor-not-allowed'
                                 : ''}"
                        >
                            Start Game
                        </button>
                    </div>

                    <div
                        class="mt-4 text-[10px] text-lime-400 font-pixel uppercase tracking-widest opacity-80 text-center"
                    >
                        🔒 Your Keys. Your Music. 🔑
                    </div>
                </div>
            {:else if step === "processing"}
                <div class="flex flex-col items-center gap-4" in:fade>
                    <Loader classNames="w-12 h-12" textColor="text-white" />
                    <p
                        class="text-white font-pixel animate-pulse text-xs uppercase tracking-widest"
                    >
                        Authorizing...
                    </p>
                </div>
            {:else if step === "success"}
                <div
                    class="flex flex-col items-center gap-4 text-center"
                    in:scale
                >
                    <div class="text-4xl">🎉</div>
                    <h2 class="text-2xl font-pixel uppercase text-lime-400">
                        Ready!
                    </h2>
                    <p class="text-white/60 font-pixel text-xs">
                        Entering the ecosystem...
                    </p>
                </div>
            {/if}
        </div>

        <!-- FOOTER CONTROLS REMOVED -->
    </main>
</div>

<style>
    /* Safely handle specific safe areas */
    .safe-area-inset-bottom {
        padding-bottom: env(safe-area-inset-bottom, 24px);
    }
</style>
