import { onMount } from "svelte";
import { userState } from "../stores/user.state.svelte";
import { updateAllBalances, isTransactionInProgress } from "../stores/balance.svelte";

const AUTO_REFRESH_COOLDOWN_MS = 2500;
let lastAutoRefreshAt = 0;
let autoRefreshInFlight = false;

async function runAutoRefresh(reason: "auth_change" | "visibility" | "focus") {
    if (!userState.contractId) return;

    if (isTransactionInProgress()) {
        console.log(`[Balance] Auto refresh skipped (${reason}) - transaction in progress`);
        return;
    }

    const now = Date.now();
    if (autoRefreshInFlight || now - lastAutoRefreshAt < AUTO_REFRESH_COOLDOWN_MS) {
        console.log(`[Balance] Auto refresh throttled (${reason})`);
        return;
    }

    autoRefreshInFlight = true;
    lastAutoRefreshAt = now;

    try {
        console.log(`[Balance] Auto refresh running (${reason})`);
        await updateAllBalances(userState.contractId);
    } finally {
        autoRefreshInFlight = false;
    }
}

/**
 * Hook to automatically refresh balances when:
 * 1. The component mounts (and user is authenticated)
 * 2. The window regains focus (visibilitychange)
 * 3. The user logs in (reactive to userState.contractId)
 */
export function useBalanceAutoRefresh() {
    // 1. Reactive effect to fetch on auth change
    $effect(() => {
        if (userState.contractId && !isTransactionInProgress()) {
            // Slight delay to allow any pending state to settle
            const timer = setTimeout(() => {
                void runAutoRefresh("auth_change");
            }, 100);

            return () => {
                clearTimeout(timer);
            };
        }
    });

    onMount(() => {
        // 2. Handle visibility change (tab focus)
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible" && userState.contractId) {
                void runAutoRefresh("visibility");
            }
        };

        // 3. Handle window focus (sometimes visibilitychange isn't enough)
        const handleFocus = () => {
            if (userState.contractId) {
                void runAutoRefresh("focus");
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", handleFocus);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", handleFocus);
        };
    });
}
