import {
  SmartAccountKit,
  IndexedDBStorage,
  type AssembledTransaction,
  type ConnectWalletResult,
  type CreateWalletResult,
  type TransactionResult,
} from 'smart-account-kit';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { RPC_URL } from '../../utils/rpc';
import { getSafeRpId } from '../../utils/domains';

type LastConnection = {
  contractId?: string;
  credentialId: string;
  rawResponse?: AuthenticationResponseJSON | RegistrationResponseJSON;
};

let kit: SmartAccountKit | null = null;
let lastConnection: LastConnection | null = null;

function getRpId(): string | undefined {
  if (typeof window === 'undefined') return 'smol.xyz';
  return getSafeRpId(window.location.hostname) || 'smol.xyz';
}

function getKit(): SmartAccountKit {
  if (!kit) {
    const webauthnVerifierAddress =
      import.meta.env.PUBLIC_WEBAUTHN_VERIFIER_ADDRESS;

    if (!RPC_URL) {
      throw new Error('PUBLIC_RPC_URL is not configured');
    }
    if (!import.meta.env.PUBLIC_NETWORK_PASSPHRASE) {
      throw new Error('PUBLIC_NETWORK_PASSPHRASE is not configured');
    }
    if (!import.meta.env.PUBLIC_WALLET_WASM_HASH) {
      throw new Error('PUBLIC_WALLET_WASM_HASH is not configured');
    }
    if (!webauthnVerifierAddress) {
      throw new Error('PUBLIC_WEBAUTHN_VERIFIER_ADDRESS is not configured');
    }

    kit = new SmartAccountKit({
      rpcUrl: RPC_URL,
      networkPassphrase: import.meta.env.PUBLIC_NETWORK_PASSPHRASE,
      accountWasmHash: import.meta.env.PUBLIC_WALLET_WASM_HASH,
      webauthnVerifierAddress,
      storage:
        typeof window !== 'undefined' ? new IndexedDBStorage() : undefined,
      rpId: getRpId(),
      rpName: 'smol.xyz',
      relayerUrl: import.meta.env.PUBLIC_RELAYER_URL,
    });
  }

  return kit;
}

export function getLastConnection(): LastConnection | null {
  return lastConnection;
}

export async function silentRestore(options?: {
  credentialId?: string | null;
  contractId?: string | null;
}): Promise<boolean> {
  const result = await getKit().connectWallet({
    credentialId: options?.credentialId || undefined,
    contractId: options?.contractId || undefined,
  });
  lastConnection = result
    ? {
        contractId: result.contractId,
        credentialId: result.credentialId,
        rawResponse: result.rawResponse,
      }
    : null;
  return Boolean(result);
}

export async function connectWithPrompt(): Promise<ConnectWalletResult> {
  const result = await getKit().connectWallet({ prompt: true });
  if (!result) {
    throw new Error('No passkey credentials found for login');
  }
  lastConnection = {
    contractId: result.contractId,
    credentialId: result.credentialId,
    rawResponse: result.rawResponse,
  };
  return result;
}

export async function createWallet(
  appName: string,
  userName: string,
  options?: {
    nickname?: string;
    authenticatorSelection?: {
      authenticatorAttachment?: 'platform' | 'cross-platform';
      residentKey?: 'discouraged' | 'preferred' | 'required';
      userVerification?: 'discouraged' | 'preferred' | 'required';
    };
  },
): Promise<
  CreateWalletResult & { submitResult?: TransactionResult }
> {
  const result = await getKit().createWallet(appName, userName, {
    autoSubmit: true,
    ...options,
  });
  lastConnection = {
    contractId: result.contractId,
    credentialId: result.credentialId,
    rawResponse: result.rawResponse,
  };
  return result;
}

export async function disconnect(): Promise<void> {
  await getKit().disconnect();
  lastConnection = null;
}

export async function signAndSubmit<T>(
  transaction: AssembledTransaction<T>,
): Promise<TransactionResult> {
  return getKit().signAndSubmit(transaction);
}

export async function authenticatePasskey(): Promise<{
  credentialId: string;
  rawResponse: AuthenticationResponseJSON;
}> {
  const result = await getKit().authenticatePasskey();
  lastConnection = {
    credentialId: result.credentialId,
    rawResponse: result.rawResponse,
  };
  return result;
}
