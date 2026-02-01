<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { vibeStore } from "./vibeState.svelte";
    import { getAudioMetrics } from "./vibeAudio";
    import { VIBE_CONSTANTS } from "./vibeMachine";
    import { isPlaying } from "../../../stores/audio.svelte";
    import sproutUrl from "/sprites/sprout_v1.json?url"; // Just to ensure vite sees it if needed, though we use hardcoded paths usually

    // Asset Map
    import sproutMap from "./sprout_v1.json";

    // DOM Refs
    let container: HTMLDivElement;

    // Animation State
    let frame = 0;
    let animTimer = 0;
    let rafId: number;
    let lastTime = 0;

    // Render State
    let renderX = 0;
    let renderY = 0;
    let renderScale = 1;
    let renderFrame = 0;
    let glitchOffset = { x: 0, y: 0 };

    // Audio Bounce State
    let bounceScale = 1.0;

    // Initialize
    onMount(() => {
        // Set initial random position if valid
        if (container) {
            const bounds = container.getBoundingClientRect();
            // If pos is default/invalid, randomize
            if (vibeStore.pos.x < 0 || vibeStore.pos.x > bounds.width)
                vibeStore.pos.x = bounds.width / 2;
            if (vibeStore.pos.y < 0 || vibeStore.pos.y > bounds.height)
                vibeStore.pos.y = bounds.height / 2;

            renderX = vibeStore.pos.x;
            renderY = vibeStore.pos.y;
        }

        lastTime = performance.now();
        rafId = requestAnimationFrame(loop);

        // Save on unload
        window.addEventListener("beforeunload", () => vibeStore.save());

        return () => {
            cancelAnimationFrame(rafId);
            vibeStore.save();
        };
    });

    function loop(now: number) {
        const dt = Math.min((now - lastTime) / 1000, VIBE_CONSTANTS.MAX_DT); // Cap delta time
        lastTime = now;

        if (document.hidden) {
            rafId = requestAnimationFrame(loop);
            return;
        }

        update(dt);
        draw();

        rafId = requestAnimationFrame(loop);
    }

    function update(dt: number) {
        // 1. Audio Inputs
        const audioActive = isPlaying();
        const metrics = audioActive
            ? getAudioMetrics()
            : { beat: 0, treble: 0, raw: 0 };

        // 2. State Transitions
        // Force Wake on Audio
        if (audioActive && vibeStore.mood === VIBE_CONSTANTS.MOODS.ASLEEP) {
            vibeStore.wakeUp();
        }

        // Determine State
        if (vibeStore.currentState === VIBE_CONSTANTS.STATES.EAT) {
            // Handled by timer/timeout usually? Or frame count.
            // For simplicity, we assume EAT overrides everything until animation ends.
            // We'll reset it in the draw logic if animation finishes?
            // Better: use a timestamp in store, but store is simple.
            // Let's use a local lock for EAT for now or check animation completion.
        } else if (vibeStore.mood === VIBE_CONSTANTS.MOODS.ASLEEP) {
            vibeStore.currentState = VIBE_CONSTANTS.STATES.SLEEP;
        } else if (audioActive) {
            vibeStore.currentState = VIBE_CONSTANTS.STATES.RAVE;
        } else {
            // Default Logic
            if (
                vibeStore.currentState !== VIBE_CONSTANTS.STATES.WANDER &&
                vibeStore.currentState !== VIBE_CONSTANTS.STATES.IDLE
            ) {
                vibeStore.currentState = VIBE_CONSTANTS.STATES.IDLE;
            }

            // Randomly switch WANDER/IDLE
            if (Math.random() < 0.01) {
                vibeStore.currentState =
                    vibeStore.currentState === VIBE_CONSTANTS.STATES.WANDER
                        ? VIBE_CONSTANTS.STATES.IDLE
                        : VIBE_CONSTANTS.STATES.WANDER;

                // Pick new velocity if wandering
                if (vibeStore.currentState === VIBE_CONSTANTS.STATES.WANDER) {
                    const angle = Math.random() * Math.PI * 2;
                    vibeStore.vel.x =
                        Math.cos(angle) * VIBE_CONSTANTS.WALK_SPEED;
                    vibeStore.vel.y =
                        Math.sin(angle) * VIBE_CONSTANTS.WALK_SPEED;
                }
            }
        }

        // 3. Physics (Wander)
        if (vibeStore.currentState === VIBE_CONSTANTS.STATES.WANDER) {
            vibeStore.pos.x += vibeStore.vel.x * dt;
            vibeStore.pos.y += vibeStore.vel.y * dt;

            // Bounce Bounds
            if (container) {
                const w = container.clientWidth - VIBE_CONSTANTS.GRID_SIZE * 2; // Margin
                const h = container.clientHeight - VIBE_CONSTANTS.GRID_SIZE * 2;

                if (vibeStore.pos.x < 0) {
                    vibeStore.pos.x = 0;
                    vibeStore.vel.x *= -1;
                }
                if (vibeStore.pos.x > w) {
                    vibeStore.pos.x = w;
                    vibeStore.vel.x *= -1;
                }
                if (vibeStore.pos.y < 0) {
                    vibeStore.pos.y = 0;
                    vibeStore.vel.y *= -1;
                }
                if (vibeStore.pos.y > h) {
                    vibeStore.pos.y = h;
                    vibeStore.vel.y *= -1;
                }
            }
        } else {
            // Friction/Stop
            vibeStore.vel.x = 0;
            vibeStore.vel.y = 0;
        }

        // 4. Reactions
        // Bounce Impulse
        if (metrics.beat > 0) {
            bounceScale = 1.3;
        }
        // Decay Bounce
        bounceScale +=
            (1.0 - bounceScale) * VIBE_CONSTANTS.BOUNCE_DECAY * (dt * 20); // Framerate independent-ish decay

        // Glitch (Treble)
        if (metrics.treble > 0.6) {
            glitchOffset.x = (Math.random() - 0.5) * 4;
            glitchOffset.y = (Math.random() - 0.5) * 4;
        } else {
            glitchOffset.x = 0;
            glitchOffset.y = 0;
        }

        // Animation Tick
        animTimer += dt * 1000;
        if (animTimer > VIBE_CONSTANTS.FRAME_MS) {
            frame++;
            animTimer = 0;

            // Handle One-Shot Animations (EAT)
            if (vibeStore.currentState === VIBE_CONSTANTS.STATES.EAT) {
                const eatFrames = sproutMap.animations.EAT;
                if (frame >= eatFrames.length) {
                    // Done eating
                    vibeStore.currentState = VIBE_CONSTANTS.STATES.IDLE;
                }
            }
        }
    }

    function draw() {
        renderX = vibeStore.pos.x;
        renderY = vibeStore.pos.y;

        // Select Frame
        let animKey = vibeStore.currentState;
        // Fallback if key missing
        if (!sproutMap.animations[animKey]) animKey = "IDLE";

        // @ts-ignore
        const frames = sproutMap.animations[animKey];
        const frameIndex = frames[frame % frames.length];

        renderFrame = frameIndex;

        // Sprite Sheet Math
        // 8 cols
        const col = renderFrame % 8;
        const row = Math.floor(renderFrame / 8);
        // bg position: -col*32px -row*32px
    }

    async function handleFeed() {
        vibeStore.currentState = VIBE_CONSTANTS.STATES.EAT;
        vibeStore.addSnack();
        frame = 0; // Reset anim
    }

    function handlePet() {
        vibeStore.wakeUp();
        bounceScale = 1.4; // Jump
    }
