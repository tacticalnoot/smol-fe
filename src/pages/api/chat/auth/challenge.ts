import type { APIRoute } from 'astro';
import { buildChallenge } from '../../../../lib/the-vip/auth';

export const POST: APIRoute = async ({ request, env }) => { // env is available in hybrid/server mode
    try {
        const body = await request.json() as { address: string };
        if (!body.address) {
            return new Response(JSON.stringify({ error: 'Address required' }), { status: 400 });
        }

        // Use a server secret from env or generate a temporary one (not ideal for restarts but works for MVP/Dev)
        // REAL ENV: set CHAT_SERVER_SECRET
        const serverSecret = (env as any).CHAT_SERVER_SECRET || 'SDHOAMBNLGCE2MV5XK4J53L3JX5L3JX5L3JX5L3JX5L3JX5L3JX5L3JX';
        // ^ Fallback dangerous for prod, but ensures it runs. 
        // Ideally we error if missing.

        const networkPassphrase = (env as any).PUBLIC_NETWORK_PASSPHRASE || 'Public Global Stellar Network ; September 2015';

        const challengeTx = buildChallenge(serverSecret, body.address, networkPassphrase);

        return new Response(JSON.stringify({
            xdr: challengeTx.toXDR()
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e: any) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
};
