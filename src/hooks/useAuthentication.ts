import Cookies from 'js-cookie';
import { getDomain } from 'tldts';
import { getSafeRpId } from '../utils/domains';
import { send } from '../utils/passkey-kit';
import { connectWithPrompt, createWallet } from '../lib/wallet/smartAccount';
import { setUserAuth, clearUserAuth, userState } from '../stores/user.svelte';

export function useAuthentication() {
  const API_URL = import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";
  async function login() {
    const hostname = window.location.hostname;
    const rpId = getSafeRpId(hostname);

    console.log('[Auth] Login attempt:', { hostname, rpId });

    // Clear any stale credentials before logging in
    clearUserAuth();

    try {
      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn not supported in this browser');
      }

      console.log('[Auth] Calling connectWallet with rpId:', rpId);
      const result = await connectWithPrompt();

      console.log('[Auth] connectWallet succeeded:', { contractId: result.contractId });

      const {
        rawResponse,
        contractId: cid,
        credentialId,
      } = result;

      console.log('[Auth] Performing login with contract ID:', cid);
      await performLogin(cid, credentialId, rawResponse, 'connect');
    } catch (connectErr: any) {
      console.error("[Auth] Connect failed:", {
        message: connectErr.message,
        name: connectErr.name,
        code: connectErr.code,
        stack: connectErr.stack
      });

      // Enhance error message for better user feedback
      if (connectErr.name === 'NotAllowedError') {
        throw new Error('Passkey authentication was cancelled or not allowed');
      } else if (connectErr.message?.includes('No credentials available')) {
        throw new Error('No passkey found for this device');
      }

      throw connectErr;
    }
  }

  async function performLogin(cid: string, keyIdBase64: string, rawResponse: any, type: 'connect' | 'create', username?: string) {
    const API_URL = import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";
    const debugEnabled =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debug');
    const payload = {
      type,
      keyId: keyIdBase64,
      contractId: cid,
      response: rawResponse,
      username,
    };

    if (debugEnabled) {
      console.log('[Auth][Debug] /login request', {
        url: `${API_URL}/login`,
        bodyKeys: Object.keys(payload),
        origin: window.location.origin,
        host: window.location.host,
      });
    }

    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    let responseJson: any = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    if (debugEnabled) {
      console.log('[Auth][Debug] /login response', {
        status: res.status,
        ok: res.ok,
        body: responseJson || responseText,
      });
    }

    if (!res.ok) {
      const errorCode = responseJson?.error || responseJson?.code;
      const debugId = responseJson?.debugId;
      const message = errorCode
        ? `Auth failed: ${errorCode}${debugId ? ` (debugId=${debugId})` : ''}`
        : responseText || `Login failed (${res.status})`;
      throw new Error(message);
    }

    const jwt = responseText;

    setUserAuth(cid, keyIdBase64);
    // Mark wallet as connected since connectWallet was just called
    userState.walletConnected = true;

    const domain = getDomain(window.location.hostname);
    const isSecure = window.location.protocol === 'https:';
    const cookieOptions: Cookies.CookieAttributes = {
      path: '/',
      secure: isSecure,
      sameSite: 'Lax',
      expires: 30,
    };
    if (domain) {
      cookieOptions.domain = `.${domain}`;
    }

    Cookies.set('smol_token', jwt, cookieOptions);
  }

  async function signUp(username: string, turnstileToken: string) {
    // Clear any stale credentials before creating new account
    clearUserAuth();

    console.log('[Auth] Creating wallet for username:', username);

    const result = await createWallet('smol.xyz', `SMOL — ${username}`, {
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      },
    });

    console.log('[Auth] Wallet created, contract ID:', result.contractId);

    const {
      rawResponse,
      contractId: cid,
      signedTransaction,
      credentialId,
      submitResult,
    } = result;

    console.log('[Auth] Performing login...');
    await performLogin(cid, credentialId, rawResponse, 'create', username);

    console.log('[Auth] Sending wallet deployment transaction...');

    // Wallet deployments MUST use KaleFarm's raw XDR endpoint, not OZ Channels
    // OZ Channels can't handle factory-signed transactions
    // For dev/preview without Turnstile, we'll use a dummy token (API key auth takes precedence)
    if (!submitResult?.success) {
      await send(signedTransaction, turnstileToken || 'dev-bypass');
    }
  }

  async function logout() {
    clearUserAuth();

    const domain = getDomain(window.location.hostname);
    const cookieOptions: Cookies.CookieAttributes = {
      path: '/',
      secure: true,
      sameSite: 'Lax',
    };
    if (domain) {
      cookieOptions.domain = `.${domain}`;
    }

    Cookies.remove('smol_token', cookieOptions);

    // Clear all smol: related data from localStorage and sessionStorage
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

  return {
    login,
    signUp,
    logout,
  };
}
