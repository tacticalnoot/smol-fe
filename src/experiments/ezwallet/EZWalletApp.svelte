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
  let count = $state(1);
  let qrData = $state('');
  let link = $state('');
  let csv = $state('');
  let batchRows = $state<any[]>([]);
  const auth = useAuthentication();
  let status = $state('Ready to generate your first ticket.');
  let tier = $state<'FREE' | 'EVENT' | 'POWER'>('FREE');

  let tierPaid = $state<'FREE' | 'EVENT' | 'POWER'>('FREE');

  function getCheckoutLink(plan: 'EVENT' | 'POWER') {
    const amountXlm = TIERS[plan].priceXlm;
    const memo = encodeURIComponent(`EZWALLET_${plan}`);
    return `stellar:${PLATFORM_PAYMENT_DESTINATION}?amount=${amountXlm}&memo=${memo}`;
  }

  function confirmPlanPaid(plan: 'EVENT' | 'POWER') {
    tierPaid = plan;
    tier = plan;
    status = `${TIERS[plan].name} unlocked for this session.`;
  }

  function requiresPaidPlan() {
    return count > 1;
  }


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
      asset:
        asset === 'XLM'
          ? { type: 'native', code: 'XLM' }
          : { type: 'credit_alphanum4', code: 'USDC', issuer: USDC.issuer }
    });
    const p = encodeIntent(intent);
    link = `${location.origin}/labs/ezwallet/drop?p=${p}`;
    QRCode.toDataURL(link, { margin: 1, width: 320 }).then((d: string) => { qrData = d; status = 'QR ready — share the link or scan to review.'; });
  }

  function bulk() {
    const max = TIERS[tier].maxBatch ?? 1;

    if (requiresPaidPlan() && tier === 'FREE') {
      status = 'Free includes 1 generation only. Choose Event or Power, then use the one-tap Stellar checkout below.';
      return;
    }

    if (tier !== 'FREE' && tierPaid !== tier) {
      status = `Complete ${TIERS[tier].name} checkout first, then tap "I paid" to unlock generation.`;
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
    <p class="hero-tag">Scan. Claim. Receive Value.</p>
    <p class="hero-sub">Create claim tickets where the QR payload carries transfer intent metadata (XLM/USDC), so recipients review and redeem value flows instead of being prompted for immediate payment.</p>
  </header>
  <div class="wip-banner" role="status" aria-live="polite">
    <span class="wip-dot" aria-hidden="true"></span>
    <span><strong>Work in Progress</strong> · Until this badge is removed, all payments received are treated as tips supporting ongoing Smol development.</span>
  </div>

  <div class="readiness-strip" aria-label="EZWallet readiness status">
    <span class="readiness-label">Readiness</span>
    <span class="light red active" title="Not ready / test mode">Red</span>
    <span class="light yellow" title="Limited readiness">Yellow</span>
    <span class="light green" title="Production ready">Green</span>
    <span class="readiness-state">Not Ready / Test</span>
  </div>

  <section class="dashboard-grid">
    <article class="glass-panel">
      <h2 class="section-title">01 · Build Your Claim Ticket</h2>
      <p class="muted">Quick start: choose asset, add an optional amount, and generate.</p>
      <div class="label">Asset</div>
      <div class="pill-row">
        <button class="asset-pill" class:active={asset === 'XLM'} onclick={() => (asset = 'XLM')}>XLM</button>
        <button class="asset-pill" class:active={asset === 'USDC'} onclick={() => (asset = 'USDC')}>USDC</button>
      </div>
      <label>Mode
        <select bind:value={mode}>
          <option value="receive_request">Direct claim ticket</option>
          <option value="event_drop">Event ticket drop</option>
        </select>
      </label>
      <label>Amount
        <input bind:value={amount} placeholder="Optional" />
      </label>
      <label>Destination
        <input bind:value={destination} placeholder="Optional (G.../C...)" />
      </label>
      {#if mode === 'event_drop'}
      <label>Event
        <input bind:value={event} placeholder="Event name" />
      </label>
      {/if}
      <label>Message
        <input bind:value={message} placeholder="Optional note for recipient" />
      </label>
      <div class="action-row">
        <button class="holo-button" onclick={makeOne}>Generate QR</button>
        <button class="soft-button" onclick={login}>Connect passkey wallet</button>
      </div>
      <p class="status">{status}</p>
    </article>

    <article class="glass-panel">
      <h2 class="section-title">02 · Share & Review</h2>
      <p class="safety">Review before signing. The QR carries claim intent metadata and never auto-sends funds.</p>
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
      <h2 class="section-title">03 · Batch Generation</h2>
      <label>Plan
        <select bind:value={tier}>
          <option value="FREE">Free</option>
          <option value="EVENT">Event Pack</option>
          <option value="POWER">Power Pack</option>
        </select>
      </label>
      <div class="pill-row">
        <button class="soft-button" onclick={() => (count = 1)}>1</button>
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
      <p class="muted">Rows generated: {batchRows.length}</p>
      <p class="muted">Free plan creates one ticket at a time. Batch sizes above 1 require Event or Power.</p>
    </article>

    <article class="glass-panel pricing-panel">
      <h2 class="section-title">04 · Ticket Integrity</h2>
      <div class="plan-grid">
        <div class="plan-card"><strong>Free</strong><span>Up to {TIERS.FREE.maxBatch}</span></div>
        <div class="plan-card popular"><strong>Event Pack</strong><span>{TIERS.EVENT.maxBatch} • {TIERS.EVENT.priceXlm} XLM</span></div>
        <div class="plan-card"><strong>Power Pack</strong><span>{TIERS.POWER.maxBatch} • {TIERS.POWER.priceXlm} XLM</span></div>
        <div class="plan-card"><strong>Custom / Enterprise</strong><span>Contact for event ops scale</span></div>
      </div>
      <p class="review">One-tap checkout (Apple Pay-style flow): choose plan → pay in wallet → tap I paid → generate.</p>
      <div class="pill-row">
        <a class="holo-button" href={getCheckoutLink('EVENT')}>Pay {TIERS.EVENT.priceXlm} XLM · Event Pack</a>
        <button class="soft-button" onclick={() => confirmPlanPaid('EVENT')}>I paid Event Pack</button>
      </div>
      <div class="pill-row">
        <a class="holo-button" href={getCheckoutLink('POWER')}>Pay {TIERS.POWER.priceXlm} XLM · Power Pack</a>
        <button class="soft-button" onclick={() => confirmPlanPaid('POWER')}>I paid Power Pack</button>
      </div>
      <label>Platform destination
        <input value={PLATFORM_PAYMENT_DESTINATION} readonly />
      </label>
      <p class="muted">Each scan opens a claim review screen first. Redemption always requires explicit signer approval.</p>
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

  .wip-banner { margin: 0 0 1rem; padding: .65rem .8rem; border-radius: 12px; border: 1px solid rgba(245, 208, 74, .45); background: linear-gradient(120deg, rgba(250, 204, 21, .12), rgba(250, 204, 21, .04), rgba(255,255,255,.02)); color: #f5e7bd; display:flex; gap:.55rem; align-items:center; font-size:.82rem; }
  .wip-dot { width: .55rem; height: .55rem; border-radius:999px; background: #facc15; box-shadow: 0 0 8px rgba(250,204,21,.7); }
  .readiness-strip { display:flex; align-items:center; gap:.45rem; margin: 0 0 1rem; padding: .55rem .7rem; border-radius: 10px; background: rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.12); font-size:.75rem; }
  .readiness-label { color:#cbd5e1; text-transform: uppercase; letter-spacing:.08em; margin-right:.25rem; }
  .light { padding:.2rem .5rem; border-radius:999px; border:1px solid transparent; opacity:.45; }
  .light.red { background: rgba(239,68,68,.2); color:#fecaca; }
  .light.yellow { background: rgba(250,204,21,.18); color:#fde68a; }
  .light.green { background: rgba(34,197,94,.18); color:#bbf7d0; }
  .light.active { opacity:1; border-color: rgba(255,255,255,.35); box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset; }
  .readiness-state { margin-left:auto; color:#fecaca; font-weight:600; }

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
