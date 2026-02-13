
import type { APIRoute } from 'astro';
import { verifyChallengeTx } from '../../../../lib/the-vip/auth';
import { Keypair } from '@stellar/stellar-sdk';


import { initDb, getDb } from '../../../../lib/the-vip/db';


export const POST: APIRoute = async ({ request, env }) => {
    try {
        const body = await request.json() as { xdr?: string, address?: string, zkProof?: any, sessionKey?: string };

        let authenticatedAddress = '';
        let sessionType = 'wallet';

        // 1. ZK Auth Flow
        if (body.zkProof) {
            console.log("Verifying ZK Proof...");
            const { proof, publicInputs } = body.zkProof;
            const sessionKey = body.sessionKey;

            if (!sessionKey) return new Response(JSON.stringify({ error: 'Session Key required for ZK Auth' }), { status: 400 });

            // Dynamic import to avoid load on non-zk paths
            let Noir, BarretenbergBackend, circuit;
            try {
                const noirModule = await import('@noir-lang/noir_js');
                const backendModule = await import('@noir-lang/backend_barretenberg');
                // @ts-ignore
                const circuitModule = await import('../../../../../zk/noir-tier/target/the_farm_noir.json');

                Noir = noirModule.Noir;
                BarretenbergBackend = backendModule.BarretenbergBackend;
                circuit = circuitModule.default;
            } catch (e) {
                console.error("ZK Import Error (Local Dev):", e);
                // Detection for Vite/SSR environment failure
                if (import.meta.env.DEV) {
                    return new Response(JSON.stringify({
                        error: 'ZK Verification requires Cloudflare Runtime. Run `pnpm dev:cf` to test verification locally.'
                    }), { status: 500 });
                }
                throw e;
            }

            const backend = new BarretenbergBackend(circuit);
            const noir = new Noir(circuit, backend);

            const valid = await noir.verifyFinalProof({
                proof: new Uint8Array(proof),
                publicInputs: publicInputs
            });

            if (!valid) {
                return new Response(JSON.stringify({ error: 'Invalid ZK Proof' }), { status: 401 });
            }

            // 2. Validate Session Binding
            const provenKey = publicInputs[1];
            const normalize = (s: string) => s.toLowerCase().replace(/^0x0+/, '0x').replace(/^0x/, '');

            if (normalize(provenKey) !== normalize(sessionKey)) {
                console.log("Session Key Mismatch");
                return new Response(JSON.stringify({ error: 'Proof does not bind to this session key' }), { status: 401 });
            }

            // 3. Replay Protection (Check DB)
            const db = await getDb(env);
            await initDb(db);

            const used = await db.prepare('SELECT 1 FROM used_session_keys WHERE key_hash = ?').bind(normalize(sessionKey)).first();
            if (used) {
                return new Response(JSON.stringify({ error: 'Session Key already used (Replay attack?)' }), { status: 401 });
            }

            // Mark key as used (TTL 10 mins)
            await db.prepare('INSERT INTO used_session_keys (key_hash, created_at, expires_at) VALUES (?, ?, ?)')
                .bind(normalize(sessionKey), Date.now(), Date.now() + 600 * 1000)
                .run();

            // Success
            authenticatedAddress = 'zk-' + sessionKey.slice(0, 8);
            sessionType = 'zk';

        }
        // 2. Wallet Auth Flow
        else if (body.xdr && body.address) {
            const serverSecret = (env as any).CHAT_SERVER_SECRET || 'SDHOAMBNLGCE2MV5XK4J53L3JX5L3JX5L3JX5L3JX5L3JX5L3JX5L3JX5L3JX';
            const serverKeypair = Keypair.fromSecret(serverSecret);
            const networkPassphrase = (env as any).PUBLIC_NETWORK_PASSPHRASE || 'Public Global Stellar Network ; September 2015';

            const result = await verifyChallengeTx(body.xdr, body.address, networkPassphrase, serverKeypair.publicKey());

            if (!result.valid) {
                return new Response(JSON.stringify({ error: result.error }), { status: 401 });
            }
            authenticatedAddress = body.address;
        } else {
            return new Response(JSON.stringify({ error: 'Invalid auth request' }), { status: 400 });
        }

        // Issue Token
        const token = crypto.randomUUID();
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

        const db = await getDb(env);
        await initDb(db);

        // Ensure tables exist
        await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            address TEXT NOT NULL,
            type TEXT DEFAULT 'wallet',
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS used_session_keys (
            key_hash TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        `);

        try { await db.exec(`ALTER TABLE sessions ADD COLUMN type TEXT DEFAULT 'wallet'`); } catch { }

        await db.prepare('INSERT INTO sessions (token, address, type, expires_at) VALUES (?, ?, ?, ?)')
            .bind(token, authenticatedAddress, sessionType, expiresAt)
            .run();

        return new Response(JSON.stringify({ token, address: authenticatedAddress }), { status: 200 });

    } catch (e: any) {
        console.error("ZK Verify Error:", e); // Log full error
        return new Response(JSON.stringify({ error: e.message || 'Unknown verification error' }), { status: 500 });
    }
};
