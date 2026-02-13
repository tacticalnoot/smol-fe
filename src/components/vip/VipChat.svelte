<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { VIP_WS_BASE } from "../../lib/vip/config";
  import {
    ClientKeyBundle,
    decryptWithSenderKey,
    encryptWithSenderKey,
    maybeRotateSenderKey,
    wrapSenderKeyForPeer,
    signPayload,
  } from "../../lib/vip/e2ee/protocol";
  import { encodeUtf8, shortKey, base64ToBuf } from "../../lib/vip/e2ee/keys";

  type RosterEntry = {
    account: string;
    e2ee: { identity: string; dh: string };
    id: string;
  };

  type Incoming =
    | { kind: "roster"; roster: RosterEntry[] }
    | { kind: "sender-key-share"; from: string; to: string; wrappedKey: string; nonce: string; keyVersion: number }
    | {
        kind: "chat";
        sender: string;
        ciphertext: string;
        nonce: string;
        keyVersion: number;
        signature: string;
        ts: number;
      }
    | { kind: "system"; message: string };

  export let roomId: string;
  export let token: string;
  export let account: string;
  export let bundle: ClientKeyBundle;
  export let rotation = { messages: 20, minutes: 10 };

  let ws: WebSocket | null = null;
  let status = "connecting";
  let roster: RosterEntry[] = [];
  let messages: Array<{ sender: string; body: string; ts: number }> = [];
  let senderKeys: Record<string, ClientKeyBundle["sender"]> = {};
  let pending = false;
  let input = "";
  let error: string | null = null;

  const MAX_MESSAGES = 50;

  function reset() {
    ws?.close();
    ws = null;
    status = "disconnected";
    roster = [];
    messages = [];
    senderKeys = {};
  }

  async function sendKeyShares(currentRoster: RosterEntry[]) {
    if (!ws) return;
    for (const peer of currentRoster) {
      if (peer.account === account) continue;
      const share = await wrapSenderKeyForPeer(bundle, peer.e2ee.dh);
      ws.send(
        JSON.stringify({
          kind: "sender-key-share",
          from: account,
          to: peer.account,
          wrappedKey: share.wrappedKey,
          nonce: share.nonce,
          keyVersion: share.keyVersion,
        })
      );
    }
    senderKeys[account] = bundle.sender;
  }

  async function handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data) as Incoming;
      if (data.kind === "roster") {
        roster = data.roster;
        await sendKeyShares(roster);
      } else if (data.kind === "sender-key-share") {
        if (data.to !== account && data.to !== "all") return;
        const peer = roster.find((r) => r.account === data.from);
        if (!peer) return;
        const derived = await importSharedKey(data, peer);
        senderKeys[data.from] = derived;
      } else if (data.kind === "chat") {
        const senderKey = senderKeys[data.sender];
        if (!senderKey) {
          console.warn("Missing sender key for", data.sender);
          return;
        }
        try {
          const text = await decryptWithSenderKey(
            senderKey,
            data.ciphertext,
            data.nonce
          );
          messages = [...messages.slice(-MAX_MESSAGES + 1), { sender: data.sender, body: text, ts: data.ts }];
        } catch (err) {
          console.warn("decrypt failed", err);
        }
      }
    } catch (err) {
      console.warn("ws message parse error", err);
    }
  }

  async function importSharedKey(data: Extract<Incoming, { kind: "sender-key-share" }>, peer: RosterEntry) {
    const shared = await importSharedFromPeer(bundle, peer.e2ee.dh, data.wrappedKey, data.nonce);
    shared.version = data.keyVersion;
    return shared;
  }

  async function importSharedFromPeer(
    myBundle: ClientKeyBundle,
    peerDh: string,
    wrapped: string,
    nonce: string
  ) {
    const shared = await crypto.subtle.deriveKey(
      {
        name: "ECDH",
        public: await crypto.subtle.importKey(
          "raw",
          base64ToBuf(peerDh),
          { name: "ECDH", namedCurve: "P-256" },
          true,
          []
        ),
      },
      myBundle.dh.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const keyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(nonce) },
      shared,
      base64ToBuf(wrapped)
    );
    const key = await crypto.subtle.importKey("raw", keyBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    return {
      key,
      version: Date.now(),
      rotatedAt: Date.now(),
      sentCount: 0,
    };
  }

  async function connect() {
    reset();
    const wsUrl = `${VIP_WS_BASE}?room=${encodeURIComponent(
      roomId
    )}&token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(wsUrl);
    ws = socket;
    socket.onopen = async () => {
      status = "connected";
      senderKeys[account] = bundle.sender;
    };
    socket.onclose = () => {
      status = "disconnected";
    };
    socket.onerror = (evt) => {
      console.error("ws error", evt);
      error = "WebSocket error";
    };
    socket.onmessage = (event) => {
      void handleMessage(event);
    };
  }

  async function sendMessage() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!input.trim()) return;
    pending = true;
    try {
      const prevVersion = bundle.sender.version;
      bundle = await maybeRotateSenderKey(bundle, {
        maxMessages: rotation.messages,
        maxMinutes: rotation.minutes,
      });
      if (bundle.sender.version !== prevVersion) {
        senderKeys[account] = bundle.sender;
        await sendKeyShares(roster);
      }
      const { ciphertext, nonce, keyVersion } = await encryptWithSenderKey(
        bundle.sender,
        input.trim()
      );
      const ts = Date.now();
      const sigPayload = encodeUtf8(`${roomId}|${ciphertext}|${nonce}|${keyVersion}|${ts}`);
      const signature = await signPayload(bundle.identity, sigPayload);
      ws.send(
        JSON.stringify({
          kind: "chat",
          sender: account,
          ciphertext,
          nonce,
          keyVersion,
          signature,
          ts,
        })
      );
      messages = [...messages.slice(-MAX_MESSAGES + 1), { sender: account, body: input.trim(), ts }];
      input = "";
    } catch (err) {
      console.error(err);
      error = "Encryption failed; sending disabled";
      status = "blocked";
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    connect();
    return () => reset();
  });

  onDestroy(() => reset());
</script>

<div class="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
  <div class="flex items-center justify-between text-sm text-white/70">
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full {status === 'connected' ? 'bg-emerald-400 animate-pulse' : status === 'blocked' ? 'bg-red-400' : 'bg-yellow-400'}"></span>
      <span>
        {status === "connected"
          ? "Encrypted channel live"
          : status === "blocked"
          ? "E2EE blocked"
          : "Connecting..."}
      </span>
    </div>
    <span class="text-white/50 text-xs">You: {shortKey(account)}</span>
  </div>

  <div class="min-h-[220px] max-h-[360px] overflow-y-auto rounded-xl border border-white/5 bg-black/30 p-3 space-y-2">
    {#if messages.length === 0}
      <p class="text-xs text-white/50">No messages yet. Say hello from another tab to prove realtime.</p>
    {/if}
    {#each messages as msg (msg.ts + msg.sender)}
      <div class="rounded-lg bg-white/5 px-3 py-2">
        <div class="text-xs text-white/60 mb-1">
          {shortKey(msg.sender)}
          <span class="text-white/30"> · {new Date(msg.ts).toLocaleTimeString()}</span>
        </div>
        <div class="text-sm text-white/90 break-words">{msg.body}</div>
      </div>
    {/each}
  </div>

  <div class="flex gap-2">
    <input
      class="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
      placeholder="Type encrypted message"
      bind:value={input}
      on:keydown={(e) => e.key === "Enter" && sendMessage()}
      disabled={pending || status !== "connected"}
    />
    <button
      class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
      on:click={sendMessage}
      disabled={pending || status !== "connected"}
    >
      Send
    </button>
  </div>

  {#if error}
    <p class="text-xs text-rose-300">{error}</p>
  {/if}
</div>
