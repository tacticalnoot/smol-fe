/**
 * Smol ID — SWK Module for PasskeyKit smart accounts.
 *
 * Embeds passkey auth as the first option in the Stellar Wallets Kit modal.
 * Uses the same PasskeyKit singleton + connectWallet() flow as the rest of the app.
 *
 * If the user is already logged in (contractId/keyId in localStorage),
 * getAddress() reuses those credentials without re-prompting.
 */
import { type ModuleInterface, ModuleType } from '@creit.tech/stellar-wallets-kit';
import { account } from '../../utils/passkey-kit';
import { getSafeRpId } from '../../utils/domains';
import { safeLocalStorageGet, safeLocalStorageSet } from '../../utils/storage';

// Cache from the most recent connectWallet() call.
let _cachedKeyId: string | null = null;

function storedContractId(): string | null {
    return safeLocalStorageGet('smol:contractId');
}
function storedKeyId(): string | null {
    return safeLocalStorageGet('smol:keyId');
}

export const SMOL_ID_MODULE: ModuleInterface = {
    productId: 'smol-id',
    productName: 'Smol ID 🥬',
    productUrl: 'https://smol.xyz',
    productIcon: 'https://smol.xyz/favicon.ico',
    moduleType: ModuleType.HW_WALLET,

    isAvailable: async () => true,

    /**
     * Return the smart-account contractId as the "address".
     * If the user already has credentials cached, reuse them (silent reconnect).
     * Otherwise, trigger a fresh passkey prompt via connectWallet().
     */
    getAddress: async () => {
        const kit = await account.get();
        const existing = storedContractId();
        const existingKey = storedKeyId();

        if (existing && existingKey) {
            // Silent reconnect — reuse cached credentials, no passkey prompt.
            const rpId = getSafeRpId(window.location.hostname);
            try {
                await kit.connectWallet({
                    rpId,
                    keyId: existingKey,
                    getContractId: async () => existing,
                });
                _cachedKeyId = existingKey;
                return { address: existing };
            } catch (e) {
                // Cached credentials stale, fall through to fresh prompt.
                console.warn('[SmolID] Silent reconnect failed, prompting fresh:', e);
            }
        }

        // Fresh passkey prompt.
        const rpId = getSafeRpId(window.location.hostname);
        const result = await kit.connectWallet({ rpId });
        _cachedKeyId = result.keyIdBase64;

        // Persist so future calls (and page reloads) can skip the prompt.
        safeLocalStorageSet('smol:contractId', result.contractId);
        safeLocalStorageSet('smol:keyId', result.keyIdBase64);

        return { address: result.contractId };
    },

    /**
     * Sign a transaction using PasskeyKit.sign().
     * Returns the signed XDR string for the SWK pipeline.
     */
    signTransaction: async (xdr: string) => {
        const kit = await account.get();
        const keyId = _cachedKeyId || storedKeyId() || undefined;
        const signed = await kit.sign(xdr, { keyId });
        // PasskeyKit.sign() returns an AssembledTransaction; extract the XDR.
        const signedTxXdr: string =
            typeof signed === 'string'
                ? signed
                : signed.built
                    ? signed.built.toXDR()
                    : signed.toXDR();
        return { signedTxXdr };
    },

    signAuthEntry: async (authEntry: string) => {
        const kit = await account.get();
        const keyId = _cachedKeyId || storedKeyId() || undefined;
        const signedAuthEntry = await kit.signAuthEntry(authEntry, { keyId });
        return { signedAuthEntry: typeof signedAuthEntry === 'string' ? signedAuthEntry : signedAuthEntry.toString() };
    },

    signMessage: async (_message: string) => {
        throw new Error('signMessage not supported by Smol ID — use signTransaction instead.');
    },

    getNetwork: async () => ({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
    }),
};
