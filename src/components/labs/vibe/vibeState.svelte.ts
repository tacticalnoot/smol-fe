
import { VIBE_CONSTANTS, type VibeState, type VibeMood } from './vibeMachine';

const STORAGE_KEY = "smol_vibe_pet_v1";

type VibePetData = {
    v: number;
    lastSeenAt: number;
    pendingSnacks: number;
    mood: VibeMood;
    pos: { x: number; y: number };
};

// Safe defaults
const DEFAULT_STATE: VibePetData = {
    v: 1,
    lastSeenAt: Date.now(),
    pendingSnacks: 0,
    mood: VIBE_CONSTANTS.MOODS.AWAKE,
    pos: { x: 50, y: 50 } // Center-ish
};

function loadState(): VibePetData {
    if (typeof window === "undefined") return DEFAULT_STATE;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_STATE;
        const data = JSON.parse(raw);
        return { ...DEFAULT_STATE, ...data }; // Merge to ensure shape
    } catch (e) {
        return DEFAULT_STATE;
    }
}

export class VibeStore {
    // Persisted Fields
    lastSeenAt = $state(Date.now());
    pendingSnacks = $state(0);
    mood = $state<VibeMood>(VIBE_CONSTANTS.MOODS.AWAKE);
    pos = $state({ x: 50, y: 50 });

    // Runtime Fields (Not persisted)
    currentState = $state<VibeState>(VIBE_CONSTANTS.STATES.IDLE);
    hype = $state(0); // 0-100
    sleepiness = $state(0);
    vel = { x: 0, y: 0 }; // Internal physics velocity

    constructor() {
        const saved = loadState();
        this.lastSeenAt = saved.lastSeenAt;
        this.pendingSnacks = saved.pendingSnacks;
        this.mood = saved.mood;
        this.pos = saved.pos;

        // Sleep Logic on Load
        const timeSince = Date.now() - this.lastSeenAt;
        if (timeSince > VIBE_CONSTANTS.SLEEP_TIMEOUT_MS) {
            this.mood = VIBE_CONSTANTS.MOODS.ASLEEP;
            this.currentState = VIBE_CONSTANTS.STATES.SLEEP;
        }
    }

    wakeUp() {
        this.mood = VIBE_CONSTANTS.MOODS.AWAKE;
        this.lastSeenAt = Date.now();
        if (this.currentState === VIBE_CONSTANTS.STATES.SLEEP) {
            this.currentState = VIBE_CONSTANTS.STATES.IDLE;
        }
        this.save();
    }

    addSnack() {
        this.wakeUp();
        this.pendingSnacks += 1;
        this.hype = Math.min(100, this.hype + 10);
        this.save();
    }

    updatePos(x: number, y: number) {
        this.pos = { x, y };
        // Don't save on every frame, rely on throttled save or exit save
    }

    // Throttled persistence
    save() {
        if (typeof window === "undefined") return;
        const data: VibePetData = {
            v: 1,
            lastSeenAt: Date.now(), // Update seen on save (interaction)
            pendingSnacks: this.pendingSnacks,
            mood: this.mood,
            pos: this.pos
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
}

// Singleton for easy access
export const vibeStore = new VibeStore();
