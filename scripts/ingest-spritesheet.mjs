
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
        image.resize(GRID.totalW, GRID.totalH, { fit: 'fill' });
    }

    // Remove White Background (Make Transparent)
    // Get raw pixel data
    const { data, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Iterate pixels (4 channels: R, G, B, A)
    let transparentCount = 0;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Check if near white (tolerance of 20)
        if (r > 235 && g > 235 && b > 235) {
            data[i + 3] = 0; // Set Alpha to 0
            transparentCount++;
        }
    }
    console.log(`[Ingest] Made ${transparentCount} pixels transparent.`);

    // Create new Sharp instance from modified buffer
    const finalBuffer = await sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: 4
        }
    }).png().toBuffer();

    // Overwrite the file with the corrected version
    fs.writeFileSync(INPUT_PATH, finalBuffer);
    console.log(`[Ingest] Fixed image dimensions/transparency and saved to ${INPUT_PATH}`);

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
