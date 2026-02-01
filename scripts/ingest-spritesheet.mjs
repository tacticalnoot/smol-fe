
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const INPUT_PATH = 'public/sprites/sprout_v1.png';
const OUTPUT_MAP_PATH = 'public/sprites/sprout_v1.json';

const GRID = {
    cols: 8,
    rows: 5,
    cellW: 32,
    cellH: 32,
    totalW: 256,
    totalH: 160
};

const ANIMATIONS = {
    IDLE: [0, 1, 2, 3],
    WANDER: [8, 9, 10, 11, 12, 13],
    EAT: [16, 17, 18, 19],
    RAVE: [24, 25, 26, 27],
    SLEEP: [32, 33]
};

async function ingest() {
    console.log(`[Ingest] Reading ${INPUT_PATH}...`);

    if (!fs.existsSync(INPUT_PATH)) {
        console.error(`Error: File not found: ${INPUT_PATH}`);
        process.exit(1);
    }

    // Read to buffer first to avoid file lock issues when overwriting
    const inputBuffer = fs.readFileSync(INPUT_PATH);
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    console.log(`[Ingest] Dimensions: ${metadata.width}x${metadata.height}`);

    // Resize if needed (Force fit to grid)
    if (metadata.width !== GRID.totalW || metadata.height !== GRID.totalH) {
        console.warn(`[Ingest] Resizing image from ${metadata.width}x${metadata.height} to ${GRID.totalW}x${GRID.totalH}`);

        // We resize without maintaining aspect ratio if it's close, or contain if not.
        // Ideally for pixel art sprite sheets, we want exact pixels, but for a prototype/AI asset,
        // resizing to fit the grid is the best localized fix.
        // using 'fill' might distort, but ensures grid alignment.

        const resizedBuffer = await image
            .resize(GRID.totalW, GRID.totalH, { fit: 'fill' })
            .toBuffer();

        // Overwrite the file with the corrected version so the web app serves the correct size
        // Use fs.writeFileSync to act as atomic write
        fs.writeFileSync(INPUT_PATH, resizedBuffer);
        console.log(`[Ingest] Fixed image dimensions and saved to ${INPUT_PATH}`);
    }

    // Generate Map
    const mapKey = {
        meta: {
            image: 'sprout_v1.png',
            ...GRID
        },
        animations: ANIMATIONS,
        frames: {} // Optional: we could calculate specific rects if needed, but grid + index is enough for CSS
    };

    fs.writeFileSync(OUTPUT_MAP_PATH, JSON.stringify(mapKey, null, 2));
    console.log(`[Ingest] Success! Map written to ${OUTPUT_MAP_PATH}`);
}

ingest().catch(e => {
    console.error(e);
    process.exit(1);
});
