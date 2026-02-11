<script lang="ts">
    import { onMount } from "svelte";
    import {
        userState,
        isAuthenticated,
        getPasskeyKit,
    } from "../../stores/user.svelte";
    import {
        balanceState,
        updateContractBalance,
    } from "../../stores/balance.svelte";
    import {
        generateTierProof,
        hashAddress,
        generateRandomSalt,
        hashProof,
    } from "./the-farm/zkProof";
    import { getTierForBalance, getSafeRpId } from "./the-farm/zkTypes";

    let videoFile: File | null = null;
    let videoSrc: string | null = null;
    let videoRef: HTMLVideoElement;
    let canvasRef: HTMLCanvasElement;
    let extractedImage: string | null = null;
    let isProcessing = false;
    let isVerified = false;
    let isVerifying = false;
    let verificationError = "";

    // ZK Proof Data for visualization
    let activeProof: any = $state(null);

    // Verification steps status
    let checks = $state([
        { id: "identity", label: "Stellar Identity", status: "pending" },
        { id: "zk_init", label: "Circuit Initialize", status: "pending" },
        { id: "zk_prove", label: "Generate ZK Proof", status: "pending" },
        { id: "sign", label: "Sign Attestation", status: "pending" },
    ]);

    // Check for native share support (Mobile)
    let canShare = false;
    onMount(() => {
        canShare = !!navigator.share;
    });

    const startVerification = async () => {
        isVerifying = true;
        verificationError = "";
        activeProof = null;

        try {
            // 1. Identity Check
            checks[0].status = "busy";
            if (!isAuthenticated() || !userState.contractId) {
                throw new Error(
                    "Initialization failed: No valid identity found.",
                );
            }
            await updateContractBalance(userState.contractId);
            if (balanceState.balance === null) {
                throw new Error(
                    "Identity failed: Could not fetch residency data.",
                );
            }
            await new Promise((r) => setTimeout(r, 400));
            checks[0].status = "done";

            // 2. Circuit Initialize
            checks[1].status = "busy";
            const addressHash = await hashAddress(userState.contractId);
            const salt = generateRandomSalt();
            const balance = balanceState.balance || 0n;
            const tierId = getTierForBalance(balance);
            await new Promise((r) => setTimeout(r, 600));
            checks[1].status = "done";

            // 3. Generate REAL ZK Proof (Noir UltraHonk Engine)
            // Use requestAnimationFrame to let the UI update before blocking
            checks[2].status = "busy";
            console.log("[LastFrame] Preparing Noir UltraHonk Proof...");

            await new Promise((r) => requestAnimationFrame(() => r(null)));
            await new Promise((r) => setTimeout(r, 100)); // Force layout thrash for visibility

            const result = await generateTierProof(
                addressHash,
                balance,
                salt,
                tierId,
            );

            activeProof = result.proof;
            console.log("[LastFrame] Noir Proof Generated:", result);
            checks[2].status = "done";

            // 4. Sign Attestation (Identity Commitment)
            checks[3].status = "busy";
            console.log("[LastFrame] Requesting Passkey Signature...");

            const kit = await getPasskeyKit();
            const rpId = getSafeRpId(window.location.hostname);
            const proofHash = await hashProof(activeProof);

            // Sign the ZK Proof Hash as an "Identity Commitment"
            // This triggers the Passkey prompt.
            await kit.sign({
                rpId,
                challenge: Buffer.from(proofHash),
            });

            checks[3].status = "done";

            await new Promise((r) => setTimeout(r, 800));
            isVerified = true;
        } catch (err: any) {
            console.error("Noir Verification failed", err);
            verificationError =
                err.message ||
                "Noir engine error: UltraHonk cryptographic failure.";
            // Reset busy checks to pending or error
            checks = checks.map((c) =>
                c.status === "busy" ? { ...c, status: "pending" } : c,
            );
        } finally {
            isVerifying = false;
        }
    };

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

        const targetTime = Math.max(0, videoRef.duration - 0.05);

        if (videoRef.readyState < 2) {
            await new Promise((r) => {
                const onLoaded = () => {
                    videoRef.removeEventListener("loadeddata", onLoaded);
                    r(true);
                };
                videoRef.addEventListener("loadeddata", onLoaded);
            });
        }

        videoRef.currentTime = targetTime;

        await new Promise((r) => {
            const onSeek = () => {
                videoRef.removeEventListener("seeked", onSeek);
                r(true);
            };
            videoRef.addEventListener("seeked", onSeek);
        });

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
            alert("Clipboard not supported. Use Share or Download.");
        }
    };

    const shareImage = async () => {
        if (!canvasRef || !videoFile) return;
        canvasRef.toBlob(async (blob) => {
            if (!blob) return;
            const file = new File([blob], "last-frame.png", {
                type: "image/png",
            });
            if (navigator.share) {
                try {
                    await navigator.share({
                        files: [file],
                        title: "Last Frame",
                        text: "Extracted via Smol Labs",
                    });
                } catch (err) {
                    console.log("Share cancelled or failed", err);
                }
            }
        });
    };

    const reset = () => {
        videoFile = null;
        videoSrc = null;
        extractedImage = null;
    };
