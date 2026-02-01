
export const VIBE_CONSTANTS = {
    // Config
    GRID_SIZE: 32, // Sprite size
    FRAME_MS: 150, // Animation speed

    // State Constants
    STATES: {
        IDLE: "IDLE",
        WANDER: "WANDER",
        EAT: "EAT",
        RAVE: "RAVE",
        SLEEP: "SLEEP"
    },

    MOODS: {
        AWAKE: "AWAKE",
        ASLEEP: "ASLEEP"
    },

    // Thresholds
    SLEEP_TIMEOUT_MS: 24 * 60 * 60 * 1000, // 24 hours
    EAT_DURATION_MS: 600, // 4 frames * 150ms

    // Physics
    WALK_SPEED: 40, // px per second
    BOUNCE_DECAY: 0.85,
    MAX_DT: 0.05 // 50ms cap
} as const;

export type VibeState = keyof typeof VIBE_CONSTANTS.STATES;
export type VibeMood = keyof typeof VIBE_CONSTANTS.MOODS;
