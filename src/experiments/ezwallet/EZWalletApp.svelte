<script lang="ts">
  import QRCode from 'qrcode';
  import { userState, ensureWalletConnected } from '../../stores/user.svelte';
  import { useAuthentication } from '../../hooks/useAuthentication';
  import { TIERS, USDC, KALE, PLATFORM_PAYMENT_DESTINATION } from './config';
  import { buildIntent, encodeIntent } from './qrPayload';
  import { generateBulk, toCsv } from './bulk';

  let mode = $state<'receive_request' | 'event_drop'>('receive_request');
  let asset = $state<'XLM' | 'USDC' | 'KALE'>('XLM');
  let amount = $state('');
  let event = $state('');
  let message = $state('');
  let destination = $state('');
  let count = $state(1);
  let qrData = $state('');
  let link = $state('');
  let csv = $state('');
  let batchRows = $state<any[]>([]);
  const auth = useAuthentication();
  let status = $state('Ready to generate your first ticket.');
  let tier = $state<'FREE' | 'EVENT' | 'POWER'>('FREE');

  function getCheckoutLink(plan: 'EVENT' | 'POWER') {
    const amountXlm = TIERS[plan].priceXlm;
    const memo = encodeURIComponent(`EZWALLET_${plan}`);
    return `stellar:${PLATFORM_PAYMENT_DESTINATION}?amount=${amountXlm}&memo=${memo}`;
  }

  function checkoutSelectedTier() {
    if (tier === 'FREE') {
      status = 'Free plan is active — no checkout required.';
      return;
    }

    const checkoutLink = getCheckoutLink(tier);
    window.open(checkoutLink, '_blank', 'noopener,noreferrer');
    status = `Opening ${TIERS[tier].name} checkout in Stellar wallet…`;
  }

  $effect(() => {
    if (tier === 'FREE' && count > 1) {
      count = 1;
      status = 'Free plan allows 1 ticket per batch. Upgrade to Event or Power for larger runs.';
    }
  });

  async function login() {
    await auth.login();
    await ensureWalletConnected();
  }

  function makeOne() {
    status = 'Building your share link…';
    const intent = buildIntent({
      mode,
      amount,
      event,
      message,
      destination,
      asset: asset === 'XLM'
        ? { type: 'native', code: 'XLM' }
        : asset === 'USDC'
          ? { type: 'credit_alphanum4', code: 'USDC', issuer: USDC.issuer }
          : { type: 'credit_alphanum4', code: 'KALE', issuer: KALE.issuer }
    });
    const p = encodeIntent(intent);
    link = `${location.origin}/labs/ezwallet/drop?p=${p}`;
    QRCode.toDataURL(link, { margin: 1, width: 320 }).then((d: string) => { qrData = d; status = 'QR ready — share the link or scan to review.'; });
  }

  function bulk() {
    const max = TIERS[tier].maxBatch ?? 1;

    if (count > 1 && tier === 'FREE') {
      status = 'Free includes 1 generation only. Choose Event or Power, then use the one-tap Stellar checkout below.';
      return;
    }

    if (count > max) {
      status = `${TIERS[tier].name} limit is ${max}`;
      return;
    }
    const rows = generateBulk(
      {
        mode,
        amount,
        event,
        message,
        destination,
        asset: asset === 'XLM'
          ? { type: 'native', code: 'XLM' }
          : asset === 'USDC'
            ? { type: 'credit_alphanum4', code: 'USDC', issuer: USDC.issuer }
            : { type: 'credit_alphanum4', code: 'KALE', issuer: KALE.issuer }
      },
      count,
      1,
      'EV'
    );
    batchRows = rows;
    csv = toCsv(rows, location.origin);
    status = `Generated ${rows.length} QR intents`;
  }

  function downloadCsv() {
    const b = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'ezwallet-manifest.csv';
    a.click();
  }
</script>

