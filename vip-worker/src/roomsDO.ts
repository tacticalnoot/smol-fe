export interface Env {
  VIP_ROOMS: DurableObjectNamespace;
}

type Connection = {
  ws: WebSocket;
  account: string;
  e2ee: { identity: string; dh: string };
  joinedAt: number;
};

function assertNoPlaintext(data: unknown) {
  if (typeof data !== "object" || data === null) return;
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase().includes("plain")) {
      throw new Error("plaintext-field-blocked");
    }
    if (typeof v === "object") assertNoPlaintext(v);
  }
}

export class RoomsDO {
  private connections: Map<string, Connection> = new Map();
  private history: any[] = [];

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const account = request.headers.get("x-vip-account") || "unknown";
    const identity = request.headers.get("x-vip-identity") || "";
    const dh = request.headers.get("x-vip-dh") || "";
    const connId = crypto.randomUUID();

    server.accept();
    const meta: Connection = {
      ws: server,
      account,
      e2ee: { identity, dh },
      joinedAt: Date.now(),
    };

    this.connections.set(connId, meta);

    server.addEventListener("message", (event) => this.onMessage(connId, event));
    server.addEventListener("close", () => this.onClose(connId));
    server.addEventListener("error", () => this.onClose(connId));

    await this.broadcastRoster();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(connId: string, event: MessageEvent) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    try {
      const data = JSON.parse(event.data);
      assertNoPlaintext(data);
      if (data.kind === "chat" || data.kind === "sender-key-share") {
        const enriched = {
          ...data,
          serverTs: Date.now(),
        };
        this.history.push(enriched);
        if (this.history.length > 50) this.history.shift();
        this.broadcast(enriched, connId);
      }
    } catch (err) {
      // drop silently; no plaintext logging
    }
  }

  private onClose(connId: string) {
    this.connections.delete(connId);
    void this.broadcastRoster();
  }

  private broadcast(payload: any, skipConn?: string) {
    const encoded = JSON.stringify(payload);
    for (const [id, connection] of this.connections.entries()) {
      if (id === skipConn) continue;
      try {
        connection.ws.send(encoded);
      } catch {
        // ignore
      }
    }
  }

  private async broadcastRoster() {
    const roster = Array.from(this.connections.values()).map((c) => ({
      id: c.account,
      account: c.account,
      e2ee: c.e2ee,
    }));
    const payload = { kind: "roster", roster };
    this.broadcast(payload);
  }
}