</script>

<div
    bind:this={container}
    class="absolute inset-0 z-0 pointer-events-none overflow-hidden"
>
    <!-- Render Container -->
    <div
        class="absolute pointer-events-auto cursor-pointer transition-transform duration-75 ease-linear"
        style="
            transform: translate3d({renderX + glitchOffset.x}px, {renderY +
            glitchOffset.y}px, 0) scale({4 * bounceScale});
            width: 32px;
            height: 32px;
            image-rendering: pixelated;
        "
        on:mousedown|stopPropagation={handlePet}
        role="button"
        tabindex="0"
    >
        <div
            class="w-full h-full bg-no-repeat"
            style="
                background-image: url('/sprites/sprout_v1.png');
                background-position: -{(renderFrame % 8) * 32}px -{Math.floor(
                renderFrame / 8,
            ) * 32}px;
                background-size: 256px 160px;
            "
        ></div>

        <!-- Debug / Speech Bubble -->
        {#if vibeStore.mood === VIBE_CONSTANTS.MOODS.ASLEEP}
            <div
                class="absolute -top-4 right-0 text-[6px] font-pixel text-slate-400 animate-pulse"
            >
                Zzz...
            </div>
        {/if}
    </div>

    <!-- UI Card (Floating) -->
    <div class="absolute bottom-4 right-4 z-50 pointer-events-auto font-pixel">
        <div
            class="bg-black/80 border border-[#9ae600]/30 p-3 rounded shadow-lg backdrop-blur-sm flex flex-col gap-2 items-center"
        >
            <div class="text-[8px] text-[#9ae600] uppercase tracking-widest">
                The Vibe
            </div>
            <button
                class="bg-[#9ae600] text-black text-[8px] px-2 py-1 hover:bg-white active:scale-95 transition-all w-full uppercase font-bold"
                on:click|stopPropagation={handleFeed}
            >
                Feed 1 KALE
            </button>
            <div class="text-[6px] text-[#555]">
                PENDING: {vibeStore.pendingSnacks}
            </div>
        </div>
    </div>
</div>
