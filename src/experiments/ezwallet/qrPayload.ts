import type { StellarIntent } from './types';
import { USDC } from './config';

const RE = { amt: /^\d+(\.\d{1,7})?$/, code: /^[A-Z0-9]{1,12}$/, g: /^G[A-Z2-7]{55}$/, c: /^C[A-Z2-7]{55}$/ };
const clean = (v?: string, n = 80) => (v || '').trim().slice(0, n) || undefined;

export function validateIntent(i: StellarIntent): string[] {
  const e: string[] = [];
  if (i.type !== 'stellar_asset_intent' || i.version !== 1 || i.network !== 'public') e.push('Invalid header');
  if (!['receive_request', 'event_drop'].includes(i.mode)) e.push('Invalid mode');
  if (!RE.code.test(i.asset.code)) e.push('Invalid asset code');
  if (i.asset.code === 'XLM' && i.asset.type !== 'native') e.push('XLM must be native');
  if (i.asset.code === 'XLM' && i.asset.issuer) e.push('XLM cannot have issuer');
  if (i.asset.code === 'USDC' && i.asset.issuer !== USDC.issuer) e.push('USDC issuer mismatch');
  if (i.asset.code !== 'XLM' && !i.asset.issuer) e.push('Issuer required for non-native');
  if (i.amount && !RE.amt.test(i.amount)) e.push('Invalid amount');
  if (i.destination && !RE.g.test(i.destination) && !RE.c.test(i.destination)) e.push('Invalid destination');
  return e;
}

export function encodeIntent(i: StellarIntent): string {
  return btoa(JSON.stringify(i)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function decodeIntent(p: string): StellarIntent {
  const padded = p + '='.repeat((4 - (p.length % 4)) % 4);
  return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
}

export function buildIntent(partial: Partial<StellarIntent>): StellarIntent {
  return {
    type: 'stellar_asset_intent', version: 1, network: 'public', origin: 'smol-stellar-qr',
    mode: partial.mode || 'receive_request',
    asset: partial.asset || { type: 'native', code: 'XLM' },
    amount: clean(partial.amount, 20), destination: clean(partial.destination, 120), memo: clean(partial.memo, 80),
    label: clean(partial.label), message: clean(partial.message), event: clean(partial.event), dropId: clean(partial.dropId, 40),
    batchId: clean(partial.batchId, 40), qrId: clean(partial.qrId, 40), index: partial.index,
  };
}
