<script lang="ts">
  import QRCode from 'qrcode';
  import { userState, ensureWalletConnected } from '../../stores/user.svelte';
  import { useAuthentication } from '../../hooks/useAuthentication';
  import { TIERS, USDC, PLATFORM_PAYMENT_DESTINATION } from './config';
  import { buildIntent, encodeIntent } from './qrPayload';
  import { generateBulk, toCsv } from './bulk';

  let mode = $state<'receive_request' | 'event_drop'>('receive_request');
  let asset = $state<'XLM' | 'USDC'>('XLM');
  let amount = $state('');
  let event = $state('');
  let message = $state('');
  let destination = $state('');
  let count = $state(10);
  let qrData = $state('');
  let link = $state('');
  let csv = $state('');
  let batchRows = $state<any[]>([]);
  const auth = useAuthentication();
  let status = $state('');
  let tier = $state<'FREE' | 'EVENT' | 'POWER'>('FREE');

  async function login() {
    await auth.login();
    await ensureWalletConnected();
  }

  function makeOne() {
    const intent = buildIntent({
      mode,
      amount,
      event,
      message,
      destination,
      asset:
        asset === 'XLM'
          ? { type: 'native', code: 'XLM' }
          : { type: 'credit_alphanum4', code: 'USDC', issuer: USDC.issuer }
    });
    const p = encodeIntent(intent);
    link = `${location.origin}/labs/ezwallet/drop?p=${p}`;
    QRCode.toDataURL(link, { margin: 1, width: 320 }).then((d: string) => (qrData = d));
  }

  function bulk() {
    const max = TIERS[tier].maxBatch ?? 10;
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
        asset:
          asset === 'XLM'
            ? { type: 'native', code: 'XLM' }
            : { type: 'credit_alphanum4', code: 'USDC', issuer: USDC.issuer }
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

<div class="ezwallet-shell">
  <div class="stellar-orbit-bg"></div>
  <header class="glass-panel hero-panel">
    <p class="kicker">POWERED BY SMOL • STELLAR NATIVE</p>
    <h1 class="holo-text">EZWallet</h1>
    <p class="hero-tag">Scan. Approve. Get Paid.</p>
    <p class="hero-sub">Create one safe QR that requests payment to your wallet — perfect for cards, booths, and NFT drops.</p>
  </header>

  <section class="dashboard-grid">
    <article class="glass-panel">
      <h2 class="section-title">01 · Build Your Payment QR</h2>
      <div class="label">Asset</div>
      <div class="pill-row">
        <button class="asset-pill" class:active={asset === 'XLM'} onclick={() => (asset = 'XLM')}>XLM</button>
        <button class="asset-pill" class:active={asset === 'USDC'} onclick={() => (asset = 'USDC')}>USDC</button>
      </div>
      <label>Mode
        <select bind:value={mode}>
          <option value="receive_request">Request Payment</option>
          <option value="event_drop">Event Drop</option>
        </select>
      </label>
      <label>Amount
        <input bind:value={amount} placeholder="Optional" />
      </label>
      <label>Destination
        <input bind:value={destination} placeholder="Optional (G.../C...)" />
      </label>
      <label>Event
        <input bind:value={event} placeholder="Event name" />
      </label>
      <label>Message
        <input bind:value={message} placeholder="Message" />
      </label>
      <div class="action-row">
        <button class="holo-button" onclick={makeOne}>Generate QR</button>
        <button class="soft-button" onclick={login}>Continue with Passkey</button>
      </div>
    </article>

    <article class="glass-panel">
      <h2 class="section-title">02 · Share with Confidence</h2>
      <p class="safety">Review before signing. Intent links do not auto-pay.</p>
      <div class="qr-frame">
        {#if qrData}
          <img src={qrData} alt="Generated Stellar QR intent" class="qr-image" />
        {:else}
          <p class="muted">Generate a QR to preview it here.</p>
        {/if}
      </div>
      {#if link}
        <label>Intent link
          <input value={link} readonly />
        </label>
        <div class="action-row">
          <button class="soft-button" onclick={() => navigator.clipboard.writeText(link)}>Copy link</button>
          <a class="soft-link" href={link} target="_blank" rel="noreferrer">Open drop</a>
        </div>
      {/if}
    </article>

    <article class="glass-panel">
      <h2 class="section-title">03 · Event & Batch Mode</h2>
      <label>Plan
        <select bind:value={tier}>
          <option value="FREE">Free</option>
          <option value="EVENT">Event Pack</option>
          <option value="POWER">Power Pack</option>
        </select>
      </label>
      <div class="pill-row">
        <button class="soft-button" onclick={() => (count = 10)}>10</button>
        <button class="soft-button" onclick={() => (count = 100)}>100</button>
        <button class="soft-button" onclick={() => (count = 1000)}>1000</button>
      </div>
      <label>Batch count
        <input type="number" bind:value={count} min="1" />
      </label>
      <div class="action-row">
        <button class="holo-button" onclick={bulk}>Generate batch</button>
        {#if csv}<button class="soft-button" onclick={downloadCsv}>Export CSV manifest</button>{/if}
      </div>
      <p class="status">{status}</p>
      <p class="muted">Rows generated: {batchRows.length}</p>
    </article>

    <article class="glass-panel pricing-panel">
      <h2 class="section-title">04 · Trust & Safety</h2>
      <div class="plan-grid">
        <div class="plan-card"><strong>Free</strong><span>Up to {TIERS.FREE.maxBatch}</span></div>
        <div class="plan-card popular"><strong>Event Pack</strong><span>{TIERS.EVENT.maxBatch} • {TIERS.EVENT.priceXlm} XLM</span></div>
        <div class="plan-card"><strong>Power Pack</strong><span>{TIERS.POWER.maxBatch} • {TIERS.POWER.priceXlm} XLM</span></div>
        <div class="plan-card"><strong>Custom / Enterprise</strong><span>Contact for event ops scale</span></div>
      </div>
      <p class="review">Pay with Stellar · Review before signing</p>
      <label>Destination
        <input value={PLATFORM_PAYMENT_DESTINATION} readonly />
      </label>
      <p class="muted">Each scan opens a review screen first. Nothing auto-sends funds without signer approval.</p>
    </article>
  </section>

  <footer class="glass-panel trust-strip">
    <span class="trust-chip">Passkey Smart Account</span>
    <span class="trust-chip">Public Event Ready</span>
    <span class="trust-chip">Review Before Signing</span>
    <span class="trust-chip">Stellar Native</span>
    <span class="trust-chip">No Seed Phrase Required</span>
    <span class="trust-chip">Signer Review Required</span>
  </footer>
</div>

<style>
  .ezwallet-shell { color: #f4f4f5; max-width: 1200px; margin: 0 auto; padding: 1.25rem; position: relative; }
  .stellar-orbit-bg { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 10% 0%, #1d2330aa, transparent 35%), radial-gradient(circle at 90% 20%, #7dd3fc22, transparent 28%), #050505; z-index: -1; }
  .glass-panel { background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03)); border: 1px solid rgba(255,255,255,0.14); border-radius: 18px; padding: 1rem; backdrop-filter: blur(6px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.2); }
  .hero-panel { margin-bottom: 1rem; padding: 1.5rem; }
  .holo-text { font-size: clamp(2.2rem, 5vw, 4rem); margin: 0; letter-spacing: 0.03em; background: linear-gradient(110deg, #f8fafc 0%, #b7c4d6 18%, #ffffff 34%, #9ee7ff 48%, #d8b4fe 64%, #fff7ad 78%, #cbd5e1 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .kicker { font-size: 0.72rem; letter-spacing: 0.18em; color: #b8bcc7; margin: 0 0 .5rem; }
  .hero-tag { font-size: 1.15rem; margin: .15rem 0; }
  .hero-sub { color: #b8bcc7; margin: 0; }
  .dashboard-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .section-title { margin: 0 0 .85rem; color: #dce2ee; font-size: .95rem; letter-spacing: .12em; text-transform: uppercase; }
  label, .label { display: block; font-size: .82rem; color: #b8bcc7; margin: .5rem 0; }
  input, select { width: 100%; margin-top: .35rem; background: #0a0a0a; color: #f4f4f5; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; padding: .58rem .66rem; }
  input:focus, select:focus, button:focus, a:focus { outline: 2px solid #9ee7ff; outline-offset: 2px; }
  .pill-row,.action-row { display:flex; gap:.5rem; flex-wrap:wrap; margin:.5rem 0; }
  .asset-pill,.soft-button,.holo-button { border-radius: 999px; border:1px solid rgba(255,255,255,.2); padding:.5rem .85rem; color:#f4f4f5; background:#11131a; }
  .asset-pill.active { border-color: rgba(255,255,255,.35); box-shadow: 0 0 0 1px #9ee7ff44; }
  .holo-button { background: linear-gradient(110deg, #f5f5f5, #9ca3af, #e5e7eb, #c0c0c0, #f8fafc, #a3a3a3); color:#060709; font-weight:700; }
  .soft-link { align-self:center; color:#dbe5f3; text-decoration:underline; }
  .qr-frame { background: linear-gradient(160deg,#1e232e,#11131a); border:1px solid rgba(255,255,255,.35); border-radius:14px; padding: 1rem; min-height: 230px; display:grid; place-items:center; }
  .qr-image { background:white; padding:12px; border-radius:10px; width:min(320px,100%); height:auto; }
  .muted,.status,.safety,.review { color:#b8bcc7; font-size:.84rem; }
  .plan-grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:.6rem; }
  .plan-card { border:1px solid rgba(255,255,255,.14); border-radius:12px; padding:.65rem; background: rgba(255,255,255,.03); display:flex; flex-direction:column; gap:.25rem; font-size:.84rem; }
  .popular { border-color: rgba(255,255,255,.35); }
  .trust-strip { margin-top: 1rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(165px,1fr)); gap:.5rem; }
  .trust-chip { border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:.45rem .55rem; font-size:.75rem; color:#c9cfdb; background:#090b10; text-align:center; }
  @media (max-width: 900px){ .dashboard-grid { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: no-preference){ .holo-button { background-size: 220% 220%; animation: shimmer 6s linear infinite; } }
  @keyframes shimmer { 0% { background-position:0% 50%; } 100% { background-position:200% 50%; } }
</style>
