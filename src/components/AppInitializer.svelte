<script lang="ts">
    import { onMount } from "svelte";
    import {
        attachUnhandledRejectionListener,
        detachUnhandledRejectionListener,
        validateEnvironmentOnce,
    } from "../utils/appInitializerSingleton";

    /**
     * App Initializer Component
     *
     * Runs critical initialization on app startup:
     * - Validates environment variables
     * - Sets up global error handlers
     * - Initializes telemetry (if needed)
     */
    import { useBalanceAutoRefresh } from "../hooks/useBalanceAutoRefresh.svelte";

    // Global hooks
    useBalanceAutoRefresh();

    onMount(() => {
        validateEnvironmentOnce();
        attachUnhandledRejectionListener();

        // Cleanup on unmount
        return () => {
            detachUnhandledRejectionListener();
        };
    });
</script>

<!-- This component has no UI, it just runs initialization logic -->
