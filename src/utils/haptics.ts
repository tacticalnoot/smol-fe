import { WebHaptics } from "web-haptics";

// Create a globally accessible instance of WebHaptics
// This avoids instantiation overhead and simplifies usage across all components.
export const haptics = new WebHaptics({
    // options can be passed here if needed, like debug: true
});

/**
 * Triggers haptic feedback.
 * @param input preset name ("success", "error", "nudge", etc.), or duration in ms, or pattern array.
 * @param options optional intensity options.
 */
export const triggerHaptic = (
    input?: Parameters<typeof haptics.trigger>[0],
    options?: Parameters<typeof haptics.trigger>[1]
) => {
    // Always call trigger() — web-haptics handles iOS internally via a hidden
    // DOM label click fallback when the Vibration API isn't available.
    // Do NOT gate on WebHaptics.isSupported; that only checks navigator.vibrate
    // which iOS lacks, but the library still provides tactile feedback there.
    try {
        haptics.trigger(input, options).catch(() => { });
    } catch (error) {
        console.warn("Haptic trigger failed", error);
    }
};

/**
 * Crisp MPC/Launchpad rubber-pad press.
 * Sharp initial snap + quick damped bounce-back.
 */
export const PAD_PRESS = [
    { duration: 12, intensity: 1.0 },
    { delay: 10, duration: 8, intensity: 0.3 },
];
