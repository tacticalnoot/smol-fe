<script lang="ts">
  import { decodeIntent, validateIntent } from './qrPayload';
  import { PENDING_INTENT_KEY } from './config';
  import { userState } from '../../stores/user.svelte';
  import { useAuthentication } from '../../hooks/useAuthentication';
  let intent:any = null; let errors:string[] = []; let raw = '';
  const auth = useAuthentication();
  if (typeof window !== 'undefined') {
    const p = new URL(location.href).searchParams.get('p') || '';
    raw = p;
    if (p) { try { intent = decodeIntent(p); errors = validateIntent(intent as any); } catch { errors=['Invalid payload']; } }
    if (!userState.contractId && intent && errors.length===0) sessionStorage.setItem(PENDING_INTENT_KEY, JSON.stringify(intent));
  }
  async function login(){ await auth.login(); const s = sessionStorage.getItem(PENDING_INTENT_KEY); if (s) intent = JSON.parse(s); }
</script>
<div class="p-6 max-w-3xl mx-auto text-white">
<h1 class="text-2xl font-bold">Stellar Drop Ready</h1>
<p>Review the request details, confirm destination, then sign only if everything is correct.</p>
{#if errors.length}<p class="text-red-400">{errors.join(', ')}</p>{:else if intent}
<ul><li>Mode: {intent.mode}</li><li>Asset: {intent.asset.code}</li><li>Amount: {intent.amount || '—'}</li><li>Destination: {intent.destination || 'choose later'}</li><li>Event: {intent.event || '—'}</li><li>Message: {intent.message || '—'}</li><li>Network: public</li></ul>
<p class="text-yellow-300">No transaction has been sent. Review before signing.</p>
<button onclick={login}>Continue with Passkey</button>
<button onclick={()=>navigator.clipboard.writeText(raw)}>Copy Intent</button>
<a href="/labs/ezwallet">Generate Another QR</a>
{/if}
</div>
