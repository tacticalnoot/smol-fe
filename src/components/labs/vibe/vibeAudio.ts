
import { audioState } from "../../../stores/audio.svelte";

let lastBeatTime = 0;
const BEAT_COOLDOWN = 250; // ms between beats (max ~240bpm)

export function getAudioMetrics() {
    const { analyser } = audioState;

    if (!analyser) {
        return { beat: 0, treble: 0, raw: 0 };
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Simple Kick Detection (Low Frequencies)
    // Bin 0-4 (roughly 0-100hz depending on fftSize)
    let bassSum = 0;
    for (let i = 0; i < 4; i++) {
        bassSum += dataArray[i];
    }
    const bassLevel = bassSum / 4 / 255;

    // Treble Detection (High Frequencies)
    // Upper 20% of bins
    let trebleSum = 0;
    const startBin = Math.floor(bufferLength * 0.8);
    for (let i = startBin; i < bufferLength; i++) {
        trebleSum += dataArray[i];
    }
    const trebleLevel = trebleSum / (bufferLength - startBin) / 255;

    // Beat Trigger
    const now = Date.now();
    let beat = 0;
    if (bassLevel > 0.8 && (now - lastBeatTime > BEAT_COOLDOWN)) {
        beat = 1.0;
        lastBeatTime = now;
    }

    return {
        beat,        // 1.0 on beat hit, else 0
        treble: trebleLevel, // 0..1 continuous
        raw: bassLevel // 0..1 continuous bass
    };
}
