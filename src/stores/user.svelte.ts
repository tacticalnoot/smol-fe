/**
 * User authentication state using Svelte 5 runes
 */

// Initialize from localStorage if available (client-side only)
const storedContractId = typeof localStorage !== "undefined" ? localStorage.getItem("smol:contractId") : null;
const storedKeyId = typeof localStorage !== "undefined" ? localStorage.getItem("smol:keyId") : null;

export const userState = $state<{
  contractId: string | null;
  keyId: string | null;
  walletConnected: boolean;
}>({
  contractId: storedContractId,
  keyId: storedKeyId,
  walletConnected: false,
});

// Derived state function
export function isAuthenticated(): boolean {
  return userState.contractId !== null && userState.keyId !== null;
}

/**
 * Set contract ID
 */
export function setContractId(id: string | null) {
  userState.contractId = id;
  if (typeof localStorage !== "undefined") {
    if (id) localStorage.setItem("smol:contractId", id);
    else localStorage.removeItem("smol:contractId");
  }
}

/**
 * Set key ID
 */
export function setKeyId(id: string | null) {
  userState.keyId = id;
  if (typeof localStorage !== "undefined") {
    if (id) localStorage.setItem("smol:keyId", id);
    else localStorage.removeItem("smol:keyId");
  }
}

/**
 * Set both contract and key ID
 */
export function setUserAuth(contractId: string | null, keyId: string | null) {
  userState.contractId = contractId;
  userState.keyId = keyId;

  if (typeof localStorage !== "undefined") {
    if (contractId) localStorage.setItem("smol:contractId", contractId);
    if (keyId) localStorage.setItem("smol:keyId", keyId);
  }
}

/**
 * Clear authentication
 * Now properly clears localStorage to prevent stale credentials from blocking re-login
 */
export function clearUserAuth() {
  userState.contractId = null;
  userState.keyId = null;
  userState.walletConnected = false;

  if (typeof localStorage !== "undefined") {
    // Hard logout: Remove credentials to prevent stale passkey issues
    localStorage.removeItem("smol:contractId");
    localStorage.removeItem("smol:keyId");
    localStorage.removeItem("smol:skip_intro"); // Optional: reset intro
  }
}

/**
 * Ensure the passkey account wallet is connected
 * This should be called once during app initialization when user is authenticated
 *
 * PERFORMANCE: Uses dynamic import to lazy-load smart-account-kit only when needed
 */
export async function ensureWalletConnected(): Promise<void> {
  // Only connect if we have auth credentials and haven't connected yet
  if (userState.contractId && userState.keyId && !userState.walletConnected) {
    try {
      // Lazy load smart-account-kit module (reduces initial bundle size)
      const { getLastConnection, silentRestore } = await import('../lib/wallet/smartAccount');

      const connected = await silentRestore({
        credentialId: userState.keyId,
        contractId: userState.contractId,
      });
      const session = getLastConnection();

      if (connected && session?.contractId) {
        setUserAuth(session.contractId, session.credentialId);
        userState.walletConnected = true;
        return;
      }

      throw new Error('No stored smart account session found');
    } catch (error) {
      console.error('[userState] Failed to connect wallet (stale?):', error);
      // AUTO-BURN: If the saved key fails to connect, wipe it so the user isn't stuck.
      clearUserAuth();
    }
  }
}

/**
 * Get contract ID (read-only accessor)
 */
export function getContractId(): string | null {
  return userState.contractId;
}

/**
 * Get key ID (read-only accessor)
 */
export function getKeyId(): string | null {
  return userState.keyId;
}
