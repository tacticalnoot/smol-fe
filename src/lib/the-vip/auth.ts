import { StrKey, Transaction, Utils, Keypair, Networks } from '@stellar/stellar-sdk';

/**
 * Validates a SEP-0010 challenge transaction.
 */
export async function verifyChallengeTx(
    challengeXdr: string,
    clientAddress: string,
    networkPassphrase: string,
    serverAddress: string
) {
    try {
        const tx = new Transaction(challengeXdr, networkPassphrase);

        if (tx.sequence !== '0') {
            return { valid: false, error: 'Invalid sequence number' };
        }

        if (!tx.timeBounds) {
            return { valid: false, error: 'Missing time bounds' };
        }

        const now = Math.floor(Date.now() / 1000);
        if (now < Number(tx.timeBounds.minTime) || now > Number(tx.timeBounds.maxTime)) {
            return { valid: false, error: 'Expired challenge' };
        }

        if (tx.source !== serverAddress) {
            return { valid: false, error: 'Invalid server source' };
        }

        // Verify signature
        // For MVP we trust Utils.verifyTransactionSignature for Ed25519
        // For Smart Wallets, we might need to rely on the fact that the client *could* sign it.
        // Real strict SEP-0010 requires verifying the specific signer weight.
        // Here we check if the claimed address (or its signers) signed it.

        // Attempt standard verification first
        try {
            if (Utils.verifyTransactionSignature(tx, clientAddress, networkPassphrase)) {
                return { valid: true };
            }
        } catch (e) {
            // Fallback for smart wallets or complex signers?
        }

        return { valid: false, error: 'Signature verification failed' };

    } catch (e: any) {
        return { valid: false, error: e.message };
    }
}

export function buildChallenge(serverSecret: string, clientAddress: string, networkPassphrase: string) {
    const serverKeypair = Keypair.fromSecret(serverSecret);
    return Utils.buildChallengeTx(
        serverKeypair,
        clientAddress,
        'smol.xyz', // Domain
        networkPassphrase === Networks.PUBLIC ? 300 : 300,
        networkPassphrase
    );
}

export async function getSession(request: Request, db: D1Database) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.split(' ')[1];

    // Check DB
    // We assume `initDb` has run at least once globally or we catch error
    // Simple query
    try {
        const session = await db.prepare('SELECT address, expires_at FROM sessions WHERE token = ?').bind(token).first();
        if (!session) return null;

        if (Date.now() > (session.expires_at as number)) {
            // cleanup?
            return null;
        }
        return { address: session.address as string };
    } catch (e) {
        console.error("Session check failed", e);
        return null;
    }
}
