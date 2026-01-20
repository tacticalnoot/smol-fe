
const { getDomain, getPublicSuffix } = require('tldts');

const hosts = [
    'smol.xyz',
    'noot.smol.xyz',
    'foo.pages.dev',
    'bar.vercel.app',
    'pages.dev',
    'localhost'
];

console.log('--- Domain Debug ---');
hosts.forEach(h => {
    const d = getDomain(h);
    const s = getPublicSuffix(h);
    console.log(`Host: ${h}`);
    console.log(`  Domain: ${d}`);
    console.log(`  Suffix: ${s}`);

    // Logic from src/utils/domains.ts
    const blockedDomains = ['pages.dev', 'vercel.app', 'netlify.app', 'herokuapp.com'];
    let safeRpId = d;

    if (!d || !s || d === s || blockedDomains.includes(d)) {
        safeRpId = undefined;
    }
    console.log(`  Safe RP ID: ${safeRpId}`);
    console.log('---');
});