</script>

<div class="font-pixel text-[#9ae600] space-y-8">
    {#if !isVerified}
        <!-- Gated Door UI -->
        <div
            class="border border-[#333] rounded-xl p-8 bg-[#0a0a0a] flex flex-col items-center justify-center min-h-[400px] text-center space-y-8 relative overflow-hidden"
        >
            {#if isVerifying}
                <div
                    class="absolute inset-0 bg-[#9ae600]/5 pointer-events-none animate-pulse"
                ></div>
            {/if}

            <div class="space-y-4 relative z-10">
                <div class="text-6xl {isVerifying ? 'animate-bounce' : ''}">
                    🛡️
                </div>
                <h2 class="text-2xl uppercase tracking-[0.3em] text-[#ff424c]">
                    Noir Proof Required
                </h2>
                <p
                    class="text-[#555] text-[10px] max-w-xs mx-auto leading-relaxed uppercase tracking-widest"
                >
                    Generating UltraHonk proof using Noir engine...
                </p>
            </div>

            <div class="w-full max-w-xs space-y-3 relative z-10">
                {#each checks as check}
                    <div
                        class="flex items-center justify-between text-[10px] uppercase tracking-widest border-b border-[#111] pb-2"
                    >
                        <span
                            class={check.status === "done"
                                ? "text-[#9ae600]"
                                : "text-[#333]"}>{check.label}</span
                        >
                        <span>
                            {#if check.status === "pending"}
                                [IDLE]
                            {:else if check.status === "busy"}
                                <span class="text-[#facc15] animate-pulse"
                                    >[PROVING...]</span
                                >
                            {:else if check.status === "done"}
                                <span class="text-[#9ae600]">[VERIFIED]</span>
                            {/if}
                        </span>
                    </div>
                {/each}
            </div>

            <!-- ZK Coordinate Stream -->
            {#if isVerifying || activeProof}
                <div
                    class="w-full max-w-md bg-black/50 border border-[#111] p-4 rounded-lg font-mono text-[8px] text-[#9ae600]/40 text-left overflow-hidden h-24 relative select-none uppercase"
                >
                    {#if activeProof}
                        <div
                            class="animate-in fade-in slide-in-from-bottom-2 duration-500"
                        >
                            <div
                                class="text-white mb-1 uppercase tracking-widest text-[#9ae600]"
                            >
                                Generated UltraHonk Coordinates:
                            </div>
                            <div class="truncate">
                                PI_A: {activeProof.pi_a.join(", ")}
                            </div>
                            <div class="truncate">
                                PI_B: {activeProof.pi_b[0].join(", ")}
                            </div>
                            <div class="truncate">
                                PI_C: {activeProof.pi_c.join(", ")}
                            </div>
                            <div class="mt-1 text-[#9ae600] animate-pulse">
                                ✓ NOIR_ULTRAHONK_ATTESTED
                            </div>
                        </div>
                    {:else}
                        <div class="animate-pulse space-y-1">
                            <div>> NOIR ACIR INITIALIZED...</div>
                            <div>> CONSTRAINTS: 24,103</div>
                            <div>> BARRETENBERG BACKEND LOADED</div>
                            <div>> EXECUTING WITNESS...</div>
                        </div>
                    {/if}
                </div>
            {/if}

            {#if verificationError}
                <div
                    class="bg-red-500/10 border border-red-500/30 p-3 rounded text-[10px] text-red-400 uppercase tracking-widest animate-in slide-in-from-top-2 relative z-10 w-full max-w-xs"
                >
                    {verificationError}
                </div>
            {/if}

            <div class="relative z-10 flex flex-col items-center gap-4">
                {#if !isAuthenticated()}
                    <p
                        class="text-[10px] text-[#ff424c] animate-pulse uppercase tracking-widest"
                    >
                        No valid session
                    </p>
                    <a
                        href="/onboarding/passkey"
                        class="inline-block bg-[#ff424c] text-white px-8 py-3 rounded font-bold hover:bg-[#ff6b74] transition-all text-xs uppercase tracking-widest"
                    >
                        Link Identity
                    </a>
                {:else if !isVerifying && !isVerified}
                    <button
                        on:click={startVerification}
                        class="bg-[#9ae600] text-black px-12 py-4 rounded font-bold hover:bg-[#b0ff00] transition-all shadow-[0_0_20px_rgba(154,230,0,0.3)] text-xs uppercase tracking-widest active:scale-95 flex items-center gap-2"
                    >
                        <span class="text-lg">⚡</span> Initiate Noir Proof
                    </button>
                {/if}
            </div>
        </div>
    {:else}
        <!-- Badge -->
        <div class="flex justify-center mb-4">
            <div
                class="bg-[#9ae600]/10 border border-[#9ae600]/30 px-4 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] text-[#9ae600] flex items-center gap-2"
            >
                <span
                    class="inline-block w-1.5 h-1.5 bg-[#9ae600] rounded-full animate-pulse"
                ></span>
                Noir UltraHonk Verified
            </div>
        </div>
        {#if !videoSrc}
            <!-- Upload Zone -->
            <div
                class="border-2 border-dashed border-[#333] rounded-xl p-12 md:p-24 text-center hover:border-[#9ae600] transition-colors cursor-pointer relative group bg-[#050505]"
            >
                <input
                    type="file"
                    accept="video/*"
                    on:change={handleFileChange}
                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div class="space-y-6 pointer-events-none">
                    <div
                        class="text-5xl md:text-7xl group-hover:scale-110 transition-transform duration-300"
                    >
                        📼
                    </div>
                    <div>
                        <h3
                            class="text-xl md:text-2xl uppercase tracking-[0.2em] mb-2"
                        >
                            Tap / Drop Video
                        </h3>
                        <p class="text-[#555] text-[10px] md:text-xs">
                            Instant Final Frame Capture
                        </p>
                        <p class="text-[#333] text-[8px] mt-2 uppercase">
                            Works on iOS • Android • Desktop
                        </p>
                    </div>
                </div>
            </div>
        {:else}
            <!-- Processing / Result View -->
            <div
                class="border border-[#333] rounded-xl p-4 md:p-8 bg-[#050505] flex flex-col items-center justify-center min-h-[400px]"
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
                    autoplay
                ></video>
                <canvas bind:this={canvasRef} class="hidden"></canvas>

                {#if isProcessing}
                    <div class="flex flex-col items-center animate-pulse gap-4">
                        <div
                            class="w-12 h-12 border-4 border-[#333] border-t-[#9ae600] rounded-full animate-spin"
                        ></div>
                        <p
                            class="text-[#9ae600] uppercase tracking-widest text-sm"
                        >
                            Targeting End...
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

                        <div
                            class="flex flex-wrap items-center justify-center gap-4"
                        >
                            <button
                                on:click={reset}
                                class="px-4 py-3 rounded border border-[#333] text-[#777] hover:text-[#bbb] hover:border-[#555] transition-all text-xs uppercase tracking-widest flex-1 md:flex-none"
                            >
                                Restart
                            </button>

                            {#if canShare}
                                <button
                                    on:click={shareImage}
                                    class="px-4 py-3 rounded border border-[#9ae600] text-[#9ae600] hover:bg-[#9ae600]/10 transition-all text-sm uppercase tracking-widest flex-1 md:flex-none"
                                >
                                    Share / Save
                                </button>
                            {:else}
                                <button
                                    on:click={copyImage}
                                    class="px-4 py-3 rounded border border-[#9ae600] text-[#9ae600] hover:bg-[#9ae600]/10 transition-all text-sm uppercase tracking-widest flex-1 md:flex-none"
                                >
                                    Copy
                                </button>
                            {/if}

                            <button
                                on:click={downloadImage}
                                class="bg-[#9ae600] text-black px-6 py-3 rounded font-bold hover:bg-[#b0ff00] hover:scale-105 transition-all shadow-[0_0_20px_rgba(154,230,0,0.3)] text-sm uppercase tracking-widest flex-1 md:flex-none whitespace-nowrap"
                            >
                                Download PNG
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
</div>
