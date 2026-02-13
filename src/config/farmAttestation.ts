export const MAINNET_RPC_URL = import.meta.env.PUBLIC_MAINNET_RPC_URL ?? '';

export const MAINNET_NETWORK_PASSPHRASE =
    import.meta.env.PUBLIC_MAINNET_NETWORK_PASSPHRASE ?? 'Public Global Stellar Network ; September 2015';

export const FARM_ATTESTATIONS_CONTRACT_ID_MAINNET =
    import.meta.env.PUBLIC_FARM_ATTESTATIONS_CONTRACT_ID_MAINNET ?? '';

export const isMainnetConfigured = (): boolean => MAINNET_RPC_URL.trim().length > 0 && FARM_ATTESTATIONS_CONTRACT_ID_MAINNET.trim().length > 0;
