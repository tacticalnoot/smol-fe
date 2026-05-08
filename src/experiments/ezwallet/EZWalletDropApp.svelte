<script lang="ts">
  import { decodeIntent, validateIntent } from './qrPayload';
  import { PENDING_INTENT_KEY } from './config';
  import { userState } from '../../stores/user.svelte';
  import { useAuthentication } from '../../hooks/useAuthentication';

  let intent: any = null;
  let errors: string[] = [];
  let raw = '';
  let copyStatus = '';
  const auth = useAuthentication();

  if (typeof window !== 'undefined') {
    const p = new URL(location.href).searchParams.get('p') || '';
    raw = p;
    if (p) {
      try {
        intent = decodeIntent(p);
        errors = validateIntent(intent as any);
      } catch {
        errors = ['This claim link is invalid.'];
      }
    }
    if (!userState.contractId && intent && errors.length === 0) {
      sessionStorage.setItem(PENDING_INTENT_KEY, JSON.stringify(intent));
    }
  }

  async function login() {
    await auth.login();
    const s = sessionStorage.getItem(PENDING_INTENT_KEY);
    if (s) intent = JSON.parse(s);
  }

  async function copyIntent() {
    await navigator.clipboard.writeText(raw);
    copyStatus = 'Link details copied.';
  }

  function prettyMode(value: string) {
    return value === 'event_drop' ? 'Event claim' : 'Direct claim';
  }
</script>

<div class="claim-shell">
  <section class="claim-card">
    <p class="eyebrow">EZ Wallet</p>
    <h1>Claim details</h1>
    <p class="intro">You can safely open this page. Review every detail below before connecting your wallet and approving anything.</p>

    {#if errors.length}
      <div class="notice notice-error" role="alert">
        {errors.join(', ')}
      </div>
    {:else if intent}
      <dl class="detail-grid">
        <div class="detail-item">
          <dt>Claim type</dt>
          <dd>{prettyMode(intent.mode)}</dd>
        </div>
        <div class="detail-item">
          <dt>Asset</dt>
          <dd>{intent.asset.code}</dd>
        </div>
        <div class="detail-item">
          <dt>Amount</dt>
          <dd>{intent.amount || 'Set later'}</dd>
        </div>
        <div class="detail-item">
          <dt>Destination</dt>
          <dd>{intent.destination || 'Choose during claim'}</dd>
        </div>
        <div class="detail-item">
          <dt>Event</dt>
          <dd>{intent.event || 'Not specified'}</dd>
        </div>
        <div class="detail-item">
          <dt>Message</dt>
          <dd>{intent.message || 'No message'}</dd>
        </div>
        <div class="detail-item">
          <dt>Network</dt>
          <dd>Public</dd>
        </div>
      </dl>

      <div class="notice notice-warn">
        No payment is sent automatically. You will always review and approve in your wallet first.
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick={login}>Connect wallet</button>
        <button class="btn btn-secondary" onclick={copyIntent}>Copy claim link</button>
        <a class="btn btn-secondary" href="/labs/ezwallet">Create a new claim</a>
      </div>
      {#if copyStatus}<p class="copy-status">{copyStatus}</p>{/if}
    {:else}
      <div class="notice notice-error" role="alert">No claim data was found in this link.</div>
      <a class="btn btn-secondary" href="/labs/ezwallet">Go to EZ Wallet</a>
    {/if}
  </section>
</div>

<style>
  .claim-shell { min-height: 100vh; padding: 1.25rem; background: radial-gradient(circle at 0% 0%, #3f3f46, transparent 45%), #080808; color: #f5f5f5; display: grid; place-items: center; }
  .claim-card { width: min(780px, 100%); background: linear-gradient(165deg, rgba(255,255,255,.12), rgba(255,255,255,.04)); border: 1px solid rgba(255,255,255,.18); border-radius: 24px; padding: clamp(1rem, 3vw, 2rem); box-shadow: 0 20px 45px rgba(0,0,0,.4); }
  .eyebrow { text-transform: uppercase; letter-spacing: .14em; color: #d4d4d8; font-size: .74rem; margin: 0 0 .35rem; }
  h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.4rem); color: #fafafa; }
  .intro { color: #d4d4d8; margin: .65rem 0 1.1rem; }
  .detail-grid { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .65rem; }
  .detail-item { margin: 0; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: .68rem .75rem; background: rgba(0,0,0,.25); }
  dt { font-size: .75rem; text-transform: uppercase; color: #a1a1aa; letter-spacing: .07em; }
  dd { margin: .28rem 0 0; color: #fafafa; word-break: break-word; }
  .notice { margin-top: .95rem; border-radius: 12px; padding: .7rem .78rem; font-size: .92rem; }
  .notice-error { border: 1px solid rgba(248,113,113,.45); background: rgba(127,29,29,.3); color: #fecaca; }
  .notice-warn { border: 1px solid rgba(250,204,21,.35); background: rgba(113,63,18,.22); color: #fde68a; }
  .actions { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: .55rem; }
  .btn { text-decoration: none; border-radius: 999px; padding: .62rem .98rem; border: 1px solid rgba(255,255,255,.25); color: #fafafa; background: rgba(255,255,255,.04); font-weight: 600; }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary { background: linear-gradient(110deg, #fafafa, #d4d4d8, #a3a3a3); color: #0a0a0a; border-color: transparent; }
  .copy-status { margin-top: .6rem; color: #d4d4d8; font-size: .85rem; }
</style>
