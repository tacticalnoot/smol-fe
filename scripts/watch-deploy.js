
import https from 'https';

const URL = process.argv[2] || 'https://smol-fe-7jl.pages.dev';
const POLLING_INTERVAL = 15000; // 15 seconds

console.log(`\x1b[36m[Watcher]\x1b[0m Watching for deployment updates on: \x1b[1m${URL}\x1b[0m`);

let lastEtag = null;
let lastModified = null;
let firstRun = true;

function checkDeployment() {
    https.get(URL, (res) => {
        const newEtag = res.headers['etag'];
        const newModified = res.headers['last-modified'];

        if (firstRun) {
            lastEtag = newEtag;
            lastModified = newModified;
            firstRun = false;
            console.log(`\x1b[90m[Init]\x1b[0m Baseline established. ETag: ${lastEtag || 'N/A'}, Mod: ${lastModified || 'N/A'}`);
            console.log(`\x1b[90m[Init]\x1b[0m Waiting for changes...`);
        } else {
            const etagChanged = newEtag && newEtag !== lastEtag;
            const modifiedChanged = newModified && newModified !== lastModified;

            if (etagChanged || modifiedChanged) {
                console.log('\n\x1b[32m\x1b[1m🚀 DEPLOYMENT DETECTED! 🚀\x1b[0m');
                console.log(`\x1b[32m----------------------------------------\x1b[0m`);
                if (etagChanged) console.log(`New ETag: ${newEtag}`);
                if (modifiedChanged) console.log(`New Modified: ${newModified}`);
                console.log(`\x1b[32m----------------------------------------\x1b[0m`);

                // Play a beep (terminal bell)
                process.stdout.write('\x07');

                // Update baseline to avoid repeated alerts for the same deploy
                lastEtag = newEtag;
                lastModified = newModified;
            } else {
                process.stdout.write('.');
            }
        }
    }).on('error', (err) => {
        console.error(`\n\x1b[31m[Error]\x1b[0m Failed to fetch ${URL}: ${err.message}`);
    });
}

// Start polling
checkDeployment();
setInterval(checkDeployment, POLLING_INTERVAL);
