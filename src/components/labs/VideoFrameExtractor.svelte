<script lang="ts">
    import { onMount } from "svelte";

    let videoFile: File | null = null;
    let videoSrc: string | null = null;
    let videoRef: HTMLVideoElement;
    let canvasRef: HTMLCanvasElement;
    let extractedImage: string | null = null;
    let isProcessing = false;

    const handleFileChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files[0]) {
            videoFile = target.files[0];
            videoSrc = URL.createObjectURL(videoFile);
            extractedImage = null;
            isProcessing = true;
        }
    };

    const onMetadataLoaded = async () => {
        if (!videoRef) return;

        // Seek to very end (duration - small buffer)
        videoRef.currentTime = Math.max(0, videoRef.duration - 0.05);

        // Wait for seek
        await new Promise((r) => {
            const onSeek = () => {
                videoRef.removeEventListener("seeked", onSeek);
                r(true);
            };
            videoRef.addEventListener("seeked", onSeek);
        });

        // Capture high-res frame
        if (canvasRef) {
            canvasRef.width = videoRef.videoWidth;
            canvasRef.height = videoRef.videoHeight;
            const ctx = canvasRef.getContext("2d");
            ctx?.drawImage(videoRef, 0, 0, canvasRef.width, canvasRef.height);
            extractedImage = canvasRef.toDataURL("image/png");
            isProcessing = false;
        }
    };

    const downloadImage = () => {
        if (!extractedImage) return;
        const a = document.createElement("a");
        a.href = extractedImage;
        a.download = `${videoFile?.name?.split(".")[0] || "video"}-last-frame.png`;
        a.click();
    };

    const copyImage = async () => {
        if (!canvasRef) return;
        try {
            canvasRef.toBlob(async (blob) => {
                if (!blob) return;
                await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": blob }),
                ]);
                alert("Copied frame to clipboard!");
            });
        } catch (err) {
            console.error("Failed to copy", err);
        }
    };

    const reset = () => {
        videoFile = null;
        videoSrc = null;
        extractedImage = null;
    };
</script>

<div class="font-pixel text-[#9ae600] space-y-8">
    {#if !videoSrc}
        <!-- Upload Zone -->
        <div
            class="border-2 border-dashed border-[#333] rounded-xl p-24 text-center hover:border-[#9ae600] transition-colors cursor-pointer relative group bg-[#050505]"
        >
            <input
                type="file"
                accept="video/*"
                on:change={handleFileChange}
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div class="space-y-6 pointer-events-none">
                <div
                    class="text-7xl group-hover:scale-110 transition-transform duration-300"
                >
                    📼
                </div>
                <div>
                    <h3 class="text-2xl uppercase tracking-[0.2em] mb-2">
                        Drop Video
                    </h3>
                    <p class="text-[#555] text-xs">
                        Instant Last Frame Extraction
                    </p>
                </div>
            </div>
        </div>
    {:else}
        <!-- Processing / Result View -->
        <div
            class="border border-[#333] rounded-xl p-8 bg-[#050505] flex flex-col items-center justify-center min-h-[400px]"
        >
            <!-- Hidden Video Element for Processing -->
            <!-- svelte-ignore a11y-media-has-caption -->
            <video
                bind:this={videoRef}
                src={videoSrc}
                class="hidden"
                on:loadedmetadata={onMetadataLoaded}
                muted
                playsinline
            ></video>
            <canvas bind:this={canvasRef} class="hidden"></canvas>

            {#if isProcessing}
                <div class="flex flex-col items-center animate-pulse gap-4">
                    <div
                        class="w-12 h-12 border-4 border-[#333] border-t-[#9ae600] rounded-full animate-spin"
                    ></div>
                    <p class="text-[#9ae600] uppercase tracking-widest text-sm">
                        Seeking End of Tape...
                    </p>
                </div>
            {:else if extractedImage}
                <div
                    class="w-full max-w-4xl space-y-6 animate-in fade-in duration-500"
                >
                    <div
                        class="relative group border border-[#222] rounded-lg overflow-hidden bg-black/50 shadow-2xl shadow-black"
                    >
                        <img
                            src={extractedImage}
                            alt="Last frame"
                            class="w-full h-auto object-contain"
                        />
                        <div
                            class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none"
                        ></div>
                    </div>

                    <div class="flex items-center justify-center gap-6">
                        <button
                            on:click={reset}
                            class="px-6 py-3 rounded border border-[#333] text-[#777] hover:text-[#bbb] hover:border-[#555] transition-all text-xs uppercase tracking-widest"
                        >
                            Start Over
                        </button>
                        <button
                            on:click={copyImage}
                            class="px-6 py-3 rounded border border-[#9ae600] text-[#9ae600] hover:bg-[#9ae600]/10 transition-all text-sm uppercase tracking-widest"
                        >
                            Copy
                        </button>
                        <button
                            on:click={downloadImage}
                            class="bg-[#9ae600] text-black px-8 py-3 rounded font-bold hover:bg-[#b0ff00] hover:scale-105 transition-all shadow-[0_0_20px_rgba(154,230,0,0.3)] text-sm uppercase tracking-widest"
                        >
                            Download PNG
                        </button>
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>
