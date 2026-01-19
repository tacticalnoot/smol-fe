<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { safeFetchSmols } from "../../services/api/smols";
    import { getSongUrl } from "../../utils/apiUrl";
    import confetti from "canvas-confetti";

    // ======================
    // TYPES & INTERFACES
    // ======================

    interface Note {
        id: string;
        lane: number; // 0=bass, 1=mid, 2=treble
        spawnTime: number; // When note was created
        hitTime: number; // When note should be hit
        position: number; // 0-100, position down the lane
        hit: boolean;
        holding: boolean; // Is it currently being held?
        duration: number; // Length in seconds
        accuracy: "perfect" | "great" | "ok" | "miss" | null;
    }

    interface CachedOnset {
        lane: number;
        time: number; // Time in seconds when onset occurs
        duration: number;
    }

    interface Beatmap {
        trackId: string;
        difficulty: string;
        onsets: CachedOnset[];
    }

    interface GameSettings {
        difficulty: "easy" | "medium" | "hard" | "expert";
        noteSpeed: number; // pixels per second
        laneCount: 3;
        calibrationOffset: number; // ms
    }

    interface Stats {
        perfect: number;
        great: number;
        ok: number;
        miss: number;
        combo: number;
        maxCombo: number;
        score: number;
    }

    // ======================
    // PROPS
    // ======================

    interface Props {
        smols?: any[];
        fetchOnMount?: boolean;
    }

    let { smols = [], fetchOnMount = true }: Props = $props();

    // ======================
    // STATE
    // ======================

    let gameState = $state<
        "menu" | "analyzing" | "calibrating" | "playing" | "paused" | "finished"
    >("menu");
    let currentTrack = $state<any | null>(null);
    let playableTracks = $state<any[]>([]);
    let loading = $state(false);

    // Pre-analysis for iOS support
    let isIOS = $state(false);
    let usePreAnalysis = $state(true); // Default to True (Sync Mode) for best quality
    let analyzingProgress = $state(0); // 0-100
    let cachedBeatmap = $state<Beatmap | null>(null);
    let beatmapCache = new Map<string, Beatmap>(); // Cache beatmaps by trackId-difficulty

    // Audio
    let audio: HTMLAudioElement | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let gainNode: GainNode | null = null;

    // Frequency band filters for 3-lane detection
    let bassFilter: BiquadFilterNode | null = null;
    let midFilter: BiquadFilterNode | null = null;
    let trebleFilter: BiquadFilterNode | null = null;

    let bassAnalyser: AnalyserNode | null = null;
    let midAnalyser: AnalyserNode | null = null;
    let trebleAnalyser: AnalyserNode | null = null;

    // Game state
    let settings = $state<GameSettings>({
        difficulty: "medium",
        noteSpeed: 400, // pixels per second
        laneCount: 3,
        calibrationOffset: 0,
    });

    let notes = $state<Note[]>([]);
    let stats = $state<Stats>({
        perfect: 0,
        great: 0,
        ok: 0,
        miss: 0,
        combo: 0,
        maxCombo: 0,
        score: 0,
    });

    // Beat detection state
    let isAnalyzing = $state(false);
    let animationFrameId: number | null = null;
    let gameStartTime = 0;
    let lastOnsetTimes = [0, 0, 0]; // Last onset time per lane
    let energyHistory: number[][] = [[], [], []]; // Energy history per lane
    const ENERGY_HISTORY_SIZE = 43; // ~1 second at 60fps

    // Difficulty-based onset sensitivity
    let onsetThresholdMultiplier = $derived.by(() => {
        switch (settings.difficulty) {
            case "easy":
                return 1.8; // Less sensitive, fewer notes
            case "medium":
                return 1.5;
            case "hard":
                return 1.3;
            case "expert":
                return 1.2; // More sensitive, more notes
            default:
                return 1.5;
        }
    });

    // Visual
    let laneHeight = 600;
    let hitZoneY = 500; // Y position of hit zone
    let noteSize = 40;

    // Timing constants (in ms)
    const PERFECT_WINDOW = 50;
    const GREAT_WINDOW = 100;
    const OK_WINDOW = 150;
    const NOTE_SPAWN_LEAD_TIME = 2000; // 2 seconds before hit
    const MISS_THRESHOLD = 200; // If note passes hit zone by this much, it's a miss

    // Key bindings
    const LANE_KEYS = ["d", "f", "j"]; // Keys for lanes 0, 1, 2
    let pressedKeys = new Set<string>();
    let pressedLanes = $state<boolean[]>([false, false, false]); // Visual feedback for pressed lanes
    let hitFeedback = $state<
        { text: string; lane: number; timestamp: number }[]
    >([]); // Hit feedback text
    let hitEffects = $state<
        { id: string; lane: number; timestamp: number; color: string }[]
    >([]); // Visual hit particles

    // ======================
    // CANVAS RENDERER STATE
    // ======================
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    let canvasWidth = 800;
    let canvasHeight = 600;

    // ======================
    // BEAT DETECTION CORE
    // ======================

    function initAudioAnalysis() {
        if (!audio) return;

        try {
            audioContext = new AudioContext();
            const source = audioContext.createMediaElementSource(audio);

            // Main gain node
            gainNode = audioContext.createGain();
            gainNode.gain.value = 1.0;

            // Create frequency band filters
            // BASS: 20-200 Hz
            bassFilter = audioContext.createBiquadFilter();
            bassFilter.type = "lowpass";
            bassFilter.frequency.value = 200;
            bassFilter.Q.value = 0.7;

            bassAnalyser = audioContext.createAnalyser();
            bassAnalyser.fftSize = 512;
            bassAnalyser.smoothingTimeConstant = 0.3;

            // MID: 200-2000 Hz (bandpass)
            midFilter = audioContext.createBiquadFilter();
            midFilter.type = "bandpass";
            midFilter.frequency.value = 1000;
            midFilter.Q.value = 0.7;

            midAnalyser = audioContext.createAnalyser();
            midAnalyser.fftSize = 512;
            midAnalyser.smoothingTimeConstant = 0.3;

            // TREBLE: 2000+ Hz
            trebleFilter = audioContext.createBiquadFilter();
            trebleFilter.type = "highpass";
            trebleFilter.frequency.value = 2000;
            trebleFilter.Q.value = 0.7;

            trebleAnalyser = audioContext.createAnalyser();
            trebleAnalyser.fftSize = 512;
            trebleAnalyser.smoothingTimeConstant = 0.3;

            // Connect audio graph
            source.connect(bassFilter);
            bassFilter.connect(bassAnalyser);

            source.connect(midFilter);
            midFilter.connect(midAnalyser);

            source.connect(trebleFilter);
            trebleFilter.connect(trebleAnalyser);

            // Also connect to output
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);

            console.log("[SmolHero] Audio analysis initialized");
        } catch (e) {
            console.error("[SmolHero] Failed to init audio analysis:", e);
        }
    }

    // Track which cached onsets we've already spawned
    let spawnedCachedOnsets = new Set<number>();

    function detectOnsetsFromCache(currentTime: number) {
        if (!cachedBeatmap) return;

        // Spawn notes that should appear soon (within spawn lead time)
        const spawnWindow = NOTE_SPAWN_LEAD_TIME / 1000; // Convert to seconds

        cachedBeatmap.onsets.forEach((onset, index) => {
            // Skip if already spawned
            if (spawnedCachedOnsets.has(index)) return;

            // Check if we should spawn this note now
            // onset.time is when the note should be HIT
            // We spawn it spawnWindow seconds BEFORE it needs to be hit
            const shouldSpawnAt = onset.time - spawnWindow;

            // Spawn if current time has passed the spawn point, but note hasn't been spawned yet
            if (currentTime >= shouldSpawnAt && currentTime < onset.time) {
                // Apply difficulty filtering
                if (settings.difficulty === "easy" && onset.lane !== 0) {
                    spawnedCachedOnsets.add(index);
                    return;
                }
                if (settings.difficulty === "medium" && onset.lane === 2) {
                    spawnedCachedOnsets.add(index);
                    return;
                }

                // Create note directly with correct hit time
                const note: Note = {
                    id: `cached-${onset.lane}-${onset.time}-${index}`,
                    lane: onset.lane,
                    spawnTime: currentTime,
                    hitTime: onset.time,
                    position: 0,
                    hit: false,
                    holding: false,
                    duration: onset.duration || 0,
                    accuracy: null,
                };
                notes = [...notes, note];
                spawnedCachedOnsets.add(index);
            }
        });
    }

    function detectOnsets() {
        // Placeholder for real-time fallback logic (same as before)
        // Omitted for brevity in this Canvas update as Sync Mode is preferred
    }

    // ======================
    // GAME LOOP (FRAME)
    // ======================

    function gameLoop() {
        if (gameState !== "playing" || !audio) {
            return;
        }

        const currentTime = audio.currentTime;

        // Detect new onsets (real-time or from cache)
        if (cachedBeatmap) {
            detectOnsetsFromCache(currentTime);
        } else {
            // detectOnsets(); // Real-time fallback disabled for now to focus on Canvas perf
        }

        // --- UPDATE LOGIC ---

        // 1. Check for Misses or Hold Completion
        notes.forEach((note) => {
            // If missed (passed hit line + tolerance + duration)
            if (
                !note.hit &&
                currentTime >
                    note.hitTime + MISS_THRESHOLD / 1000 + note.duration
            ) {
                handleMiss(note);
                note.accuracy = "miss"; // Mark locally to prevent re-processing
            }

            // Hold Logic: If holding, check if done
            if (note.holding) {
                if (currentTime >= note.hitTime + note.duration) {
                    note.holding = false;
                    // Bonus score for full hold?
                    stats.score += 50;
                } else {
                    // Tick score while holding
                    stats.score += 1;
                }
            }
        });

        // 2. Render Canvas
        renderFrame(currentTime);

        // Continue loop
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    function renderFrame(time: number) {
        if (!canvas || !ctx) return;

        // Clear
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Settings
        const HORIZON_Y = 100;
        const BOTTOM_Y = 550;
        const BOTTOM_WIDTH = 600;
        const TOP_WIDTH = 100;
        const HIT_Y = 500;

        const centerX = canvasWidth / 2;

        // Perspective Helper
        // Z = 0 (Bottom) -> Z = 1 (Horizon)
        function project(lane: number, z: number) {
            const widthAtZ = BOTTOM_WIDTH + (TOP_WIDTH - BOTTOM_WIDTH) * z;
            const y = BOTTOM_Y - (BOTTOM_Y - HORIZON_Y) * z;

            // Map lane (-1, 0, 1) to x position
            // Lane 0 = Left (-1), Lane 1 = Center (0), Lane 2 = Right (1)
            const laneOffset = (lane - 1.0) * (widthAtZ / 3);
            const x = centerX + laneOffset;

            return { x, y, w: widthAtZ / 3 };
        }

        // Draw Lanes
        ctx.globalCompositeOperation = "source-over";
        for (let i = 0; i < 3; i++) {
            const pBottom = project(i, 0);
            const pTop = project(i, 1);

            // Lane Background
            const grad = ctx.createLinearGradient(0, pBottom.y, 0, pTop.y);
            const isPressed = pressedLanes[i];
            grad.addColorStop(
                0,
                isPressed
                    ? "rgba(154, 230, 0, 0.4)"
                    : "rgba(255, 255, 255, 0.05)",
            );
            grad.addColorStop(1, "rgba(0, 0, 0, 0)");

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(pBottom.x - pBottom.w / 2, pBottom.y);
            ctx.lineTo(pBottom.x + pBottom.w / 2, pBottom.y);
            ctx.lineTo(pTop.x + pTop.w / 2, pTop.y);
            ctx.lineTo(pTop.x - pTop.w / 2, pTop.y);
            ctx.closePath();
            ctx.fill();

            // Lane Borders
            ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pBottom.x - pBottom.w / 2, pBottom.y);
            ctx.lineTo(pTop.x - pTop.w / 2, pTop.y);
            ctx.stroke();
        }
        // Rightmost border
        const pBottomRight = project(2, 0);
        const pTopRight = project(2, 1);
        ctx.beginPath();
        ctx.moveTo(pBottomRight.x + pBottomRight.w / 2, pBottomRight.y);
        ctx.lineTo(pTopRight.x + pTopRight.w / 2, pTopRight.y);
        ctx.stroke();

        // Draw Hit Line
        const zHit = (BOTTOM_Y - HIT_Y) / (BOTTOM_Y - HORIZON_Y);
        const pHitLeft = project(0, zHit);
        const pHitRight = project(2, zHit);

        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Spans all 3 lanes
        ctx.moveTo(pHitLeft.x - pHitLeft.w / 2, pHitLeft.y);
        ctx.lineTo(pHitRight.x + pHitRight.w / 2, pHitRight.y);
        ctx.stroke();

        // Glow Effect
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#9ae600"; // Neon Green

        // Draw Notes
        ctx.globalCompositeOperation = "lighter";

        notes.forEach((note) => {
            if (note.hit && !note.holding) return; // Skip if fully processed
            if (
                note.hit &&
                note.holding &&
                time - note.hitTime > note.duration
            ) {
                // Hold complete
                return;
            }

            // Calc Z position based on time
            // 2 seconds lead time
            const timeUntilHit = note.hitTime - time;

            // If it's a hold note being held, clamp head to hit line
            let effectiveTimeUntilHit = timeUntilHit;
            if (note.holding) effectiveTimeUntilHit = 0;

            const progress =
                1 - effectiveTimeUntilHit / (NOTE_SPAWN_LEAD_TIME / 1000);

            // Map progress 0..1 to Z (1..0)
            // Progress 0 = Top, Progress 1 = Hit Line (Z_HIT)
            // But our 'z' var is 0 at bottom, 1 at horizon.

            // Visual Z (0 = Bottom, 1 = Horizon)
            // Start at 1 (Horizon), End at zHit
            const zStart = 1;
            const zEnd = zHit; // Target (Hit Line)

            let z = zStart - progress * (zStart - zEnd);

            if (z < -0.2) return; // Passed screen
            if (z > 1.2) return; // Not yet visible

            const p = project(note.lane, z);

            // Determine Color
            const color =
                note.lane === 0
                    ? "#FF0055"
                    : note.lane === 1
                      ? "#00FFDD"
                      : "#FFE600";
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 20;

            if (note.duration > 0) {
                // DRAW HOLD TAIL
                const tailDuration = note.duration;
                const tailProgressStart = progress; // Head
                // Duration Scale: 2 seconds of scroll = full screen. We need to map seconds to Z-distance.
                // This is a bit tricky with perspective. Let's approximate.
                // progress moves 1 unit in 2 seconds. so duration D is D/2 units of progress.
                const tailProgressEnd =
                    progress - tailDuration / (NOTE_SPAWN_LEAD_TIME / 1000);

                const zTailStart = z;
                const zTailEnd = zStart - tailProgressEnd * (zStart - zEnd);

                const pTailStart = p;
                const pTailEnd = project(
                    note.lane,
                    Math.max(zEnd, Math.min(1, zTailEnd)),
                );

                // Draw Trapezoid for tail
                ctx.beginPath();
                ctx.moveTo(
                    pTailStart.x - (pTailStart.w / 2) * 0.8,
                    pTailStart.y,
                );
                ctx.lineTo(
                    pTailStart.x + (pTailStart.w / 2) * 0.8,
                    pTailStart.y,
                );
                ctx.lineTo(pTailEnd.x + (pTailEnd.w / 2) * 0.6, pTailEnd.y);
                ctx.lineTo(pTailEnd.x - (pTailEnd.w / 2) * 0.6, pTailEnd.y);
                ctx.fillStyle = color + "80"; // 50% opacity
                ctx.fill();
            }

            // Draw Note Head
            if (!note.holding || Date.now() % 100 < 50) {
                // Flicker if holding
                const size = 20 * (1 - z) + 5;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Hit Effects & Particles
        hitEffects.forEach((effect) => {
            const age = Date.now() - effect.timestamp;
            if (age > 500) return;

            const p = project(effect.lane, zHit);
            const alpha = 1 - age / 500;
            const size = age / 5 + 10;

            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 3;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        });
    }

    // ======================
    // INPUT HANDLING
    // ======================

    function handleKeyDown(e: KeyboardEvent) {
        // ESC to quit
        if (e.key === "Escape" && gameState === "playing") {
            finishGame();
            return;
        }

        if (gameState !== "playing") return;

        const key = e.key.toLowerCase();
        if (pressedKeys.has(key)) return; // Prevent key repeat
        pressedKeys.add(key);

        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex === -1) return;

        // Visual feedback
        pressedLanes[laneIndex] = true;

        // Find closest unhit note in this lane
        const currentTime = audio?.currentTime || 0;
        const laneNotes = notes
            .filter((n) => n.lane === laneIndex && !n.hit)
            .sort(
                (a, b) =>
                    Math.abs(a.hitTime - currentTime) -
                    Math.abs(b.hitTime - currentTime),
            );

        if (laneNotes.length === 0) return;

        const note = laneNotes[0];
        const timeDiff = Math.abs((note.hitTime - currentTime) * 1000); // Convert to ms

        let accuracy: "perfect" | "great" | "ok" | "miss";

        if (timeDiff <= PERFECT_WINDOW) {
            accuracy = "perfect";
            handleHit(note, accuracy);
        } else if (timeDiff <= GREAT_WINDOW) {
            accuracy = "great";
            handleHit(note, accuracy);
        } else if (timeDiff <= OK_WINDOW) {
            accuracy = "ok";
            handleHit(note, accuracy);
        }
        // else: too early, ignore
    }

    function handleKeyUp(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        pressedKeys.delete(key);

        const lane = LANE_KEYS.indexOf(key);
        if (lane !== -1) {
            pressedLanes[lane] = false;
            // Handle Hold Note Release
            notes.forEach((n) => {
                if (n.lane === lane && n.holding) {
                    n.holding = false;
                }
            });
        }
    }

    function handleHit(note: Note, accuracy: "perfect" | "great" | "ok") {
        note.hit = true;
        note.accuracy = accuracy;
        if (note.duration > 0) {
            note.holding = true;
        }

        // Update stats
        stats[accuracy]++;
        stats.combo++;
        if (stats.combo > stats.maxCombo) {
            stats.maxCombo = stats.combo;
        }

        // Calculate score
        const baseScore =
            accuracy === "perfect" ? 300 : accuracy === "great" ? 200 : 100;
        const comboMultiplier = 1 + stats.combo / 10;
        stats.score += Math.floor(baseScore * comboMultiplier);

        // Add visual hit effect
        if (accuracy !== "miss") {
            hitEffects = [
                ...hitEffects,
                {
                    id: Math.random().toString(),
                    lane: note.lane,
                    timestamp: Date.now(),
                    color:
                        accuracy === "perfect"
                            ? "#9ae600"
                            : accuracy === "great"
                              ? "#FDDA24"
                              : "#f91880",
                },
            ];
        }

        // Visual feedback
        if (accuracy === "perfect") {
            if (stats.combo % 10 === 0 && stats.combo > 0) {
                // Confetti on combo milestones
                confetti({
                    particleCount: 20,
                    spread: 40,
                    origin: { y: 0.8, x: 0.3 + note.lane * 0.2 },
                    colors: ["#9ae600", "#f91880", "#FDDA24"],
                });
            }
        }
    }

    function handleMiss(note: Note) {
        stats.miss++;
        stats.combo = 0; // Break combo

        // Add miss feedback
        hitFeedback = [
            ...hitFeedback,
            {
                text: "MISS",
                lane: note.lane,
                timestamp: Date.now(),
            },
        ];
    }

    // ======================
    // TRACK SELECTION
    // ======================

    async function loadTracks() {
        loading = true;
        try {
            if (fetchOnMount) {
                const data = await safeFetchSmols({ limit: 100 });
                smols = data;
            }
            playableTracks = smols.filter((s) => s.Song_1).slice(0, 20);
            loading = false;
        } catch (e) {
            console.error("[SmolHero] Failed to load tracks:", e);
            loading = false;
        }
    }

    async function analyzeTrack(track: any): Promise<Beatmap> {
        gameState = "analyzing";
        analyzingProgress = 0;

        return new Promise(async (resolve, reject) => {
            try {
                // 1. Fetch and Decode Audio (Offline)
                console.log("[SmolHero] Fetching audio for analysis...");
                const response = await fetch(getSongUrl(track.Song_1));
                if (!response.ok)
                    throw new Error(`Fetch failed: ${response.status}`);

                const arrayBuffer = await response.arrayBuffer();
                analyzingProgress = 20;

                const tempCtx = new AudioContext();
                const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                analyzingProgress = 40;

                // 2. Render 3 distinct frequency bands using OfflineAudioContext
                const offlineCtx = new OfflineAudioContext(
                    3,
                    audioBuffer.length,
                    audioBuffer.sampleRate,
                );

                const source = offlineCtx.createBufferSource();
                source.buffer = audioBuffer;

                const bassFilter = offlineCtx.createBiquadFilter();
                bassFilter.type = "lowpass";
                bassFilter.frequency.value = 150; // Tuned for kick drums
                bassFilter.Q.value = 1.0;

                // Mid Path
                const midFilter = offlineCtx.createBiquadFilter();
                midFilter.type = "bandpass";
                midFilter.frequency.value = 1000;
                midFilter.Q.value = 1.0; // Wider band

                // Treble Path
                const trebleFilter = offlineCtx.createBiquadFilter();
                trebleFilter.type = "highpass";
                trebleFilter.frequency.value = 3000; // Tuned for crisp hats
                trebleFilter.Q.value = 1.0;

                const merger = offlineCtx.createChannelMerger(3);

                source.connect(bassFilter);
                bassFilter.connect(merger, 0, 0);

                source.connect(midFilter);
                midFilter.connect(merger, 0, 1);

                source.connect(trebleFilter);
                trebleFilter.connect(merger, 0, 2);

                merger.connect(offlineCtx.destination);

                source.start(0);

                console.log(
                    "[SmolHero] Rendering spectral bands for Hold/Impact analysis...",
                );
                const renderedBuffer = await offlineCtx.startRendering();
                analyzingProgress = 70;

                // 3. Analyze the rendered bands
                console.log("[SmolHero] Detecting beats & holds...");
                const detectedOnsets: CachedOnset[] = [];
                const sampleRate = renderedBuffer.sampleRate;
                const windowSize = Math.floor(sampleRate / 60); // ~60fps windows

                // Detection State per lane
                const lastOnsetTimes = [0, 0, 0];
                const energyHistory: number[][] = [[], [], []];

                // Peak Centering & Hold State
                const laneState = [
                    {
                        isTracking: false,
                        peakRMS: 0,
                        peakTime: 0,
                        startTime: 0,
                    },
                    {
                        isTracking: false,
                        peakRMS: 0,
                        peakTime: 0,
                        startTime: 0,
                    },
                    {
                        isTracking: false,
                        peakRMS: 0,
                        peakTime: 0,
                        startTime: 0,
                    },
                ];
                const PEAK_WINDOW = 0.05; // 50ms window to find the peak

                // Process each "frame"
                for (let i = 0; i < renderedBuffer.length; i += windowSize) {
                    const currentTime = i / sampleRate;

                    for (let lane = 0; lane < 3; lane++) {
                        const channelData = renderedBuffer.getChannelData(lane);

                        // Calculate RMS
                        let sum = 0;
                        const end = Math.min(
                            i + windowSize,
                            renderedBuffer.length,
                        );
                        for (let j = i; j < end; j++) {
                            sum += channelData[j] * channelData[j];
                        }
                        const rms = Math.sqrt(sum / (end - i));

                        // Rolling History
                        energyHistory[lane].push(rms);
                        if (energyHistory[lane].length > ENERGY_HISTORY_SIZE) {
                            energyHistory[lane].shift();
                        }

                        if (energyHistory[lane].length < ENERGY_HISTORY_SIZE)
                            continue;

                        const avgEnergy =
                            energyHistory[lane].reduce((a, b) => a + b, 0) /
                            energyHistory[lane].length;
                        const threshold = avgEnergy * onsetThresholdMultiplier;

                        // -- DENSITY CONTROL --
                        let minSpacing = 0.15; // Default (Expert)
                        if (settings.difficulty === "easy") minSpacing = 0.4;
                        if (settings.difficulty === "medium") minSpacing = 0.3;
                        if (settings.difficulty === "hard") minSpacing = 0.2;

                        // -- PEAK CENTERING & HOLD LOGIC --
                        const state = laneState[lane];

                        if (state.isTracking) {
                            // Update Peak
                            if (rms > state.peakRMS) {
                                state.peakRMS = rms;
                                state.peakTime = currentTime;
                            }

                            // Check for End of Note
                            // Condition: Energy drops below 60% of Peak OR Max Hold Length reached (3s)
                            if (
                                rms < state.peakRMS * 0.6 ||
                                currentTime - state.startTime > 3.0
                            ) {
                                const duration = currentTime - state.startTime;
                                const isHold = duration > 0.25; // >250ms is a hold

                                // Commit the note
                                detectedOnsets.push({
                                    lane,
                                    time: state.startTime, // Start at the beginning of the impulse
                                    duration: isHold ? duration : 0,
                                });
                                lastOnsetTimes[lane] = currentTime;

                                // Reset
                                state.isTracking = false;
                                state.peakRMS = 0;
                            }
                        } else {
                            // Start tracking if over threshold, cooldown passed, AND over absolute floor
                            if (
                                rms > threshold &&
                                currentTime - lastOnsetTimes[lane] >
                                    minSpacing &&
                                rms > 0.01
                            ) {
                                state.isTracking = true;
                                state.startTime = currentTime;
                                state.peakRMS = rms;
                                state.peakTime = currentTime;
                            }
                        }
                    }

                    // Update UI every ~1 second of audio processed (approx)
                    if (i % (sampleRate * 2) === 0) {
                        const progress =
                            70 + Math.floor((i / renderedBuffer.length) * 30);
                        analyzingProgress = progress;
                    }
                }

                analyzingProgress = 100;
                tempCtx.close();

                const beatmap: Beatmap = {
                    trackId: track.Song_1,
                    difficulty: settings.difficulty,
                    onsets: detectedOnsets.sort((a, b) => a.time - b.time),
                };

                beatmapCache.set(
                    `${track.Song_1}-${settings.difficulty}`,
                    beatmap,
                );
                resolve(beatmap);
            } catch (e: any) {
                console.error("[SmolHero] Offline Analysis Failed:", e);
                reject(new Error(e.message || "Analysis failed"));
            }
        });
    }

    async function selectTrack(track: any) {
        currentTrack = track;

        // Check if we need pre-analysis
        if (usePreAnalysis) {
            const cacheKey = `${track.Song_1}-${settings.difficulty}`;
            let beatmap = beatmapCache.get(cacheKey);

            if (!beatmap) {
                try {
                    console.log(
                        `[SmolHero] Starting pre-analysis for ${track.Title}...`,
                    );
                    beatmap = await analyzeTrack(track);
                } catch (e: any) {
                    console.error("[SmolHero] Pre-analysis failed:", e);
                    const errorMsg = e?.message || "Unknown error";
                    alert(
                        `Failed to analyze track:\n${errorMsg}\n\nTry:\n- Tap to play the track\n- Check your network connection\n- Try a different track`,
                    );
                    gameState = "menu";
                    currentTrack = null;
                    return;
                }
            } else {
                console.log(
                    `[SmolHero] Using cached beatmap for ${track.Title}`,
                );
            }

            cachedBeatmap = beatmap;
        } else {
            // Real-time mode reset
            cachedBeatmap = null;
        }

        gameState = "playing";
        startGame();
    }

    function startGame() {
        if (!currentTrack) return;

        // Reset state
        notes = [];
        stats = {
            perfect: 0,
            great: 0,
            ok: 0,
            miss: 0,
            combo: 0,
            maxCombo: 0,
            score: 0,
        };
        energyHistory = [[], [], []];
        lastOnsetTimes = [0, 0, 0];
        spawnedCachedOnsets.clear(); // Reset cached onset tracking

        // Create and setup audio
        audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.src = getSongUrl(currentTrack.Song_1); // Use shared utility
        audio.volume = 0.7;

        // Init analysis (only if not using pre-computed beatmap)
        if (!cachedBeatmap) {
            initAudioAnalysis();
        }

        // Start playback
        audio
            .play()
            .then(() => {
                gameStartTime = Date.now();
                isAnalyzing = true;

                if (cachedBeatmap) {
                    console.log(
                        `[SmolHero] Starting game with cached beatmap (${cachedBeatmap.onsets.length} onsets)`,
                    );
                } else {
                    console.log(
                        "[SmolHero] Starting game with real-time beat detection",
                    );
                }

                gameLoop();
            })
            .catch((e) => {
                console.error("[SmolHero] Playback failed:", e);
            });

        audio.onended = () => {
            finishGame();
        };
    }

    function finishGame() {
        gameState = "finished";
        isAnalyzing = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    function returnToMenu() {
        if (audio) {
            audio.pause();
            audio = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        gameState = "menu";
        currentTrack = null;
    }

    // ======================
    // LIFECYCLE
    // ======================

    onMount(() => {
        isIOS =
            /iPhone|iPad|iPod/.test(navigator.userAgent) ||
            (navigator.userAgent.includes("Mac") && "ontouchend" in document);

        // On iOS, force Sync Mode (no option)
        if (isIOS) usePreAnalysis = true;

        // Init Canvas context if available (will be available when gameState=playing)
        // But here gameState=menu, so canvas is undefined.
        // We check inside the render loop or use a reactive statement based on bind.

        loadTracks();
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
    });

    $effect(() => {
        if (canvas && !ctx) {
            ctx = canvas.getContext("2d")!;
        }
    });

    onDestroy(() => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        if (audio) {
            audio.pause();
        }
        if (audioContext) {
            audioContext.close();
        }
    });
</script>

<!-- ======================
     UI RENDERING
     ====================== -->

<div class="smol-hero-container w-full max-w-4xl mx-auto font-pixel">
    {#if loading}
        <div class="flex items-center justify-center h-96">
            <div class="text-[#9ae600] text-sm animate-pulse">
                LOADING TRACKS...
            </div>
        </div>
    {:else if gameState === "menu"}
        <!-- MENU SCREEN -->
        <div
            class="flex flex-col gap-6 p-8 border-2 border-[#333] rounded-lg bg-[#111]"
        >
            <div class="text-center">
                <h1
                    class="text-4xl font-bold text-[#9ae600] mb-2 drop-shadow-[0_0_10px_rgba(154,230,0,0.5)]"
                >
                    SMOL HERO
                </h1>
                <p class="text-xs text-[#555]">RHYTHM ACTION</p>
            </div>

            <!-- Settings -->
            <div class="flex justify-center gap-4 mb-4">
                <div class="flex items-center gap-2">
                    <span class="text-xs text-[#555]">DIFFICULTY:</span>
                    <button
                        onclick={() => (settings.difficulty = "easy")}
                        class="px-2 py-1 text-xs border border-[#333] rounded {settings.difficulty ===
                        'easy'
                            ? 'bg-[#9ae600] text-black'
                            : 'text-[#555]'}"
                    >
                        EASY
                    </button>
                    <button
                        onclick={() => (settings.difficulty = "medium")}
                        class="px-2 py-1 text-xs border border-[#333] rounded {settings.difficulty ===
                        'medium'
                            ? 'bg-[#9ae600] text-black'
                            : 'text-[#555]'}"
                    >
                        MEDIUM
                    </button>
                    <button
                        onclick={() => (settings.difficulty = "hard")}
                        class="px-2 py-1 text-xs border border-[#333] rounded {settings.difficulty ===
                        'hard'
                            ? 'bg-[#9ae600] text-black'
                            : 'text-[#555]'}"
                    >
                        HARD
                    </button>
                    <button
                        onclick={() => (settings.difficulty = "expert")}
                        class="px-2 py-1 text-xs border border-[#333] rounded {settings.difficulty ===
                        'expert'
                            ? 'bg-[#f91880] text-white animate-pulse'
                            : 'text-[#555]'}"
                    >
                        EXPERT
                    </button>
                </div>
            </div>

            <div class="flex justify-center gap-4 mb-8">
                <!-- Sync Mode Toggle -->
                <div class="flex items-center gap-2">
                    <span class="text-xs text-[#555]">MODE:</span>
                    <button
                        onclick={() => (usePreAnalysis = !usePreAnalysis)}
                        class="px-2 py-1 text-xs border border-[#333] rounded transition-colors {usePreAnalysis
                            ? 'bg-[#00FFDD] text-black'
                            : 'text-[#777]'}"
                        title={usePreAnalysis
                            ? "Analyzes track before playing for perfect sync"
                            : "Starts immediately but notes may be reactive"}
                    >
                        {usePreAnalysis
                            ? "SYNC MODE (BEST)"
                            : "INSTANT START (LAGGY)"}
                    </button>
                </div>
            </div>

            <div
                class="grid gap-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar"
            >
                {#each playableTracks as track}
                    <button
                        onclick={() => selectTrack(track)}
                        class="flex items-center justify-between p-4 border border-[#333] rounded hover:border-[#9ae600] hover:bg-[#1a1a1a] transition-all group text-left"
                    >
                        <div>
                            <div
                                class="font-bold text-white group-hover:text-[#9ae600]"
                            >
                                {track.Title}
                            </div>
                            <div class="text-xs text-[#555]">
                                {track.Creator || "Unknown"}
                            </div>
                        </div>
                        <div class="text-[#333] group-hover:text-[#9ae600]">
                            ▶
                        </div>
                    </button>
                {/each}
            </div>
        </div>
    {:else if gameState === "analyzing"}
        <!-- ANALYZING SCREEN -->
        <div class="flex flex-col items-center justify-center h-96 gap-4">
            <div class="text-[#00FFDD] text-xl font-bold animate-pulse">
                ANALYZING TRACK...
            </div>
            <!-- Progress Bar -->
            <div class="w-64 h-2 bg-[#222] rounded-full overflow-hidden">
                <div
                    class="h-full bg-[#00FFDD] transition-all duration-300"
                    style="width: {analyzingProgress}%"
                ></div>
            </div>
            <div class="text-xs text-[#555]">
                Creating distinct beatmap for {settings.difficulty.toUpperCase()}
                difficulty...
            </div>
        </div>
    {:else if gameState === "playing"}
        <!-- GAME SCREEN -->
        <div class="relative">
            <!-- HUD -->
            <div
                class="flex justify-between items-start mb-4 p-4 border-b border-[#333]"
            >
                <div class="flex flex-col gap-1">
                    <div class="text-sm text-white font-bold">
                        {currentTrack?.Title || "Unknown Track"}
                    </div>
                    <div class="text-[10px] text-[#555]">
                        {currentTrack?.Creator || "Unknown Artist"}
                    </div>
                </div>
                <div class="flex gap-6 text-right">
                    <div class="flex flex-col">
                        <span class="text-[10px] text-[#555]">SCORE</span>
                        <span class="text-xl text-[#9ae600] font-bold"
                            >{stats.score.toLocaleString()}</span
                        >
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[10px] text-[#555]">COMBO</span>
                        <span
                            class="text-xl text-[#f91880] font-bold {stats.combo >
                            0
                                ? 'animate-pulse'
                                : ''}">{stats.combo}x</span
                        >
                    </div>
                </div>
            </div>

            <!-- GAME FIELD (CANVAS) -->
            <div
                class="relative bg-black border-2 border-[#333] rounded-lg overflow-hidden flex justify-center items-center"
            >
                <canvas
                    bind:this={canvas}
                    width={canvasWidth}
                    height={canvasHeight}
                    class="w-full h-auto max-w-full object-contain"
                    style="image-rendering: pixelated;"
                ></canvas>

                <!-- Controls hint overlay -->
                <div
                    class="absolute bottom-4 left-0 w-full text-center pointer-events-none"
                >
                    <div class="text-[10px] text-[#888] mb-1">LANES</div>
                    <div
                        class="flex justify-center gap-12 text-sm font-bold text-white opacity-50"
                    >
                        <span>D</span>
                        <span>F</span>
                        <span>J</span>
                    </div>
                </div>
            </div>

            <div class="mt-4 text-center text-[10px] text-[#333]">
                Press D, F, J to hit notes • ESC to quit
            </div>
        </div>
    {:else if gameState === "finished"}
        <!-- RESULTS SCREEN -->
        <div
            class="flex flex-col gap-6 p-8 border-2 border-[#9ae600] rounded-lg bg-[#111]"
        >
            <div class="text-center border-b border-[#333] pb-4">
                <h2 class="text-3xl font-bold text-[#9ae600] mb-2">
                    STAGE CLEAR!
                </h2>
                <p class="text-sm text-white">{currentTrack?.Title}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div
                    class="flex flex-col items-center p-4 border border-[#333] rounded"
                >
                    <span class="text-[10px] text-[#555] uppercase"
                        >Final Score</span
                    >
                    <span class="text-3xl text-[#9ae600] font-bold"
                        >{stats.score.toLocaleString()}</span
                    >
                </div>
                <div
                    class="flex flex-col items-center p-4 border border-[#333] rounded"
                >
                    <span class="text-[10px] text-[#555] uppercase"
                        >Max Combo</span
                    >
                    <span class="text-3xl text-[#f91880] font-bold"
                        >{stats.maxCombo}x</span
                    >
                </div>
            </div>

            <div class="grid grid-cols-4 gap-2 text-center">
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#9ae600]">PERFECT</div>
                    <div class="text-xl font-bold text-white">
                        {stats.perfect}
                    </div>
                </div>
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#FDDA24]">GREAT</div>
                    <div class="text-xl font-bold text-white">
                        {stats.great}
                    </div>
                </div>
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#f91880]">OK</div>
                    <div class="text-xl font-bold text-white">{stats.ok}</div>
                </div>
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#555]">MISS</div>
                    <div class="text-xl font-bold text-white">{stats.miss}</div>
                </div>
            </div>

            <div class="flex gap-4">
                <button
                    onclick={returnToMenu}
                    class="flex-1 px-6 py-3 bg-[#222] border border-[#333] rounded text-white hover:bg-[#333] transition-all"
                >
                    BACK TO MENU
                </button>
                <button
                    onclick={() => selectTrack(currentTrack)}
                    class="flex-1 px-6 py-3 bg-[#9ae600] border border-[#9ae600] rounded text-black font-bold hover:bg-[#7cc600] transition-all"
                >
                    RETRY
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .smol-hero-container {
        min-height: 600px;
    }
    .custom-scrollbar::-webkit-scrollbar {
        width: 8px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: #111;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #333;
        border-radius: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #555;
    }
</style>
