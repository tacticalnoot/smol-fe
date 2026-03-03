<script lang="ts">
    import { onMount } from "svelte";

    let logs: string[] = [];
    let buttonText = $state("📋 Copy Console");
    let isDebugEnvironment = $state(false);

    onMount(() => {
        // Only show in dev mode or if ?debug is in URL
        isDebugEnvironment =
            import.meta.env.DEV ||
            new URLSearchParams(window.location.search).has("debug");

        if (!isDebugEnvironment) return;

        const methods = ["log", "warn", "error", "info", "debug"];
        const originals: Record<string, Function> = {};

        methods.forEach((method) => {
            originals[method] = (console as any)[method];
            (console as any)[method] = (...args: any[]) => {
                try {
                    const msg = args
                        .map((a) => {
                            if (typeof a === "object" && a !== null) {
                                try {
                                    return JSON.stringify(a);
                                } catch (e) {
                                    return "[Object]";
                                }
                            }
                            return String(a);
                        })
                        .join(" ");
                    logs.push(`[${method.toUpperCase()}] ${msg}`);
                    if (logs.length > 2000) logs.shift(); // Keep last 2000
                } catch (e) {}

                originals[method].apply(console, args);
            };
        });

        window.addEventListener("error", (e) => {
            logs.push(
                `[UNCAUGHT ERROR] ${e.message} at ${e.filename}:${e.lineno}`,
            );
        });

        window.addEventListener("unhandledrejection", (e) => {
            logs.push(`[UNHANDLED PROMISE] ${e.reason}`);
        });
    });

    function copyLogs() {
        navigator.clipboard.writeText(logs.join("\n"));
        buttonText = "✅ Copied!";
        setTimeout(() => (buttonText = "📋 Copy Console"), 2000);
    }
</script>

{#if isDebugEnvironment}
    <button
        onclick={copyLogs}
        style="position: fixed; bottom: 80px; right: 20px; z-index: 999999; background: #1a1a1a; color: #00ff00; border: 1px solid #00ff00; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; font-family: monospace; box-shadow: 0 4px 12px rgba(0, 255, 0, 0.2); transition: all 0.2s;"
        onmouseover={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onmouseout={(e) => (e.currentTarget.style.transform = "scale(1)")}
        title="Copy Raw Browser Console Logs"
    >
        {buttonText}
    </button>
{/if}
