export const PLATFORM_PAYMENT_DESTINATION = 'CBNORBI4DCE7LIC42FWMCIWQRULWAUGF2MH2Z7X2RNTFAYNXIACJ33IM';
export const PENDING_INTENT_KEY = 'smol:pendingStellarQrIntent';

export const USDC = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };

export const TIERS = {
  FREE: { name: 'Free', maxBatch: 1 },
  EVENT: { name: 'Event Pack', maxBatch: 100, priceXlm: 120 },
  POWER: { name: 'Power Pack', maxBatch: 1000, priceXlm: 900 },
  CUSTOM: { name: 'Custom / Enterprise', maxBatch: null }
} as const;
