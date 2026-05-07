export type EzMode = 'receive_request' | 'event_drop';
export type EzAssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

export interface StellarIntent {
  type: 'stellar_asset_intent';
  version: 1;
  network: 'public';
  mode: EzMode;
  asset: { type: EzAssetType; code: string; issuer?: string };
  amount?: string;
  destination?: string;
  memo?: string;
  label?: string;
  message?: string;
  event?: string;
  dropId?: string;
  batchId?: string;
  qrId?: string;
  index?: number;
  origin: 'smol-stellar-qr';
}
