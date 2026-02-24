<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { safeFetchSmols, fetchLikedSmols } from "../../services/api/smols";
    import { getSongUrl } from "../../utils/apiUrl";
    import confetti from "canvas-confetti";
    import LikeButton from "../../components/ui/LikeButton.svelte";

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
        accuracy: "perfect" | "great" | "ok" | "miss" | null;
        duration?: number;
    }

    interface CachedOnset {
        lane: number;
        time: number; // Time in seconds when onset occurs
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
    let playableTracks = $state<any[]>([]); // The currently displayed/filtered list
    let allTracks = $state<any[]>([]); // All tracks in memory
    let likedTrackIds = $state<Set<string>>(new Set());
    let loading = $state(false);

    // Filters & Sorts
    let searchQuery = $state("");
    let filterLikedOnly = $state(false);
    let sortMode = $state<"latest" | "artist" | "liked">("latest");
    let visibleLimit = $state(50);
    let filteredTracksCount = $state(0);

    // Pre-analysis for iOS support
    let isIOS = $state(false);
    let usePreAnalysis = $state(true); // Default to True (Sync Mode) for best quality
    let analyzingProgress = $state(0); // 0-100
    let cachedBeatmap = $state<Beatmap | null>(null);
    let beatmapCache = new Map<string, Beatmap>(); // Cache beatmaps by trackId-difficulty
    const BEATMAP_CACHE_MAX_SIZE = 20; // Limit cache to prevent unbounded memory growth

    // Audio
    let audio: HTMLAudioElement | null = null;
    let audioContext: AudioContext | any = null; // Use any to allow webkitAudioContext
    let analyser: AnalyserNode | null = null;
    let gainNode: GainNode | null = null;
    let cachedDecodedBuffer: AudioBuffer | null = null; // Cache for pause menu

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
    const difficultyOptions: GameSettings["difficulty"][] = [
        "easy",
        "medium",
        "hard",
        "expert",
    ];

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
                return 2.5; // Stricter
            case "medium":
                return 2.0;
            case "hard":
                return 1.6;
            case "expert":
                return 1.3;
            default:
                return 2.0;
        }
    });

    // Visual (responsive)
    let laneHeight = $state(600);
    let hitZoneY = $state(450); // Y position of hit zone — notes arrive HERE at hitTime
    let noteSize = $state(42);

    function updateDimensions() {
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const mobile = vw < 768;

        if (mobile) {
            // On mobile, fit the game field within the viewport
            // Account for HUD (~80px), controls (~40px), page chrome (~120px)
            const availableHeight = vh - 240;
            laneHeight = Math.max(320, Math.min(availableHeight, 480));
            hitZoneY = Math.floor(laneHeight * 0.72); // Higher up for mobile
            noteSize = 36;
        } else {
            laneHeight = 600;
            hitZoneY = Math.floor(laneHeight * 0.75); // 75% down
            noteSize = 42;
        }
    }

    // Timing constants (in ms)
    const PERFECT_WINDOW = 50;
    const GREAT_WINDOW = 100;
    const OK_WINDOW = 150;
    const NOTE_SPAWN_LEAD_TIME = 2000; // 2 seconds before hit
    const MISS_THRESHOLD = 200; // If note passes hit zone by this much, it's a miss

    // Key bindings
    const LANE_KEYS = ["d", "f", "j"]; // Keys for lanes 0, 1, 2
    const LANE_COLORS = [
        { hex: "#9ae600", rgb: "154, 230, 0" }, // Green
        { hex: "#b026ff", rgb: "176, 38, 255" }, // Purple
        { hex: "#ff7700", rgb: "255, 119, 0" }, // Orange
    ];
    let pressedKeys = new Set<string>();
    let pressedLanes = $state<boolean[]>([false, false, false]); // Visual feedback for pressed lanes
    let hitFeedback = $state<
        { text: string; lane: number; timestamp: number }[]
    >([]); // Hit feedback text
    let hitEffects = $state<
        { id: string; lane: number; timestamp: number; color: string }[]
    >([]); // Visual hit particles

    // ======================
    // BEAT DETECTION CORE
    // ======================

    function initAudioAnalysis() {
        if (!audio) return;

        try {
            const Ctx =
                window.AudioContext || (window as any).webkitAudioContext;
            audioContext = new Ctx();
            const source = audioContext.createMediaElementSource(audio);

            // Main gain node
            const gain = audioContext.createGain();
            gain.gain.value = 1.0;
            gainNode = gain;

            // Create frequency band filters
            // BASS: 20-200 Hz
            const bass = audioContext.createBiquadFilter();
            bass.type = "lowpass";
            bass.frequency.value = 200;
            bass.Q.value = 0.7;
            bassFilter = bass;

            const bassAnalyzer = audioContext.createAnalyser();
            bassAnalyzer.fftSize = 512;
            bassAnalyzer.smoothingTimeConstant = 0.3;
            bassAnalyser = bassAnalyzer;

            // MID: 200-2000 Hz (bandpass)
            const mid = audioContext.createBiquadFilter();
            mid.type = "bandpass";
            mid.frequency.value = 1000;
            mid.Q.value = 0.7;
            midFilter = mid;

            const midAnalyzer = audioContext.createAnalyser();
            midAnalyzer.fftSize = 512;
            midAnalyzer.smoothingTimeConstant = 0.3;
            midAnalyser = midAnalyzer;

            // TREBLE: 2000+ Hz
            const treble = audioContext.createBiquadFilter();
            treble.type = "highpass";
            treble.frequency.value = 2000;
            treble.Q.value = 0.7;
            trebleFilter = treble;

            const trebleAnalyzer = audioContext.createAnalyser();
            trebleAnalyzer.fftSize = 512;
            trebleAnalyzer.smoothingTimeConstant = 0.3;
            trebleAnalyser = trebleAnalyzer;

            // Connect audio graph
            source.connect(bass);
            bass.connect(bassAnalyzer);

            source.connect(mid);
            mid.connect(midAnalyzer);

            source.connect(treble);
            treble.connect(trebleAnalyzer);

            // Also connect to output
            source.connect(gain);
            gain.connect(audioContext.destination);

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
                    accuracy: null,
                };
                notes = [...notes, note];
                spawnedCachedOnsets.add(index);
            }
        });
    }

    function detectOnsets() {
        if (!bassAnalyser || !midAnalyser || !trebleAnalyser) return;

        const analysers = [bassAnalyser, midAnalyser, trebleAnalyser];
        const currentTime = audio?.currentTime || 0;

        analysers.forEach((analyser, lane) => {
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);

            // Calculate RMS energy
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / bufferLength);

            // Add to history
            energyHistory[lane].push(rms);
            if (energyHistory[lane].length > ENERGY_HISTORY_SIZE) {
                energyHistory[lane].shift();
            }

            // Need enough history for detection
            if (energyHistory[lane].length < ENERGY_HISTORY_SIZE) return;

            // Calculate average energy
            const avgEnergy =
                energyHistory[lane].reduce((a, b) => a + b, 0) /
                energyHistory[lane].length;

            // Detect onset: current energy significantly above average
            const threshold = avgEnergy * onsetThresholdMultiplier;
            const minTimeBetweenOnsets = 0.1; // 100ms minimum between onsets in same lane

            if (
                rms > threshold &&
                currentTime - lastOnsetTimes[lane] > minTimeBetweenOnsets
            ) {
                // ONSET DETECTED!
                spawnNote(lane, currentTime);
                lastOnsetTimes[lane] = currentTime;
            }
        });
    }

    function spawnNote(lane: number, detectionTime: number) {
        // Apply difficulty filtering
        if (settings.difficulty === "easy" && lane !== 0) return; // Bass only
        if (settings.difficulty === "medium" && lane === 2) return; // Bass + Mid only

        const hitTime = detectionTime + NOTE_SPAWN_LEAD_TIME / 1000; // Convert ms to seconds

        const note: Note = {
            id: `${lane}-${detectionTime}-${Math.random()}`,
            lane,
            spawnTime: detectionTime,
            hitTime,
            position: 0,
            hit: false,
            accuracy: null,
        };

        notes = [...notes, note];
    }

    // ======================
    // GAME LOOP
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
            detectOnsets();
        }

        // Update note positions — notes reach hitZoneY exactly at their hitTime
        notes = notes.map((note) => {
            if (note.hit) return note;

            const timeUntilHit = note.hitTime - currentTime;
            const travelTime = NOTE_SPAWN_LEAD_TIME / 1000;
            const progress = 1 - timeUntilHit / travelTime;

            // Position in pixels: progress=0 → top, progress=1 → hitZoneY
            const pixelY = progress * hitZoneY;

            // Miss: note has fallen MISS_THRESHOLD ms past the hit zone
            const msPastHit = -timeUntilHit * 1000;
            if (msPastHit > MISS_THRESHOLD && !note.hit && !note.accuracy) {
                handleMiss(note);
                return { ...note, accuracy: "miss" as const, position: pixelY };
            }

            return { ...note, position: Math.max(0, pixelY) };
        });

        // Clean up old notes
        notes = notes.filter((note) => {
            const timeSinceHit = currentTime - note.hitTime;
            return timeSinceHit < 2; // Keep for 2 seconds after hit time
        });

        // Clean up old hit feedback
        const now = Date.now();
        hitFeedback = hitFeedback.filter((f) => now - f.timestamp < 1000); // Keep for 1 second
        hitEffects = hitEffects.filter((e) => now - e.timestamp < 500); // Keep particles for 500ms

        // Continue loop
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    // ======================
    // INPUT HANDLING
    // ======================

    function handleInputStart(laneIndex: number) {
        if (gameState !== "playing") return;

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
    }

    function handleInputEnd(laneIndex: number) {
        pressedLanes[laneIndex] = false;
    }

    function handleKeyDown(e: KeyboardEvent) {
        // ESC to toggle pause
        if (
            e.key === "Escape" &&
            (gameState === "playing" || gameState === "paused")
        ) {
            togglePause();
            return;
        }

        if (gameState !== "playing") return;

        const key = e.key.toLowerCase();
        if (pressedKeys.has(key)) return; // Prevent key repeat
        pressedKeys.add(key);

        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex === -1) return;

        handleInputStart(laneIndex);
    }

    function handleKeyUp(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        pressedKeys.delete(key);

        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex !== -1) {
            handleInputEnd(laneIndex);
        }
    }

    function handleHit(note: Note, accuracy: "perfect" | "great" | "ok") {
        note.hit = true;
        note.accuracy = accuracy;

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

        // Add hit feedback text
        const feedbackText =
            accuracy === "perfect"
                ? "PERFECT!"
                : accuracy === "great"
                  ? "GREAT!"
                  : "OK";
        hitFeedback = [
            ...hitFeedback,
            {
                text: feedbackText,
                lane: note.lane,
                timestamp: Date.now(),
            },
        ];

        // Add visual hit effect
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
            // Parallel fetch: All Smols + User Likes
            const [smolsData, likes] = await Promise.all([
                fetchOnMount
                    ? safeFetchSmols({ limit: 5000 })
                    : Promise.resolve(smols),
                fetchLikedSmols(),
            ]);

            smols = smolsData;
            likedTrackIds = new Set(likes);
            allTracks = smols.filter((s) => s.Song_1); // Only playable songs

            applyFilters();
            loading = false;
        } catch (e) {
            console.error("[SmolHero] Failed to load tracks:", e);
            loading = false;
        }
    }

    function applyFilters() {
        let filtered = [...allTracks];

        // 1. Text Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (t) =>
                    (t.Title || "").toLowerCase().includes(q) ||
                    (t.Creator || "").toLowerCase().includes(q) ||
                    (t.Address || "").toLowerCase().includes(q) ||
                    (t.Minted_By || "").toLowerCase().includes(q),
            );
        }

        // 2. Liked Filter
        if (filterLikedOnly) {
            filtered = filtered.filter((t) => likedTrackIds.has(t.Id));
        }

        // 3. Sorting
        filtered.sort((a, b) => {
            if (sortMode === "latest") {
                // Assuming newer IDs are higher? Or just index.
                // Let's rely on original order (often latest first) or simple ID compare if numeric strings
                return b.Id.localeCompare(a.Id);
            }
            if (sortMode === "artist") {
                const nameA = (
                    a.Creator ||
                    a.Address ||
                    "Unknown"
                ).toLowerCase();
                const nameB = (
                    b.Creator ||
                    b.Address ||
                    "Unknown"
                ).toLowerCase();
                return nameA.localeCompare(nameB);
            }
            if (sortMode === "liked") {
                const aLiked = likedTrackIds.has(a.Id);
                const bLiked = likedTrackIds.has(b.Id);
                // Liked first
                return (bLiked ? 1 : 0) - (aLiked ? 1 : 0);
            }
            return 0;
        });

        // Limit display for performance if search is empty
        // logic: if user is searching/filtering, show all matches. If raw list, cap at 100?
        // Actually, virtual scrolling is hard in simple svelte loop. Let's cap at 100 for now.
        // playableTracks = filtered.slice(0, 100);
        // User asked for "pick all songs".
        filteredTracksCount = filtered.length;
        playableTracks = filtered.slice(0, visibleLimit);
    }

    // Reset visible limit when filters change
    $effect(() => {
        const _q = searchQuery;
        const _l = filterLikedOnly;
        const _s = sortMode;
        visibleLimit = 50; // Reset pagination on filter change
    });

    // React to filter changes
    $effect(() => {
        // We reference these so the effect re-runs when they change
        const _q = searchQuery;
        const _l = filterLikedOnly;
        const _s = sortMode;
        // Don't run initially if empty to avoid double-set, but filteredTracks needs init.
        if (allTracks.length > 0) applyFilters();
    });

    async function analyzeTrack(
        track: any,
        existingBuffer: AudioBuffer | null = null,
    ): Promise<Beatmap> {
        gameState = "analyzing";
        analyzingProgress = 0;

        return new Promise(async (resolve, reject) => {
            try {
                let audioBuffer: AudioBuffer;

                if (existingBuffer) {
                    console.log(
                        "[SmolHero] Using cached buffer for analysis...",
                    );
                    audioBuffer = existingBuffer;
                    analyzingProgress = 40;
                } else {
                    // 1. Fetch and Decode Audio (Offline)
                    console.log("[SmolHero] Fetching audio for analysis...");
                    const response = await fetch(getSongUrl(track.Song_1));
                    if (!response.ok)
                        throw new Error(`Fetch failed: ${response.status}`);

                    const arrayBuffer = await response.arrayBuffer();
                    analyzingProgress = 20;

                    const Ctx =
                        window.AudioContext ||
                        (window as any).webkitAudioContext;
                    const tempCtx = new Ctx();
                    audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                    cachedDecodedBuffer = audioBuffer; // Cache for pause menu
                    analyzingProgress = 40;
                    tempCtx.close();
                }

                // 2. Render 3 distinct frequency bands using OfflineAudioContext
                // We map: Channel 0 = Bass, Channel 1 = Mid, Channel 2 = Treble
                const OfflineCtx =
                    window.OfflineAudioContext ||
                    (window as any).webkitOfflineAudioContext;
                const offlineCtx = new OfflineCtx(
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

                // Merger (3 channels)
                const merger = offlineCtx.createChannelMerger(3);

                source.connect(bassFilter);
                bassFilter.connect(merger, 0, 0); // Connect to input 0 of merger (Bass -> Ch 0)

                source.connect(midFilter);
                midFilter.connect(merger, 0, 1); // Connect to input 1 of merger (Mid -> Ch 1)

                source.connect(trebleFilter);
                trebleFilter.connect(merger, 0, 2); // Connect to input 2 of merger (Treble -> Ch 2)

                merger.connect(offlineCtx.destination);

                source.start(0);

                console.log("[SmolHero] Rendering spectral bands...");
                const renderedBuffer = await offlineCtx.startRendering();
                analyzingProgress = 70;

                // 3. Analyze the rendered bands
                console.log("[SmolHero] Detecting beats...");
                const detectedOnsets: CachedOnset[] = [];
                const sampleRate = renderedBuffer.sampleRate;
                const windowSize = Math.floor(sampleRate / 60); // ~60fps windows

                // Detection State per lane
                // Detection State per lane
                const lastOnsetTimes = [0, 0, 0];
                const energyHistory: number[][] = [[], [], []];

                // Peak Centering Sate
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

                        // -- PEAK CENTERING LOGIC --
                        const state = laneState[lane];

                        if (state.isTracking) {
                            // If we are tracking a peak, check if this is a new max
                            if (rms > state.peakRMS) {
                                state.peakRMS = rms;
                                state.peakTime = currentTime;
                            }

                            // If window expired or energy dropped significantly, commit the note
                            if (
                                currentTime - state.startTime > PEAK_WINDOW ||
                                rms < state.peakRMS * 0.5
                            ) {
                                // Only add if we respect the density spacing
                                if (
                                    state.peakTime - lastOnsetTimes[lane] >
                                    minSpacing
                                ) {
                                    detectedOnsets.push({
                                        lane,
                                        time: state.peakTime,
                                    });
                                    lastOnsetTimes[lane] = state.peakTime;
                                }

                                // Reset and cooldown
                                state.isTracking = false;
                                state.peakRMS = 0;
                            }
                        } else {
                            // Start tracking if over threshold, cooldown passed, AND over absolute floor
                            if (
                                rms > threshold &&
                                currentTime - lastOnsetTimes[lane] >
                                    minSpacing &&
                                rms > 0.01 // Noise floor
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

                const beatmap: Beatmap = {
                    trackId: track.Song_1,
                    difficulty: settings.difficulty,
                    onsets: detectedOnsets.sort((a, b) => a.time - b.time),
                };

                // Enforce cache size limit (LRU-style: remove oldest entries)
                const cacheKey = `${track.Song_1}-${settings.difficulty}`;
                if (beatmapCache.size >= BEATMAP_CACHE_MAX_SIZE) {
                    // Remove the first (oldest) entry
                    const firstKey = beatmapCache.keys().next().value;
                    if (firstKey) beatmapCache.delete(firstKey);
                }
                beatmapCache.set(cacheKey, beatmap);
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
        audio.src = `${import.meta.env.PUBLIC_API_URL}/song/${currentTrack.Song_1}.mp3`;
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

        // Handle track end
        audio.onended = () => {
            finishGame();
        };
    }

    function finishGame() {
        gameState = "finished";
        isAnalyzing = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        // Epic confetti if good score
        const totalNotes = stats.perfect + stats.great + stats.ok + stats.miss;
        const accuracy =
            totalNotes > 0
                ? ((stats.perfect + stats.great) / totalNotes) * 100
                : 0;

        if (accuracy >= 90) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ["#9ae600", "#f91880", "#FDDA24"],
            });
        }
    }

    function togglePause() {
        if (!audio) return;

        if (gameState === "playing") {
            gameState = "paused";
            audio.pause();
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        } else if (gameState === "paused") {
            gameState = "playing";
            audio.play();
            gameLoop();
        }
    }

    async function switchDifficulty(diff: GameSettings["difficulty"]) {
        if (settings.difficulty === diff) return;
        settings.difficulty = diff;

        // Re-analyze using cached buffer (fast!)
        // Keep gameState as "analyzing" but we need to stop current "paused" loop?
        // Actually since we are paused, loop is stopped.
        // We set gamestate to analyzing so UI shows spinner? Or just keep paused UI?
        // Let's toggle gameState to "analyzing" so we don't spam Resume.
        const prev = gameState;
        gameState = "analyzing";

        try {
            const newBeatmap = await analyzeTrack(
                currentTrack,
                cachedDecodedBuffer,
            );
            cachedBeatmap = newBeatmap;
            spawnedCachedOnsets.clear(); // Reset spawn tracking
            notes = []; // Clear old difficulty notes

            // Sync notes to current time?
            // The GameLoop does this automatically via detectOnsetsFromCache
            // We just need to ensure existing notes are cleared (done above).

            // Done, go back to paused
            gameState = "paused";
        } catch (e) {
            console.error("Failed to switch difficulty:", e);
            gameState = "paused";
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

    function getArtistDisplay(track: any) {
        if (!track) return "Unknown Artist";
        if (track.Creator && track.Creator !== "Unknown") return track.Creator;
        const addr = track.Address || track.Minted_By;
        if (addr) {
            if (addr.length > 10) {
                return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
            }
            return addr;
        }
        return "Unknown Artist";
    }

    onMount(() => {
        isIOS =
            /iPhone|iPad|iPod/.test(navigator.userAgent) ||
            (navigator.userAgent.includes("Mac") && "ontouchend" in document);

        // On iOS, force Sync Mode (no option)
        if (isIOS) usePreAnalysis = true;

        // Responsive game field dimensions
        updateDimensions();
        window.addEventListener("resize", updateDimensions);

        loadTracks();
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
    });

    onDestroy(() => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        window.removeEventListener("resize", updateDimensions);
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (audio) {
            audio.pause();
            audio.src = '';
            audio = null;
        }
        // Clean up Web Audio API nodes to prevent memory leaks
        if (bassAnalyser) { bassAnalyser.disconnect(); bassAnalyser = null; }
        if (midAnalyser) { midAnalyser.disconnect(); midAnalyser = null; }
        if (trebleAnalyser) { trebleAnalyser.disconnect(); trebleAnalyser = null; }
        if (bassFilter) { bassFilter.disconnect(); bassFilter = null; }
        if (midFilter) { midFilter.disconnect(); midFilter = null; }
        if (trebleFilter) { trebleFilter.disconnect(); trebleFilter = null; }
        if (gainNode) { gainNode.disconnect(); gainNode = null; }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        // Clear cached data
        cachedDecodedBuffer = null;
        cachedBeatmap = null;
        beatmapCache.clear();
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
    {:else if gameState === "analyzing"}
        <!-- ANALYZING TRACK -->
        <div class="flex flex-col items-center justify-center h-96 gap-6 p-4">
            <div class="text-center">
                <h2 class="text-2xl font-bold text-[#9ae600] mb-2">
                    ANALYZING TRACK
                </h2>
                <p class="text-xs text-[#555]">
                    {currentTrack?.Title || "Unknown Track"}
                </p>
                <p class="text-[10px] text-[#333] mt-1">
                    Detecting beats from audio...
                </p>
            </div>

            <!-- Progress bar -->
            <div class="w-full max-w-md">
                <div
                    class="h-2 bg-[#222] rounded-full overflow-hidden border border-[#333]"
                >
                    <div
                        class="h-full bg-gradient-to-r from-[#9ae600] to-[#f91880] transition-all duration-300"
                        style="width: {analyzingProgress}%"
                    ></div>
                </div>
                <div class="text-center mt-2 text-sm text-[#9ae600] font-mono">
                    {analyzingProgress}%
                </div>
            </div>

            <div class="flex gap-1">
                {#each Array(3) as _, i}
                    <div
                        class="w-2 h-2 bg-[#9ae600] rounded-full animate-bounce"
                        style="animation-delay: {i * 0.2}s"
                    ></div>
                {/each}
            </div>

            {#if isIOS}
                <div class="text-center space-y-2">
                    <p class="text-[10px] text-[#555] max-w-xs">
                        📱 iOS Pre-Analysis Mode
                    </p>
                    <p class="text-[8px] text-[#333] max-w-xs">
                        This process takes ~15-30 seconds.<br />
                        Audio is being analyzed silently.
                    </p>
                </div>
            {/if}

            <button
                onclick={() => {
                    gameState = "menu";
                    currentTrack = null;
                }}
                class="mt-4 px-4 py-2 text-xs border border-[#333] rounded bg-black text-[#555] hover:border-[#f91880] hover:text-[#f91880] transition-all"
            >
                Cancel
            </button>
        </div>
    {:else if gameState === "menu"}
        <!-- TRACK SELECTION MENU -->
        <div class="flex flex-col gap-5">
            <!-- Header -->
            <div class="text-center pb-5" style="border-bottom: 1px solid #222;">
                <h1 class="text-4xl font-bold mb-1 tracking-tight">
                    <span class="text-[#9ae600]" style="text-shadow: 0 0 20px rgba(154, 230, 0, 0.3);">SMOL</span>
                    <span class="text-white">HERO</span>
                </h1>
                <p class="text-[10px] text-[#444] uppercase tracking-[0.2em]">
                    Rhythm Game &bull; Beat Detection Engine
                </p>
                {#if isIOS}
                    <div
                        class="mt-3 inline-block px-3 py-1 bg-[#9ae600]/10 border border-[#9ae600] rounded text-[10px] text-[#9ae600]"
                    >
                        iOS &bull; Pre-Analysis Mode Active
                    </div>
                {:else}
                    <button
                        onclick={() => (usePreAnalysis = !usePreAnalysis)}
                        class="mt-3 inline-flex items-center gap-2 px-3 py-1.5 border rounded-md text-[10px] transition-all {usePreAnalysis
                            ? 'bg-[#9ae600]/10 border-[#9ae600]/50 text-[#9ae600]'
                            : 'bg-[#111] border-[#333] text-[#555] hover:border-[#666]'}"
                    >
                        {usePreAnalysis
                            ? "SYNC MODE (BEST)"
                            : "INSTANT START (LAGGY)"}
                    </button>
                    {#if usePreAnalysis}
                        <p class="text-[8px] text-[#444] mt-1">
                            Pre-analyzes audio for perfect beat syncing
                        </p>
                    {/if}
                {/if}
            </div>

            <!-- Difficulty selector -->
            <div class="flex gap-2 justify-center">
                {#each difficultyOptions as d}
                    <button
                        onclick={() => (settings.difficulty = d)}
                        class="px-4 py-2 text-[10px] uppercase tracking-wider border rounded-md transition-all {settings.difficulty === d
                            ? 'bg-[#9ae600] text-black border-[#9ae600] font-bold shadow-[0_0_12px_rgba(154,230,0,0.3)]'
                            : 'bg-[#0a0a0a] border-[#2a2a2a] text-[#555] hover:border-[#9ae600]/50 hover:text-[#9ae600]'}"
                    >
                        {d}
                    </button>
                {/each}
            </div>

            <!-- FILTERS -->
            <div
                class="flex flex-col gap-2.5 sticky top-0 bg-black z-10 pb-2 pt-1"
            >
                <div class="relative">
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Search songs or artists..."
                        class="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-md px-3 py-2.5 text-xs text-white placeholder-[#444] focus:outline-none focus:border-[#9ae600]/50 transition-colors"
                    />
                    {#if searchQuery}
                        <button
                            onclick={() => (searchQuery = "")}
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-white text-sm"
                        >x</button>
                    {/if}
                </div>
                <div class="flex gap-2 justify-between flex-wrap items-center">
                    <div class="flex gap-1">
                        {#each [["latest", "LATEST"], ["artist", "ARTIST"], ["liked", "LIKED"]] as [mode, label]}
                            <button
                                onclick={() => (sortMode = mode as any)}
                                class="px-2.5 py-1 text-[10px] border rounded-md transition-all {sortMode === mode
                                    ? 'bg-[#9ae600]/15 text-[#9ae600] border-[#9ae600]/40'
                                    : 'bg-transparent border-[#222] text-[#555] hover:border-[#444]'}"
                            >{label}</button>
                        {/each}
                    </div>

                    <button
                        onclick={() => (filterLikedOnly = !filterLikedOnly)}
                        class="px-2.5 py-1 text-[10px] border rounded-md flex items-center gap-1 transition-all {filterLikedOnly
                            ? 'bg-[#f91880]/15 text-[#f91880] border-[#f91880]/40'
                            : 'bg-transparent border-[#222] text-[#555] hover:border-[#444]'}"
                    >
                        ♥ LIKED
                    </button>
                </div>
                <div class="text-[9px] text-[#333] text-right tabular-nums">
                    {playableTracks.length} / {filteredTracksCount} tracks
                </div>
            </div>

            <!-- Track list -->
            <div
                class="track-list grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1"
                onscroll={(e) => {
                    const el = e.currentTarget;
                    if (
                        el.scrollHeight - el.scrollTop - el.clientHeight <
                        200
                    ) {
                        if (visibleLimit < filteredTracksCount) {
                            visibleLimit += 50;
                            applyFilters();
                        }
                    }
                }}
            >
                {#each playableTracks as track (track.Id)}
                    {@const isCached = beatmapCache.has(`${track.Song_1}-${settings.difficulty}`)}
                    <div class="relative group">
                        <button
                            onclick={() => selectTrack(track)}
                            class="track-card w-full p-3.5 border rounded-md bg-[#0a0a0a] text-left pr-12 transition-all
                                   {isCached ? 'border-[#9ae600]/20' : 'border-[#1a1a1a]'}
                                   hover:border-[#9ae600]/60 hover:bg-[#111]"
                        >
                            <div class="flex items-center gap-3">
                                <!-- Mini waveform icon -->
                                <div class="flex items-end gap-[2px] h-5 flex-shrink-0 opacity-40 group-hover:opacity-80 transition-opacity">
                                    <div class="w-[2px] bg-[#9ae600] rounded-t-full" style="height: 8px;"></div>
                                    <div class="w-[2px] bg-[#9ae600] rounded-t-full" style="height: 14px;"></div>
                                    <div class="w-[2px] bg-[#9ae600] rounded-t-full" style="height: 10px;"></div>
                                    <div class="w-[2px] bg-[#9ae600] rounded-t-full" style="height: 18px;"></div>
                                    <div class="w-[2px] bg-[#9ae600] rounded-t-full" style="height: 6px;"></div>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[13px] text-white font-bold truncate leading-tight">
                                        {track.Title}
                                    </div>
                                    <div class="text-[10px] text-[#555] truncate mt-0.5">
                                        {getArtistDisplay(track)}
                                        {#if isCached}
                                            <span class="text-[#9ae600]/60 ml-1">&bull; cached</span>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        </button>
                        <div
                            class="absolute right-2.5 top-1/2 -translate-y-1/2"
                            onclick={(e) => e.stopPropagation()}
                        >
                            <LikeButton
                                smolId={track.Id}
                                liked={likedTrackIds.has(track.Id)}
                                iconSize="size-4"
                                on:likeChanged={(e) => {
                                    const newSet = new Set(likedTrackIds);
                                    if (e.detail.liked)
                                        newSet.add(e.detail.smolId);
                                    else newSet.delete(e.detail.smolId);
                                    likedTrackIds = newSet;
                                }}
                            />
                        </div>
                    </div>
                {/each}
                {#if visibleLimit < filteredTracksCount}
                    <div class="col-span-1 md:col-span-2 text-center py-3">
                        <button
                            onclick={() => {
                                visibleLimit += 50;
                                applyFilters();
                            }}
                            class="text-[10px] text-[#9ae600] border border-[#9ae600]/30 px-5 py-2 rounded-md hover:bg-[#9ae600]/10 transition-all"
                        >
                            LOAD MORE
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    {:else if gameState === "playing" || gameState === "paused"}
        <!-- GAME SCREEN -->
        <div class="relative">
            <!-- HUD -->
            <div
                class="flex justify-between items-center mb-3 px-3 py-2.5"
                style="border-bottom: 1px solid #1a1a1a;"
            >
                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div class="text-sm text-white font-bold truncate">
                        {currentTrack?.Title || "Unknown Track"}
                    </div>
                    <div class="text-[10px] text-[#444] truncate">
                        {getArtistDisplay(currentTrack)} &bull; {settings.difficulty.toUpperCase()}
                    </div>
                </div>
                <div class="flex gap-5 text-right flex-shrink-0 ml-4">
                    <div class="flex flex-col">
                        <span class="text-[9px] text-[#444] tracking-wider">SCORE</span>
                        <span class="text-lg text-[#9ae600] font-bold tabular-nums leading-tight"
                            style="text-shadow: 0 0 12px rgba(154, 230, 0, 0.3);"
                            >{stats.score.toLocaleString()}</span
                        >
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[9px] text-[#444] tracking-wider">COMBO</span>
                        <span
                            class="text-lg font-bold tabular-nums leading-tight"
                            style="color: {stats.combo > 0 ? '#f91880' : '#333'};
                                   text-shadow: {stats.combo >= 10 ? '0 0 12px rgba(249, 24, 128, 0.4)' : 'none'};
                                   transition: color 0.15s;"
                            >{stats.combo}x</span
                        >
                    </div>
                </div>
            </div>

            <!-- GAME FIELD -->
            <div
                class="game-field relative bg-black rounded-lg overflow-hidden"
                style="height: {laneHeight}px; border: 1px solid #222;"
            >
                <!-- Scanline overlay for retro feel -->
                <div class="absolute inset-0 pointer-events-none scanlines"></div>

                <!-- Lanes -->
                <div class="absolute inset-0 flex">
                    {#each [0, 1, 2] as lane}
                        <div
                            class="flex-1 relative touch-none select-none"
                            style="border-right: 1px solid {lane < 2 ? '#1a1a1a' : 'transparent'};"
                            onpointerdown={(e) => {
                                e.preventDefault();
                                handleInputStart(lane);
                            }}
                            onpointerup={(e) => {
                                e.preventDefault();
                                handleInputEnd(lane);
                            }}
                            onpointerleave={(e) => {
                                handleInputEnd(lane);
                            }}
                        >
                            <!-- Lane background glow when pressed -->
                            <div
                                class="absolute inset-0"
                                style="background: linear-gradient(to bottom,
                                    transparent 0%,
                                    rgba({LANE_COLORS[lane].rgb}, {pressedLanes[lane] ? 0.06 : 0.015}) 50%,
                                    rgba({LANE_COLORS[lane].rgb}, {pressedLanes[lane] ? 0.15 : 0.03}) 100%
                                ); transition: background 0.08s ease-out;"
                            ></div>

                            <!-- Lane center guide line -->
                            <div
                                class="absolute left-1/2 top-0 bottom-0 w-px"
                                style="background: linear-gradient(to bottom, transparent, rgba({LANE_COLORS[lane].rgb}, 0.06), rgba({LANE_COLORS[lane].rgb}, 0.12));"
                            ></div>

                            <!-- Hit zone — thick glowing receiver bar -->
                            <div
                                class="absolute w-full pointer-events-none"
                                style="top: {hitZoneY - 12}px; height: 24px;"
                            >
                                <!-- Outer glow -->
                                <div
                                    class="absolute inset-x-1 inset-y-0 rounded-sm"
                                    style="background: rgba({LANE_COLORS[lane].rgb}, {pressedLanes[lane] ? 0.25 : 0.08});
                                           box-shadow: 0 0 {pressedLanes[lane] ? 30 : 12}px rgba({LANE_COLORS[lane].rgb}, {pressedLanes[lane] ? 0.5 : 0.15});
                                           transition: all 0.08s ease-out;"
                                ></div>
                                <!-- Core line -->
                                <div
                                    class="absolute inset-x-0 top-1/2 -translate-y-1/2"
                                    style="height: {pressedLanes[lane] ? 4 : 3}px;
                                           background: {LANE_COLORS[lane].hex};
                                           box-shadow: 0 0 8px {LANE_COLORS[lane].hex}, 0 0 16px rgba({LANE_COLORS[lane].rgb}, 0.5);
                                           opacity: {pressedLanes[lane] ? 1 : 0.7};
                                           transition: all 0.08s ease-out;"
                                ></div>
                                <!-- Receiver diamonds (left + right markers) -->
                                <div
                                    class="absolute top-1/2 -translate-y-1/2 left-1"
                                    style="width: 6px; height: 6px; background: {LANE_COLORS[lane].hex};
                                           transform: translateY(-50%) rotate(45deg); opacity: {pressedLanes[lane] ? 1 : 0.5};"
                                ></div>
                                <div
                                    class="absolute top-1/2 -translate-y-1/2 right-1"
                                    style="width: 6px; height: 6px; background: {LANE_COLORS[lane].hex};
                                           transform: translateY(-50%) rotate(45deg); opacity: {pressedLanes[lane] ? 1 : 0.5};"
                                ></div>
                            </div>

                            <!-- Key hint (below hit zone) -->
                            <div
                                class="absolute left-1/2 pointer-events-none"
                                style="top: {hitZoneY + 24}px;
                                       transform: translateX(-50%) scale({pressedLanes[lane] ? 1.15 : 1});
                                       color: {pressedLanes[lane] ? LANE_COLORS[lane].hex : '#2a2a2a'};
                                       font-size: {noteSize * 0.55}px;
                                       font-weight: bold;
                                       text-shadow: {pressedLanes[lane] ? `0 0 10px ${LANE_COLORS[lane].hex}` : 'none'};
                                       transition: all 0.08s ease-out;"
                            >
                                {LANE_KEYS[lane].toUpperCase()}
                            </div>

                            <!-- Hit feedback text -->
                            {#each hitFeedback.filter((f) => f.lane === lane) as feedback (feedback.timestamp)}
                                {@const age = (Date.now() - feedback.timestamp) / 1000}
                                {@const opacity = Math.max(0, 1 - age * 1.5)}
                                {@const yOffset = age * 60}
                                {@const scale = 1 + age * 0.3}
                                <div
                                    class="absolute left-1/2 pointer-events-none font-bold"
                                    style="transform: translateX(-50%) scale({scale});
                                           top: {hitZoneY - 20 - yOffset}px;
                                           opacity: {opacity};
                                           font-size: {feedback.text === 'PERFECT!' ? 14 : 12}px;
                                           color: {feedback.text === 'PERFECT!' ? '#9ae600'
                                               : feedback.text === 'GREAT!' ? '#FDDA24'
                                               : feedback.text === 'OK' ? '#f91880'
                                               : '#444'};
                                           text-shadow: 0 0 12px currentColor, 0 0 24px currentColor;"
                                >
                                    {feedback.text}
                                </div>
                            {/each}

                            <!-- Hit effects (burst) -->
                            {#each hitEffects.filter((e) => e.lane === lane) as effect (effect.id)}
                                {@const age = (Date.now() - effect.timestamp) / 500}
                                <div
                                    class="absolute left-1/2 pointer-events-none"
                                    style="top: {hitZoneY - 16}px; transform: translateX(-50%);"
                                >
                                    <div
                                        class="hit-burst"
                                        style="width: {32 + age * 40}px; height: {32 + age * 40}px;
                                               background: radial-gradient(circle, {effect.color} 0%, transparent 70%);
                                               opacity: {Math.max(0, 1 - age)};
                                               border-radius: 50%;"
                                    ></div>
                                </div>
                            {/each}

                            <!-- Notes in this lane -->
                            {#each notes.filter((n) => n.lane === lane) as note (note.id)}
                                {@const isActive = !note.hit}
                                {@const noteColor = note.hit
                                    ? note.accuracy === 'perfect' ? '#9ae600'
                                    : note.accuracy === 'great' ? '#FDDA24'
                                    : note.accuracy === 'miss' ? '#333'
                                    : '#f91880'
                                    : LANE_COLORS[lane].hex}

                                {#if isActive}
                                    <!-- Note trail (glow streak behind the note) -->
                                    <div
                                        class="absolute left-1/2 pointer-events-none"
                                        style="transform: translateX(-50%);
                                               top: {Math.max(0, note.position - 50)}px;
                                               width: {noteSize * 0.35}px;
                                               height: {Math.min(50, note.position)}px;
                                               background: linear-gradient(to bottom, transparent, {LANE_COLORS[lane].hex});
                                               opacity: 0.3;
                                               border-radius: 0 0 4px 4px;"
                                    ></div>
                                {/if}

                                <!-- Note body -->
                                <div
                                    class="absolute left-1/2 pointer-events-none"
                                    style="transform: translateX(-50%);
                                           top: {note.position - noteSize / 2}px;
                                           width: {noteSize}px;
                                           height: {noteSize}px;"
                                >
                                    <!-- Outer glow -->
                                    {#if isActive}
                                        <div
                                            class="absolute inset-[-4px] rounded-full"
                                            style="background: radial-gradient(circle, rgba({LANE_COLORS[lane].rgb}, 0.4) 0%, transparent 70%);
                                                   filter: blur(4px);"
                                        ></div>
                                    {/if}
                                    <!-- Diamond shape with rounded corners -->
                                    <div
                                        class="absolute inset-[3px] rounded-lg"
                                        style="transform: rotate(45deg);
                                               background: {isActive
                                                   ? `linear-gradient(135deg, ${LANE_COLORS[lane].hex}, ${LANE_COLORS[lane].hex}dd)`
                                                   : noteColor};
                                               opacity: {note.hit ? 0.2 : 1};
                                               box-shadow: {isActive
                                                   ? `0 0 12px ${LANE_COLORS[lane].hex}, inset 0 0 8px rgba(255,255,255,0.2)`
                                                   : 'none'};
                                               border: 1px solid rgba(255,255,255,{isActive ? 0.3 : 0});"
                                    >
                                        {#if note.hit && note.accuracy}
                                            <div
                                                class="absolute inset-0 flex items-center justify-center text-black font-bold"
                                                style="transform: rotate(-45deg); font-size: 10px;"
                                            >
                                                {note.accuracy === "perfect" ? "★"
                                                    : note.accuracy === "great" ? "✓"
                                                    : note.accuracy === "miss" ? "✗"
                                                    : "·"}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>

                <!-- Bottom fade (below hit zone) -->
                <div
                    class="absolute inset-x-0 bottom-0 pointer-events-none"
                    style="height: {laneHeight - hitZoneY}px;
                           background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.6));"
                ></div>
            </div>

            <!-- Controls hint -->
            <div class="mt-3 text-center text-[10px] text-[#333] tracking-wider">
                D / F / J &nbsp;or&nbsp; TAP LANES &nbsp;&bull;&nbsp; ESC to pause
            </div>
        </div>

        <!-- PAUSE MENU OVERLAY -->
        {#if gameState === "paused"}
            <div
                class="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center catch-pointer-events"
                onclick={(e) => e.stopPropagation()}
            >
                <h2 class="text-4xl font-bold text-white mb-8 tracking-widest">
                    PAUSED
                </h2>

                <div class="flex flex-col gap-4 w-64">
                    <button
                        onclick={togglePause}
                        class="bg-[#9ae600] text-black font-bold py-3 rounded hover:scale-105 transition-transform"
                    >
                        RESUME
                    </button>

                    <div
                        class="flex flex-col gap-2 mt-4 border-t border-[#333] pt-4"
                    >
                        <span
                            class="text-xs text-[#555] text-center uppercase tracking-widest"
                            >Difficulty</span
                        >
                        <div class="grid grid-cols-2 gap-2">
                            {#each difficultyOptions as d}
                                <button
                                    onclick={() => switchDifficulty(d)}
                                    class="px-2 py-2 text-[10px] border rounded uppercase transition-colors {settings.difficulty ===
                                    d
                                        ? 'bg-white text-black border-white'
                                        : 'bg-transparent text-[#555] border-[#333] hover:border-white'}"
                                >
                                    {d}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <button
                        onclick={() => {
                            // Restart track
                            spawnedCachedOnsets.clear();
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
                            if (audio) {
                                audio.currentTime = 0;
                                gameState = "playing";
                                audio.play();
                                gameLoop();
                            }
                        }}
                        class="mt-4 border border-[#333] text-[#777] hover:text-white hover:border-white py-2 rounded text-xs"
                    >
                        RESTART SONG
                    </button>
                    <button
                        onclick={() => {
                            if (confirm("Exit to menu?")) finishGame();
                        }}
                        class="border border-[#333] text-[#777] hover:text-[#f91880] hover:border-[#f91880] py-2 rounded text-xs"
                    >
                        EXIT TO MENU
                    </button>
                </div>
            </div>
        {/if}
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

    /* Scanline overlay for retro arcade feel */
    .scanlines {
        background: repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent 3px,
            rgba(0, 0, 0, 0.08) 3px,
            rgba(0, 0, 0, 0.08) 4px
        );
        z-index: 5;
    }

    /* Game field subtle vignette */
    .game-field::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.5);
        z-index: 4;
        border-radius: inherit;
    }

    /* Track list custom scrollbar */
    .track-list::-webkit-scrollbar {
        width: 4px;
    }
    .track-list::-webkit-scrollbar-track {
        background: #111;
        border-radius: 2px;
    }
    .track-list::-webkit-scrollbar-thumb {
        background: #333;
        border-radius: 2px;
    }
    .track-list::-webkit-scrollbar-thumb:hover {
        background: #9ae600;
    }

    /* Track card hover lift */
    .track-card:hover {
        transform: translateY(-1px);
    }

    /* Hit burst animation */
    .hit-burst {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
    }
</style>
