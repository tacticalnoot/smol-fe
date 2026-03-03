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
    // We can wrap this in a try-catch to ensure haptic failures (e.g., feature policy, unsupported)
    // don't crash any interactions. web-haptics handles feature detection, but it's safe to be sure.
    try {
        if (WebHaptics.isSupported) {
            haptics.trigger(input, options).catch(() => { });
        }
    } catch (error) {
        console.warn("Haptic trigger failed", error);
    }
};
