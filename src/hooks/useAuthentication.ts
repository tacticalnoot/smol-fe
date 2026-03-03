/**
 * FACTORY FRESH: Unified Authentication Hook
 * @see https://deepwiki.com/repo/kalepail/smol-fe#authentication
 * 
 * Refactored to use DYNAMIC IMPORTS for heavy SDKs.
 */
import Cookies from 'js-cookie';
import { getDomain } from 'tldts';
// import { account, send } from '../utils/passkey-kit'; // REMOVED STATIC IMPORT
import { getSafeRpId } from '../utils/domains';
import { setUserAuth, clearUserAuth, userState } from '../stores/user.svelte';
import logger, { LogCategory } from '../utils/debug-logger';

export function useAuthentication() {
  const API_URL = import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";

  function parseAuthToken(rawBody: string, response: Response): string {
    const trimmedBody = rawBody.trim();
    if (trimmedBody) {
      if (trimmedBody.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmedBody) as Record<string, unknown>;
          const tokenFromJson = [parsed.token, parsed.authToken, parsed.accessToken].find(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          );
          if (tokenFromJson) return tokenFromJson.trim();
        } catch {
          // Fall through to plain-text handling.
        }
        throw new Error("Login response JSON did not include a session token.");
      }

      if (trimmedBody.startsWith('"') && trimmedBody.endsWith('"')) {
        try {
          const unquoted = JSON.parse(trimmedBody);
          if (typeof unquoted === "string" && unquoted.trim()) {
            return unquoted.trim();
          }
        } catch {
          // Fall through to raw body.
        }
      }

      return trimmedBody;
    }

    const authHeader =
      response.headers.get("authorization") || response.headers.get("Authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) return token;
    }

    throw new Error("Login response did not include a usable session token.");
  }

  async function login(): Promise<string> {
    console.log('[Auth] Login attempt...');
    const hostname = window.location.hostname;
    const primaryRpId = getSafeRpId(hostname);

    // Clear any stale credentials before logging in
    clearUserAuth();

    const { account } = await import('../utils/passkey-kit');

    // Try primary RP ID first (smol.xyz for subdomains)
    console.log('[Auth] Attempting login with RP ID:', primaryRpId, 'for hostname:', hostname);

    try {
      const kit = await account.get();
      const result = await kit.connectWallet({
        rpId: primaryRpId,
      });

      console.log('[Auth] connectWallet succeeded:', { contractId: result.contractId });

      const { rawResponse, keyIdBase64, contractId: cid } = result;
      return await performLogin(cid, keyIdBase64, rawResponse, 'connect', undefined, primaryRpId);
    } catch (err: any) {
      console.warn("[Auth] Login failed with RP ID:", primaryRpId, "Error:", err.message);

      // Check if this might be a "no credentials" error worth retrying with fallback
      const message = err.message?.toLowerCase() || '';
      const isNoCredentials =
        message.includes('no credentials') ||
        message.includes('not found') ||
        message.includes('no matching credentials') ||
        (message.includes('credential') && message.includes('not'));

      // If on a subdomain and no credentials found, try full hostname as fallback
      // (for passkeys created before the RP ID unification)
      const isSubdomain = hostname.endsWith('.smol.xyz') && hostname !== 'smol.xyz';

      if (isNoCredentials && isSubdomain && primaryRpId !== hostname) {
        console.log('[Auth] Trying fallback RP ID (full hostname):', hostname);

        try {
          const kit = await account.get();
          const result = await kit.connectWallet({
            rpId: hostname,
          });

          console.log('[Auth] Fallback succeeded with hostname RP ID:', { contractId: result.contractId });

          const { rawResponse, keyIdBase64, contractId: cid } = result;
          return await performLogin(cid, keyIdBase64, rawResponse, 'connect', undefined, hostname);
        } catch (fallbackErr: any) {
          console.warn("[Auth] Fallback also failed:", fallbackErr.message);
          // Fall through to throw original error
        }
      }

      // If we get here, both attempts failed (or wasn't worth retrying)
      throw err;
    }
  }

  async function performLogin(cid: string, keyIdBase64: string, rawResponse: any, type: 'connect' | 'create', username?: string, rpId?: string): Promise<string> {
    const payload = {
      type,
      keyId: keyIdBase64,
      contractId: cid,
      response: rawResponse,
      username,
      rpId: rpId || getSafeRpId(window.location.hostname),
    };

    logger.info(LogCategory.AUTH, "Login Payload", payload);

    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorMsg = text;
      try {
        const json = JSON.parse(text);
        errorMsg = json.error || json.message || text;
      } catch (e) { }
      throw new Error(`Login failed: ${errorMsg}`);
    }

    const responseBody = await res.text();
    const authToken = parseAuthToken(responseBody, res);

    setUserAuth(cid, keyIdBase64);
    userState.walletConnected = true;

    const { getSafeCookieDomain } = await import('../utils/domains');
    const domain = getSafeCookieDomain(window.location.hostname);

    const registrableDomain = getDomain(window.location.hostname);
    if (registrableDomain && registrableDomain !== domain?.replace(/^\./, '')) {
      Cookies.remove('smol_token', { domain: `.${registrableDomain}`, path: '/' });
      Cookies.remove('smol_token', { domain: registrableDomain, path: '/' });
    }

    Cookies.remove('smol_token', { path: '/' });

    const cookieOptions: Cookies.CookieAttributes = {
      path: '/',
      secure: window.location.protocol === 'https:',
      sameSite: window.location.protocol === 'https:' ? 'None' : 'Lax',
      expires: 30,
    };
    if (domain) {
      cookieOptions.domain = domain;
    }

    Cookies.set('smol_token', authToken, cookieOptions);
    return authToken;
  }

  async function signUp(username: string, turnstileToken: string) {
    console.log('[Auth] Creating wallet for username:', username);

    clearUserAuth();

    try {
      const { account, send } = await import('../utils/passkey-kit');
      const rpId = getSafeRpId(window.location.hostname);
      const result = await (await account.get()).createWallet(username, `SMOL — ${username}`, {
        rpId,
      });

      console.log('[Auth] Wallet created, contract ID:', result.contractId);

      const {
        rawResponse,
        keyIdBase64,
        contractId: cid,
        signedTx,
      } = result;

      await performLogin(cid, keyIdBase64, rawResponse, 'create', username);

      console.log('[Auth] Submitting wallet deployment transaction...');
      await send(signedTx, turnstileToken);

    } catch (err: any) {
      console.error("[Auth] SignUp failed:", err);
      throw err;
    }
  }

  async function logout() {
    clearUserAuth();

    const { getSafeCookieDomain } = await import('../utils/domains');
    const domain = getSafeCookieDomain(window.location.hostname);
    const registrableDomain = getDomain(window.location.hostname);

    const cookieOptions: Cookies.CookieAttributes = {
      path: '/',
      secure: window.location.protocol === 'https:',
      sameSite: window.location.protocol === 'https:' ? 'None' : 'Lax',
    };

    if (domain) {
      Cookies.remove('smol_token', { ...cookieOptions, domain });
    }

    Cookies.remove('smol_token', { ...cookieOptions });

    if (registrableDomain) {
      Cookies.remove('smol_token', { ...cookieOptions, domain: registrableDomain });
      Cookies.remove('smol_token', { ...cookieOptions, domain: `.${registrableDomain}` });
    }

    Object.keys(localStorage).forEach((key) => {
      if (key.includes('smol:')) {
        localStorage.removeItem(key);
      }
    });

    Object.keys(sessionStorage).forEach((key) => {
      if (key.includes('smol:')) {
        sessionStorage.removeItem(key);
      }
    });

    await fetch(`${API_URL}/logout`, {
      method: 'POST',
      credentials: 'include',
    });

    location.reload();
  }

  function getAuthHeaders(): Record<string, string> {
    const token = Cookies.get('smol_token');
    if (!token) return {};
    return {
      'Authorization': `Bearer ${token}`,
    };
  }

  return {
    login,
    signUp,
    logout,
    getAuthHeaders,
  };
}
