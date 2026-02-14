export const MAINNET_RPC_URL = import.meta.env.PUBLIC_MAINNET_RPC_URL ?? '';

export const MAINNET_NETWORK_PASSPHRASE =
    import.meta.env.PUBLIC_MAINNET_NETWORK_PASSPHRASE ?? 'Public Global Stellar Network ; September 2015';

// One-click mainnet attestation for Noir/RISC0. Can be overridden via env.
// If this changes, update docs/LABS_INTEGRITY.md and any deployment notes.
const DEFAULT_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET =
    'CDVJZSMI5KSRK7T6D6GGYVB6UPFCDQLAZAYRGXVJKDBOHLAZOPHHX2FR';

export const FARM_ATTESTATIONS_CONTRACT_ID_MAINNET =
    import.meta.env.PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ?? DEFAULT_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET;

export const isMainnetConfigured = (): boolean => MAINNET_RPC_URL.trim().length > 0 && FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim().length > 0;
