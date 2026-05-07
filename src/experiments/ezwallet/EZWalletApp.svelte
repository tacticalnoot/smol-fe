<script lang="ts">
  import QRCode from 'qrcode';
  import { userState, ensureWalletConnected } from '../../stores/user.svelte';
  import { useAuthentication } from '../../hooks/useAuthentication';
  import { TIERS, USDC, PLATFORM_PAYMENT_DESTINATION } from './config';
  import { buildIntent, encodeIntent } from './qrPayload';
  import { generateBulk, toCsv } from './bulk';
  let mode = $state<'receive_request'|'event_drop'>('receive_request');
  let asset = $state<'XLM'|'USDC'>('XLM'); let amount = $state(''); let event = $state(''); let message = $state(''); let destination=$state('');
  let count = $state(10); let qrData = $state(''); let link = $state(''); let csv = $state(''); let batchRows:any[] = [];
  const auth = useAuthentication();
  let status = $state(''); let tier = $state<'FREE'|'EVENT'|'POWER'>('FREE');
  async function login(){ await auth.login(); await ensureWalletConnected(); }
  function makeOne(){
    const intent = buildIntent({mode, amount, event, message, destination, asset: asset==='XLM'?{type:'native',code:'XLM'}:{type:'credit_alphanum4',code:'USDC',issuer:USDC.issuer}});
    const p = encodeIntent(intent); link = `${location.origin}/ezwallet/drop?p=${p}`; QRCode.toDataURL(link,{margin:1,width:256}).then((d: string)=>qrData=d);
  }
  function bulk(){ const max = TIERS[tier].maxBatch ?? 10; if(count>max){status=`${TIERS[tier].name} limit is ${max}`; return;} const rows=generateBulk({mode,amount,event,message,asset: asset==='XLM'?{type:'native',code:'XLM'}:{type:'credit_alphanum4',code:'USDC',issuer:USDC.issuer}},count,1,'EV'); batchRows=rows; csv=toCsv(rows, location.origin); status=`Generated ${rows.length} QR intents`; }
  function downloadCsv(){ const b=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='ezwallet-manifest.csv'; a.click(); }
</script>
<div class="p-6 max-w-5xl mx-auto text-white">
  <h1 class="text-3xl font-bold">EZWallet</h1><p class="text-sm opacity-80">Public Stellar QR drops for events, counters, booths, and social handoffs. Scan. Receive. Send. Stellar.</p>
  <p class="text-xs mt-2 text-yellow-300">QR scans prepare an intent. You always review before signing.</p>
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="space-y-2"><select bind:value={mode}><option value="receive_request">Receive Request</option><option value="event_drop">Public Event Drop Intent</option></select>
    <select bind:value={asset}><option>XLM</option><option>USDC</option></select><input bind:value={amount} placeholder="Amount optional"/><input bind:value={destination} placeholder="Destination optional (G.../C...)"/><input bind:value={event} placeholder="Event"/><input bind:value={message} placeholder="Message"/>
    <button onclick={makeOne}>Generate QR</button>
    <button onclick={login}>Continue with Passkey</button></div>
    <div>{#if qrData}<img src={qrData} alt="QR" class="bg-white p-2"/>{/if}{#if link}<input value={link} readonly/><button onclick={()=>navigator.clipboard.writeText(link)}>Copy link</button><a href={link} target="_blank">Open Drop Link</a>{/if}</div>
  </div>
  <h2 class="mt-8 font-bold">Bulk Event Mode</h2>
  <div class="flex gap-2 items-center"><select bind:value={tier}><option value="FREE">Free</option><option value="EVENT">Event Pack</option><option value="POWER">Power Pack</option></select><input type="number" bind:value={count} min="1"/><button onclick={bulk}>Generate Batch</button>{#if csv}<button onclick={downloadCsv}>Export CSV manifest</button>{/if}</div>
  <p>{status}</p>
  <div class="grid md:grid-cols-4 gap-2 mt-6 text-sm">
    <div>Free: up to {TIERS.FREE.maxBatch}</div><div>Event Pack: up to {TIERS.EVENT.maxBatch} ({TIERS.EVENT.priceXlm} XLM)</div><div>Power Pack: up to {TIERS.POWER.maxBatch} ({TIERS.POWER.priceXlm} XLM)</div><div>Platform payment destination: {PLATFORM_PAYMENT_DESTINATION}</div>
  </div>
  <p class="text-xs opacity-80 mt-2">Pay with Stellar. Platform payments are separate from QR drop intents. Manual verification pending.</p>
</div>
