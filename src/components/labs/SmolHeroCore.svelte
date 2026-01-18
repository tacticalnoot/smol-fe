<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { safeFetchSmols } from "../../services/api/smols";
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
        accuracy: "perfect" | "great" | "ok" | "miss" | null;
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

    let gameState = $state<"menu" | "analyzing" | "calibrating" | "playing" | "paused" | "finished">("menu");
    let currentTrack = $state<any | null>(null);
    let playableTracks = $state<any[]>([]);
    let loading = $state(false);

    // Pre-analysis for iOS support
    let isIOS = $state(false);
    let usePreAnalysis = $state(false); // Set to true on iOS or for compatibility
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
        calibrationOffset: 0
    });

    let notes = $state<Note[]>([]);
    let stats = $state<Stats>({
        perfect: 0,
        great: 0,
        ok: 0,
        miss: 0,
        combo: 0,
        maxCombo: 0,
        score: 0
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
            case "easy": return 1.8; // Less sensitive, fewer notes
            case "medium": return 1.5;
            case "hard": return 1.3;
            case "expert": return 1.2; // More sensitive, more notes
            default: return 1.5;
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
    let hitFeedback = $state<{text: string; lane: number; timestamp: number}[]>([]); // Hit feedback text

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
        const spawnDeadline = currentTime + spawnWindow;

        cachedBeatmap.onsets.forEach((onset, index) => {
            // Skip if already spawned
            if (spawnedCachedOnsets.has(index)) return;

            // Check if this onset should spawn now
            if (onset.time <= spawnDeadline && onset.time > currentTime) {
                spawnNote(onset.lane, currentTime);
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
            const avgEnergy = energyHistory[lane].reduce((a, b) => a + b, 0) / energyHistory[lane].length;

            // Detect onset: current energy significantly above average
            const threshold = avgEnergy * onsetThresholdMultiplier;
            const minTimeBetweenOnsets = 0.1; // 100ms minimum between onsets in same lane

            if (rms > threshold && (currentTime - lastOnsetTimes[lane]) > minTimeBetweenOnsets) {
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

        const hitTime = detectionTime + (NOTE_SPAWN_LEAD_TIME / 1000); // Convert ms to seconds

        const note: Note = {
            id: `${lane}-${detectionTime}-${Math.random()}`,
            lane,
            spawnTime: detectionTime,
            hitTime,
            position: 0,
            hit: false,
            accuracy: null
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

        // Update note positions
        notes = notes.map(note => {
            if (note.hit) return note;

            // Calculate position based on time until hit
            const timeUntilHit = note.hitTime - currentTime;
            const progress = 1 - (timeUntilHit / (NOTE_SPAWN_LEAD_TIME / 1000));
            const newPosition = Math.max(0, Math.min(100, progress * 100));

            // Check if note passed hit zone (miss)
            if (newPosition > 100 && !note.hit && !note.accuracy) {
                handleMiss(note);
                return { ...note, accuracy: "miss", position: newPosition };
            }

            return { ...note, position: newPosition };
        });

        // Clean up old notes
        notes = notes.filter(note => {
            const timeSinceHit = currentTime - note.hitTime;
            return timeSinceHit < 2; // Keep for 2 seconds after hit time
        });

        // Clean up old hit feedback
        const now = Date.now();
        hitFeedback = hitFeedback.filter(f => (now - f.timestamp) < 1000); // Keep for 1 second

        // Continue loop
        animationFrameId = requestAnimationFrame(gameLoop);
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
            .filter(n => n.lane === laneIndex && !n.hit)
            .sort((a, b) => Math.abs(a.hitTime - currentTime) - Math.abs(b.hitTime - currentTime));

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

        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex !== -1) {
            pressedLanes[laneIndex] = false;
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
        const baseScore = accuracy === "perfect" ? 300 : accuracy === "great" ? 200 : 100;
        const comboMultiplier = 1 + (stats.combo / 10);
        stats.score += Math.floor(baseScore * comboMultiplier);

        // Add hit feedback text
        const feedbackText = accuracy === "perfect" ? "PERFECT!" : accuracy === "great" ? "GREAT!" : "OK";
        hitFeedback = [...hitFeedback, {
            text: feedbackText,
            lane: note.lane,
            timestamp: Date.now()
        }];

        // Visual feedback
        if (accuracy === "perfect") {
            if (stats.combo % 10 === 0 && stats.combo > 0) {
                // Confetti on combo milestones
                confetti({
                    particleCount: 20,
                    spread: 40,
                    origin: { y: 0.8, x: 0.3 + (note.lane * 0.2) },
                    colors: ['#9ae600', '#f91880', '#FDDA24']
                });
            }
        }
    }

    function handleMiss(note: Note) {
        stats.miss++;
        stats.combo = 0; // Break combo

        // Add miss feedback
        hitFeedback = [...hitFeedback, {
            text: "MISS",
            lane: note.lane,
            timestamp: Date.now()
        }];
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
            playableTracks = smols.filter(s => s.Song_1).slice(0, 20);
            loading = false;
        } catch (e) {
            console.error("[SmolHero] Failed to load tracks:", e);
            loading = false;
        }
    }

    async function analyzeTrack(track: any): Promise<Beatmap> {
        gameState = "analyzing";
        analyzingProgress = 0;

        return new Promise((resolve, reject) => {
            const analysisAudio = new Audio();
            analysisAudio.crossOrigin = "anonymous";
            analysisAudio.src = `${import.meta.env.PUBLIC_API_URL}/song/${track.Song_1}.mp3`;
            analysisAudio.volume = 0.01; // Very quiet
            analysisAudio.playbackRate = 2.0; // 2x speed for faster analysis

            const detectedOnsets: CachedOnset[] = [];
            let analysisContext: AudioContext | null = null;
            let analysisAnalysers: AnalyserNode[] = [];

            const setupAnalysis = () => {
                try {
                    analysisContext = new AudioContext();
                    const source = analysisContext.createMediaElementSource(analysisAudio);
                    const gainNode = analysisContext.createGain();
                    gainNode.gain.value = 0.01;

                    // Create same frequency band filters
                    const bassFilter = analysisContext.createBiquadFilter();
                    bassFilter.type = "lowpass";
                    bassFilter.frequency.value = 200;
                    bassFilter.Q.value = 0.7;
                    const bassAnalyser = analysisContext.createAnalyser();
                    bassAnalyser.fftSize = 512;
                    bassAnalyser.smoothingTimeConstant = 0.3;

                    const midFilter = analysisContext.createBiquadFilter();
                    midFilter.type = "bandpass";
                    midFilter.frequency.value = 1000;
                    midFilter.Q.value = 0.7;
                    const midAnalyser = analysisContext.createAnalyser();
                    midAnalyser.fftSize = 512;
                    midAnalyser.smoothingTimeConstant = 0.3;

                    const trebleFilter = analysisContext.createBiquadFilter();
                    trebleFilter.type = "highpass";
                    trebleFilter.frequency.value = 2000;
                    trebleFilter.Q.value = 0.7;
                    const trebleAnalyser = analysisContext.createAnalyser();
                    trebleAnalyser.fftSize = 512;
                    trebleAnalyser.smoothingTimeConstant = 0.3;

                    source.connect(bassFilter);
                    bassFilter.connect(bassAnalyser);
                    source.connect(midFilter);
                    midFilter.connect(midAnalyser);
                    source.connect(trebleFilter);
                    trebleFilter.connect(trebleAnalyser);
                    source.connect(gainNode);
                    gainNode.connect(analysisContext.destination);

                    analysisAnalysers = [bassAnalyser, midAnalyser, trebleAnalyser];

                    // Run analysis loop
                    const energyHistory: number[][] = [[], [], []];
                    const lastOnsetTimes = [0, 0, 0];

                    const analyzeFrame = () => {
                        if (analysisAudio.paused || analysisAudio.ended) return;

                        const currentTime = analysisAudio.currentTime / analysisAudio.playbackRate; // Adjust for playback rate

                        analysisAnalysers.forEach((analyser, lane) => {
                            const bufferLength = analyser.frequencyBinCount;
                            const dataArray = new Uint8Array(bufferLength);
                            analyser.getByteFrequencyData(dataArray);

                            let sum = 0;
                            for (let i = 0; i < bufferLength; i++) {
                                sum += dataArray[i] * dataArray[i];
                            }
                            const rms = Math.sqrt(sum / bufferLength);

                            energyHistory[lane].push(rms);
                            if (energyHistory[lane].length > ENERGY_HISTORY_SIZE) {
                                energyHistory[lane].shift();
                            }

                            if (energyHistory[lane].length < ENERGY_HISTORY_SIZE) return;

                            const avgEnergy = energyHistory[lane].reduce((a, b) => a + b, 0) / energyHistory[lane].length;
                            const threshold = avgEnergy * onsetThresholdMultiplier;

                            if (rms > threshold && (currentTime - lastOnsetTimes[lane]) > 0.1) {
                                // Onset detected! Store it
                                detectedOnsets.push({ lane, time: currentTime });
                                lastOnsetTimes[lane] = currentTime;
                            }
                        });

                        // Update progress
                        if (analysisAudio.duration) {
                            analyzingProgress = Math.floor((analysisAudio.currentTime / analysisAudio.duration) * 100);
                        }

                        requestAnimationFrame(analyzeFrame);
                    };

                    analyzeFrame();
                } catch (e) {
                    console.error("[SmolHero] Analysis setup failed:", e);
                    reject(e);
                }
            };

            analysisAudio.onloadedmetadata = () => {
                setupAnalysis();
                analysisAudio.play().catch(reject);
            };

            analysisAudio.onended = () => {
                if (analysisContext) {
                    analysisContext.close();
                }
                analyzingProgress = 100;

                const beatmap: Beatmap = {
                    trackId: track.Song_1,
                    difficulty: settings.difficulty,
                    onsets: detectedOnsets.sort((a, b) => a.time - b.time)
                };

                // Cache it
                beatmapCache.set(`${track.Song_1}-${settings.difficulty}`, beatmap);

                console.log(`[SmolHero] Analysis complete: ${detectedOnsets.length} onsets detected`);
                resolve(beatmap);
            };

            analysisAudio.onerror = (e) => {
                if (analysisContext) {
                    analysisContext.close();
                }
                reject(e);
            };
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
                    beatmap = await analyzeTrack(track);
                } catch (e) {
                    console.error("[SmolHero] Pre-analysis failed:", e);
                    alert("Failed to analyze track. Please try another.");
                    gameState = "menu";
                    return;
                }
            }

            cachedBeatmap = beatmap;
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
            score: 0
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
        audio.play().then(() => {
            gameStartTime = Date.now();
            isAnalyzing = true;
            gameLoop();
        }).catch(e => {
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
        const accuracy = totalNotes > 0 ? ((stats.perfect + stats.great) / totalNotes) * 100 : 0;

        if (accuracy >= 90) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#9ae600', '#f91880', '#FDDA24']
            });
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
        // Detect iOS/Safari
        isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
                (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
        usePreAnalysis = isIOS; // Always use pre-analysis on iOS

        loadTracks();
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
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
            <div class="text-[#9ae600] text-sm animate-pulse">LOADING TRACKS...</div>
        </div>

    {:else if gameState === "analyzing"}
        <!-- ANALYZING TRACK -->
        <div class="flex flex-col items-center justify-center h-96 gap-6">
            <div class="text-center">
                <h2 class="text-2xl font-bold text-[#9ae600] mb-2">ANALYZING TRACK</h2>
                <p class="text-xs text-[#555]">{currentTrack?.Title || 'Unknown Track'}</p>
                <p class="text-[10px] text-[#333] mt-1">Detecting beats from audio...</p>
            </div>

            <!-- Progress bar -->
            <div class="w-full max-w-md">
                <div class="h-2 bg-[#222] rounded-full overflow-hidden border border-[#333]">
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
                    <div class="w-2 h-2 bg-[#9ae600] rounded-full animate-bounce" style="animation-delay: {i * 0.2}s"></div>
                {/each}
            </div>

            {#if isIOS}
                <p class="text-[10px] text-[#555] max-w-xs text-center">
                    📱 iOS detected: Pre-analyzing track for optimal performance
                </p>
            {/if}
        </div>

    {:else if gameState === "menu"}
        <!-- TRACK SELECTION MENU -->
        <div class="flex flex-col gap-6">
            <div class="text-center border-b border-[#333] pb-6">
                <h1 class="text-4xl font-bold text-[#9ae600] mb-2">SMOL HERO</h1>
                <p class="text-xs text-[#555] uppercase tracking-widest">Rhythm Game • Beat Detection Engine</p>
                {#if isIOS}
                    <div class="mt-3 inline-block px-3 py-1 bg-[#9ae600]/10 border border-[#9ae600] rounded text-[10px] text-[#9ae600]">
                        ✓ iOS COMPATIBLE • Pre-Analysis Mode
                    </div>
                {/if}
            </div>

            <div class="flex gap-4 justify-center mb-4">
                <button
                    onclick={() => settings.difficulty = "easy"}
                    class="px-4 py-2 text-xs border rounded {settings.difficulty === 'easy' ? 'bg-[#9ae600] text-black border-[#9ae600]' : 'bg-black border-[#333] text-[#555] hover:border-[#9ae600]'}"
                >
                    EASY
                </button>
                <button
                    onclick={() => settings.difficulty = "medium"}
                    class="px-4 py-2 text-xs border rounded {settings.difficulty === 'medium' ? 'bg-[#9ae600] text-black border-[#9ae600]' : 'bg-black border-[#333] text-[#555] hover:border-[#9ae600]'}"
                >
                    MEDIUM
                </button>
                <button
                    onclick={() => settings.difficulty = "hard"}
                    class="px-4 py-2 text-xs border rounded {settings.difficulty === 'hard' ? 'bg-[#9ae600] text-black border-[#9ae600]' : 'bg-black border-[#333] text-[#555] hover:border-[#9ae600]'}"
                >
                    HARD
                </button>
                <button
                    onclick={() => settings.difficulty = "expert"}
                    class="px-4 py-2 text-xs border rounded {settings.difficulty === 'expert' ? 'bg-[#9ae600] text-black border-[#9ae600]' : 'bg-black border-[#333] text-[#555] hover:border-[#9ae600]'}"
                >
                    EXPERT
                </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                {#each playableTracks as track}
                    <button
                        onclick={() => selectTrack(track)}
                        class="p-4 border border-[#333] rounded bg-[#111] hover:border-[#9ae600] hover:bg-[#222] transition-all text-left"
                    >
                        <div class="text-sm text-white font-bold truncate">{track.Title}</div>
                        <div class="text-[10px] text-[#555] truncate">{track.Creator || 'Unknown'}</div>
                    </button>
                {/each}
            </div>
        </div>

    {:else if gameState === "playing"}
        <!-- GAME SCREEN -->
        <div class="relative">
            <!-- HUD -->
            <div class="flex justify-between items-start mb-4 p-4 border-b border-[#333]">
                <div class="flex flex-col gap-1">
                    <div class="text-sm text-white font-bold">{currentTrack?.Title || 'Unknown Track'}</div>
                    <div class="text-[10px] text-[#555]">{currentTrack?.Creator || 'Unknown Artist'}</div>
                </div>
                <div class="flex gap-6 text-right">
                    <div class="flex flex-col">
                        <span class="text-[10px] text-[#555]">SCORE</span>
                        <span class="text-xl text-[#9ae600] font-bold">{stats.score.toLocaleString()}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[10px] text-[#555]">COMBO</span>
                        <span class="text-xl text-[#f91880] font-bold {stats.combo > 0 ? 'animate-pulse' : ''}">{stats.combo}x</span>
                    </div>
                </div>
            </div>

            <!-- GAME FIELD -->
            <div class="relative bg-black border-2 border-[#333] rounded-lg overflow-hidden" style="height: {laneHeight}px;">
                <!-- Lanes -->
                <div class="absolute inset-0 flex">
                    {#each [0, 1, 2] as lane}
                        <div class="flex-1 border-r border-[#222] last:border-r-0 relative">
                            <!-- Lane background -->
                            <div class="absolute inset-0 bg-gradient-to-b from-transparent via-[#111] to-black opacity-50"></div>

                            <!-- Hit zone indicator -->
                            <div
                                class="absolute w-full h-2 border-y-2 transition-all duration-75"
                                style="top: {hitZoneY}px; background-color: {pressedLanes[lane] ? 'rgba(154, 230, 0, 0.6)' : 'rgba(154, 230, 0, 0.3)'}; border-color: {pressedLanes[lane] ? '#9ae600' : '#9ae600'}; box-shadow: {pressedLanes[lane] ? '0 0 20px #9ae600' : 'none'};"
                            ></div>

                            <!-- Key hint -->
                            <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-[#333] text-2xl font-bold {pressedLanes[lane] ? 'text-[#9ae600] scale-110' : ''} transition-all duration-75">
                                {LANE_KEYS[lane].toUpperCase()}
                            </div>

                            <!-- Hit feedback text -->
                            {#each hitFeedback.filter(f => f.lane === lane) as feedback (feedback.timestamp)}
                                {@const age = (Date.now() - feedback.timestamp) / 1000}
                                {@const opacity = Math.max(0, 1 - age)}
                                {@const yOffset = age * 50}
                                <div
                                    class="absolute left-1/2 -translate-x-1/2 text-xs font-bold pointer-events-none"
                                    style="top: {hitZoneY - yOffset}px; opacity: {opacity}; color: {feedback.text === 'PERFECT!' ? '#9ae600' : feedback.text === 'GREAT!' ? '#FDDA24' : feedback.text === 'OK' ? '#f91880' : '#666'}; text-shadow: 0 0 10px currentColor;"
                                >
                                    {feedback.text}
                                </div>
                            {/each}

                            <!-- Notes in this lane -->
                            {#each notes.filter(n => n.lane === lane) as note (note.id)}
                                <div
                                    class="absolute left-1/2 -translate-x-1/2 rounded-full transition-all duration-75"
                                    style="
                                        top: {(note.position / 100) * laneHeight}px;
                                        width: {noteSize}px;
                                        height: {noteSize}px;
                                        background: {note.hit
                                            ? (note.accuracy === 'perfect' ? '#9ae600' : note.accuracy === 'great' ? '#FDDA24' : '#f91880')
                                            : (lane === 0 ? '#9ae600' : lane === 1 ? '#FDDA24' : '#f91880')
                                        };
                                        opacity: {note.hit ? 0.3 : 1};
                                        box-shadow: 0 0 20px currentColor;
                                    "
                                >
                                    {#if note.hit && note.accuracy}
                                        <div class="absolute inset-0 flex items-center justify-center text-black text-[8px] font-bold">
                                            {note.accuracy === 'perfect' ? '★' : note.accuracy === 'great' ? '✓' : '·'}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>

            <!-- Controls hint -->
            <div class="mt-4 text-center text-[10px] text-[#333]">
                Press D, F, J to hit notes • ESC to quit
            </div>
        </div>

    {:else if gameState === "finished"}
        <!-- RESULTS SCREEN -->
        <div class="flex flex-col gap-6 p-8 border-2 border-[#9ae600] rounded-lg bg-[#111]">
            <div class="text-center border-b border-[#333] pb-4">
                <h2 class="text-3xl font-bold text-[#9ae600] mb-2">STAGE CLEAR!</h2>
                <p class="text-sm text-white">{currentTrack?.Title}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col items-center p-4 border border-[#333] rounded">
                    <span class="text-[10px] text-[#555] uppercase">Final Score</span>
                    <span class="text-3xl text-[#9ae600] font-bold">{stats.score.toLocaleString()}</span>
                </div>
                <div class="flex flex-col items-center p-4 border border-[#333] rounded">
                    <span class="text-[10px] text-[#555] uppercase">Max Combo</span>
                    <span class="text-3xl text-[#f91880] font-bold">{stats.maxCombo}x</span>
                </div>
            </div>

            <div class="grid grid-cols-4 gap-2 text-center">
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#9ae600]">PERFECT</div>
                    <div class="text-xl font-bold text-white">{stats.perfect}</div>
                </div>
                <div class="p-3 border border-[#333] rounded">
                    <div class="text-[10px] text-[#FDDA24]">GREAT</div>
                    <div class="text-xl font-bold text-white">{stats.great}</div>
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
</style>