<div class="ez-shell">
  <div class="bg-layer" aria-hidden="true"></div>

  <header class="panel hero">
    <p class="eyebrow">EZ Wallet</p>
    <h1>Create professional claim links in minutes</h1>
    <p class="hero-copy">Build a claim, share a QR, and let people review details before they approve in wallet. Fast for you, clear for them.</p>
  </header>

  <section class="panel flow">
    <h2>1) Claim setup</h2>
    <div class="field-group">
      <label class="field-label">Asset</label>
      <div class="chip-row">
        <button class="chip" class:active={asset === 'XLM'} onclick={() => (asset = 'XLM')}>XLM</button>
        <button class="chip" class:active={asset === 'USDC'} onclick={() => (asset = 'USDC')}>USDC</button>
        <button class="chip" class:active={asset === 'KALE'} onclick={() => (asset = 'KALE')}>KALE</button>
      </div>
    </div>

    <label class="field-label">Claim type
      <select bind:value={mode}>
        <option value="receive_request">Direct claim (one person)</option>
        <option value="event_drop">Event claim batch (multiple people)</option>
      </select>
    </label>

    <div class="grid-two">
      <label class="field-label">Amount
        <input bind:value={amount} placeholder="Optional, for example 10 or 10.5" />
      </label>
      <label class="field-label">Destination wallet
        <input bind:value={destination} placeholder="Optional: G... or C..." />
      </label>
    </div>

    {#if mode === 'event_drop'}
      <label class="field-label">Event name
        <input bind:value={event} placeholder="Optional event title" />
      </label>
    {/if}

    <label class="field-label">Message
      <input bind:value={message} placeholder="Optional message for recipients" />
    </label>

    <div class="actions">
      <button class="btn btn-primary" onclick={makeOne}>Generate claim QR</button>
      <button class="btn btn-secondary" onclick={login}>Connect wallet</button>
    </div>
    <p class="status">{status}</p>
  </section>

  <section class="panel flow">
    <h2>2) Share and preview</h2>
    <div class="qr-box">
      {#if qrData}
        <img src={qrData} alt="Generated claim QR" class="qr" />
      {:else}
        <p class="muted">Generate a claim to preview the QR here.</p>
      {/if}
    </div>
    {#if link}
      <label class="field-label">Claim link
        <input value={link} readonly />
      </label>
      <div class="actions">
        <button class="btn btn-secondary" onclick={() => navigator.clipboard.writeText(link)}>Copy link</button>
        <a class="btn btn-secondary" href={link} target="_blank" rel="noreferrer">Open claim page</a>
      </div>
    {/if}
    <p class="note">Recipients always review details before approving.</p>
  </section>

  <section class="panel flow">
    <h2>3) Batch generator</h2>
    <label class="field-label">Plan
      <select bind:value={tier}>
        <option value="FREE">Free</option>
        <option value="EVENT">Event Pack</option>
        <option value="POWER">Power Pack</option>
      </select>
    </label>

    <div class="chip-row">
      <button class="chip" onclick={() => (count = 1)}>1</button>
      <button class="chip" onclick={() => (count = 10)} disabled={tier === 'FREE'}>10</button>
      <button class="chip" onclick={() => (count = 100)} disabled={tier === 'FREE'}>100</button>
      <button class="chip" onclick={() => (count = 1000)} disabled={tier !== 'POWER'}>1000</button>
    </div>

    <label class="field-label">Batch size
      <input type="number" bind:value={count} min="1" max={TIERS[tier].maxBatch ?? undefined} />
    </label>

    <div class="actions">
      <button class="btn btn-primary" onclick={bulk}>Generate batch</button>
      {#if csv}<button class="btn btn-secondary" onclick={downloadCsv}>Download CSV</button>{/if}
    </div>

    <p class="muted">Generated rows: {batchRows.length}</p>
  </section>

  <section class="panel flow">
    <h2>4) Upgrade options</h2>
    <div class="plan-grid">
      <div class="plan"><strong>Free</strong><span>Up to {TIERS.FREE.maxBatch}</span></div>
      <div class="plan"><strong>Event Pack</strong><span>{TIERS.EVENT.maxBatch} • {TIERS.EVENT.priceXlm} XLM</span></div>
      <div class="plan"><strong>Power Pack</strong><span>{TIERS.POWER.maxBatch} • {TIERS.POWER.priceXlm} XLM</span></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" onclick={checkoutSelectedTier} disabled={tier === 'FREE'}>
        {#if tier === 'EVENT'}Upgrade to Event Pack{/if}
        {#if tier === 'POWER'}Upgrade to Power Pack{/if}
        {#if tier === 'FREE'}Select Event or Power{/if}
      </button>
    </div>
    <label class="field-label">Payment destination
      <input value={PLATFORM_PAYMENT_DESTINATION} readonly />
    </label>
  </section>
</div>

<style>
  .ez-shell { max-width: 1100px; margin: 0 auto; padding: 1rem; color: #f5f5f5; position: relative; display: grid; gap: .85rem; }
  .bg-layer { position: fixed; inset: 0; z-index: -1; background: radial-gradient(circle at 5% 5%, #52525b66, transparent 40%), radial-gradient(circle at 90% 0%, #a1a1aa33, transparent 35%), #060606; }
  .panel { border: 1px solid rgba(255,255,255,.15); background: linear-gradient(170deg, rgba(255,255,255,.12), rgba(255,255,255,.03)); border-radius: 20px; padding: 1rem; box-shadow: 0 14px 32px rgba(0,0,0,.35); }
  .hero h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.6rem); background: linear-gradient(100deg, #fff, #d4d4d8, #a1a1aa); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .eyebrow { margin: 0 0 .3rem; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; color: #d4d4d8; }
  .hero-copy { margin: .5rem 0 0; color: #d4d4d8; }
  .flow h2 { margin: 0 0 .75rem; font-size: 1rem; color: #fafafa; }
  .field-label { display: block; margin: .45rem 0; color: #d4d4d8; font-size: .86rem; }
  input, select { width: 100%; margin-top: .35rem; border-radius: 10px; border: 1px solid rgba(255,255,255,.22); background: #0d0d0d; color: #fafafa; padding: .58rem .65rem; }
  .grid-two { display: grid; gap: .6rem; grid-template-columns: repeat(2, minmax(0,1fr)); }
  .chip-row, .actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .4rem; }
  .chip, .btn { border-radius: 999px; border: 1px solid rgba(255,255,255,.22); padding: .52rem .85rem; background: rgba(255,255,255,.04); color: #fafafa; }
  .chip.active { border-color: #e4e4e7; box-shadow: inset 0 0 0 1px #e4e4e7; }
  .btn-primary { background: linear-gradient(108deg, #fff, #d4d4d8, #a3a3a3); color: #09090b; font-weight: 700; border-color: transparent; }
  .qr-box { border: 1px solid rgba(255,255,255,.2); border-radius: 14px; min-height: 220px; display: grid; place-items: center; background: #0b0b0b; }
  .qr { width: min(320px,100%); background: white; padding: 12px; border-radius: 10px; }
  .status, .muted, .note { color: #d4d4d8; font-size: .85rem; }
  .plan-grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
  .plan { border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: .62rem; background: rgba(0,0,0,.26); display:flex; flex-direction:column; gap:.15rem; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  @media (max-width: 780px) { .grid-two { grid-template-columns: 1fr; } }
</style>
