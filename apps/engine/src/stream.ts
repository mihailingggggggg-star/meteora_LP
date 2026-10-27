import { env } from "./env.js";
import { journal } from "./journal.js";

type Handler = (value: any) => void;
type Req = { id: number; key: string; method: string; params: any[]; handler: Handler };

/**
 * Минимальный клиент Solana WebSocket (без внешних зависимостей).
 * Работает на бесплатном ключе Helius: стандартные подписки доступны на всех планах.
 */
class SolanaStream {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  private subs = new Map<string, Req>(); // key → подписка (для восстановления)
  private subIdToKey = new Map<number, string>();
  private reconnectAt = 0;
  private connecting = false;
  private pingTimer: any = null;

  connected = false;
  lastEventAt = 0;
  events = 0;
  reconnects = 0;

  private url() {
    const base = env.rpcUrl.replace(/^http/, "ws");
    return base;
  }

  connect() {
    if (this.connecting || this.ws) return;
    this.connecting = true;
    try {
      const ws = new WebSocket(this.url());
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.connected = true;
        this.connecting = false;
        this.reconnects++;
        journal("WS", `подключён, подписок ${this.subs.size}`);
        for (const req of this.subs.values()) void this.request(req);
        this.pingTimer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "ping" }));
          } catch {
            /* ignore */
          }
        }, 25_000);
      });

      ws.addEventListener("message", (ev: any) => this.onMessage(ev.data));

      ws.addEventListener("close", () => this.onClose("close"));
      ws.addEventListener("error", () => this.onClose("error"));
    } catch (err: any) {
      this.connecting = false;
      journal("ERROR", `websocket не открылся: ${err?.message ?? err}`);
      this.onClose("exception");
    }
  }

  private onClose(reason: string) {
    this.connected = false;
    this.ws = null;
    this.connecting = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pending.clear();
    this.subIdToKey.clear();
    const wait = Math.min(30_000, 2000 + this.reconnects * 1000);
    this.reconnectAt = Date.now() + wait;
    if (this.subs.size) journal("WARN", `websocket закрыт (${reason}), переподключение через ${Math.round(wait / 1000)}с`);
    setTimeout(() => this.connect(), wait);
  }

  private onMessage(raw: any) {
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      resolve(msg);
      return;
    }
    const method: string = msg.method ?? "";
    const subId = msg.params?.subscription;
    if (!method || subId == null) return;
    const key = this.subIdToKey.get(subId);
    if (!key) return;
    const req = this.subs.get(key);
    if (!req) return;
    this.events++;
    this.lastEventAt = Date.now();
    try {
      req.handler(msg.params?.result?.value ?? msg.params?.result ?? null);
    } catch {
      /* обработчик не должен ломать поток */
    }
  }

  private request(req: Req): Promise<any> {
    return new Promise((resolve) => {
      if (!this.ws || !this.connected) return resolve(null);
      const id = this.nextId++;
      this.pending.set(id, (msg: any) => {
        if (msg?.result != null && typeof msg.result === "number") {
          this.subIdToKey.set(msg.result, req.key);
        }
        resolve(msg);
      });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: req.method, params: req.params }));
      } catch {
        resolve(null);
      }
    });
  }

  subscribe(key: string, method: string, params: any[], handler: Handler) {
    const req: Req = { id: 0, key, method, params, handler };
    this.subs.set(key, req);
    this.connect();
    if (this.connected) void this.request(req);
  }

  unsubscribe(key: string) {
    const req = this.subs.get(key);
    if (!req) return;
    this.subs.delete(key);
    for (const [subId, k] of this.subIdToKey) {
      if (k === key) {
        this.subIdToKey.delete(subId);
        try {
          this.ws?.send(
            JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "logsUnsubscribe", params: [subId] }),
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  status() {
    return {
      connected: this.connected,
      subscriptions: this.subs.size,
      events: this.events,
      reconnects: this.reconnects,
      lastEventAt: this.lastEventAt,
      endpoint: this.url().split("?")[0],
    };
  }
}

export const solanaStream = new SolanaStream();
