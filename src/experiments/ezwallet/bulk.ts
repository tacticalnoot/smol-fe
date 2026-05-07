import { buildIntent, encodeIntent } from './qrPayload';
import type { StellarIntent } from './types';

export function generateBulk(base: Partial<StellarIntent>, count: number, start = 1, prefix = 'QR') {
  const batchId = `batch-${Date.now().toString(36)}`;
  return Array.from({ length: count }, (_, k) => {
    const index = start + k;
    const qrId = `${prefix}-${String(index).padStart(4, '0')}`;
    const dropId = base.mode === 'event_drop' ? `drop-${batchId}-${index}` : undefined;
    const intent = buildIntent({ ...base, batchId, qrId, dropId, index, label: `${prefix} ${index}` });
    return { intent, batchId, qrId, dropId, index };
  });
}

export function toCsv(rows: Array<{ intent: StellarIntent; batchId: string; qrId: string; dropId?: string; index: number }>, origin: string) {
  const h = ['batchId','qrId','dropId','index','label','event','mode','asset_code','issuer','amount','destination','message','deepLink','createdAt'];
  const createdAt = new Date().toISOString();
  const lines = rows.map((r) => {
    const d = `${origin}/labs/ezwallet/drop?p=${encodeIntent(r.intent)}`;
    const v = [r.batchId,r.qrId,r.dropId||'',r.index,r.intent.label||'',r.intent.event||'',r.intent.mode,r.intent.asset.code,r.intent.asset.issuer||'',r.intent.amount||'',r.intent.destination||'',r.intent.message||'',d,createdAt];
    return v.map((x)=>`"${String(x).replaceAll('"','""')}"`).join(',');
  });
  return [h.join(','), ...lines].join('\n');
}
