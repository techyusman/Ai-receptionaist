// A small stand-in for Square's REST API, enough to exercise the real HTTP client: OAuth, locations,
// catalog list and search, order pricing, order creation with idempotency, and failures on demand.
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { CatalogObject } from "../providers/square.ts";

type Failure = "none" | "timeout-after-create" | "server-error-before-create" | "bad-request" | "unauthorized";
type Json = Record<string, any>;

export class SquareStub {
  server!: Server;
  url = "";
  catalog: CatalogObject[] = [];
  locations = [{ id: "LSAMPLE0000001", name: "Third Space - Main Street", status: "ACTIVE", address: { address_line_1: "12 Main St", locality: "Brooklyn", administrative_district_level_1: "NY" } }];
  orders = new Map<string, Json>();
  idempotency = new Map<string, { hash: string; orderId: string }>();
  validAccess = new Set<string>();
  refreshTokens = new Map<string, string>();
  revoked: string[] = [];
  requests: { method: string; path: string; version: string | undefined; auth: string | undefined; body: Json | null }[] = [];
  failure: Failure = "none";
  /** Local development only: accept any token, so a restarted stand-in still knows the café's connection. */
  acceptAnyToken = false;
  taxRate = 0.08875;
  seq = 0;
  /** Set to an ISO time to make catalog search report only newer objects. */
  merchantId = "MSAMPLE";

  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((r) => this.server.listen(port, "127.0.0.1", r));
    const addr = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${addr.port}`;
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  #price(order: Json): Json {
    const byId = new Map<string, number>();
    // A variable-priced item (a catering tray) has no price_money; it just isn't in the price list.
    const priceOf = (m: unknown) => (m as { amount?: number } | undefined)?.amount;
    for (const o of this.catalog) {
      if (o.type === "ITEM") for (const v of ((o.item_data?.variations as CatalogObject[]) ?? [])) {
        const amount = priceOf(v.item_variation_data?.price_money);
        if (amount !== undefined) byId.set(v.id, amount);
      }
      if (o.type === "MODIFIER_LIST") for (const m of ((o.modifier_list_data?.modifiers as CatalogObject[]) ?? [])) {
        const amount = priceOf(m.modifier_data?.price_money);
        if (amount !== undefined) byId.set(m.id, amount);
      }
    }
    let subtotal = 0;
    const lines = (order.line_items as Json[]).map((li) => {
      const base = byId.get(li.catalog_object_id);
      if (base === undefined) throw Object.assign(new Error("unknown item"), { status: 400, code: "NOT_FOUND" });
      const mods = ((li.modifiers as Json[]) ?? []).reduce((n, m) => n + (byId.get(m.catalog_object_id) ?? 0) * Number(m.quantity ?? 1), 0);
      const total = (base + mods) * Number(li.quantity);
      subtotal += total;
      return { ...li, total_money: { amount: total, currency: "USD" } };
    });
    const tax = Math.round(subtotal * this.taxRate);
    return { ...order, line_items: lines, total_tax_money: { amount: tax, currency: "USD" }, total_money: { amount: subtotal + tax, currency: "USD" }, net_amount_due_money: { amount: subtotal + tax, currency: "USD" } };
  }

  async #handle(req: IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body: Json | null = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    this.requests.push({ method: req.method ?? "", path: url.pathname, version: req.headers["square-version"] as string | undefined, auth: req.headers.authorization, body });
    const send = (status: number, json: Json, extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", "square-request-id": `req-${++this.seq}`, ...extra });
      res.end(JSON.stringify(json));
    };
    const fail = (status: number, code: string, detail = code) => send(status, { errors: [{ category: status === 401 ? "AUTHENTICATION_ERROR" : "INVALID_REQUEST_ERROR", code, detail }] });
    try {
      await this.#route(req, url, body, send, fail, res);
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      fail(err.status ?? 500, err.code ?? "INTERNAL_SERVER_ERROR", err.message);
    }
  }

  async #route(req: IncomingMessage, url: URL, body: Json | null, send: (s: number, j: Json) => void, fail: (s: number, c: string, d?: string) => void, res: import("node:http").ServerResponse): Promise<void> {
    const p = url.pathname;
    const m = req.method;
    // Square's consent screen, simulated: the "seller" approves at once and is sent back with a code.
    if (p === "/oauth2/authorize" && m === "GET") {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", "good-code");
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return void res.end();
    }
    if (p === "/oauth2/token" && m === "POST") {
      if (body?.grant_type === "authorization_code") {
        if (body.code !== "good-code") return fail(400, "INVALID_GRANT", "bad code");
      } else if (body?.grant_type === "refresh_token") {
        if (!this.acceptAnyToken && !this.refreshTokens.has(body.refresh_token)) return fail(401, "INVALID_GRANT", "bad refresh token");
      } else return fail(400, "UNSUPPORTED_GRANT_TYPE");
      const access = `access-${++this.seq}`;
      const refresh = `refresh-${this.seq}`;
      this.validAccess.add(access);
      this.refreshTokens.set(refresh, access);
      return send(200, { access_token: access, refresh_token: refresh, merchant_id: this.merchantId, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), token_type: "bearer" });
    }
    if (p === "/oauth2/revoke" && m === "POST") {
      this.revoked.push(body?.access_token);
      this.validAccess.delete(body?.access_token);
      return send(200, { success: true });
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (this.failure === "unauthorized" || (!this.acceptAnyToken && !this.validAccess.has(token)) || !token) return fail(401, "UNAUTHORIZED", "token invalid");
    if (p === "/v2/merchants/me") return send(200, { merchant: { id: this.merchantId, business_name: "Third Space" } });
    if (p === "/v2/locations") return send(200, { locations: this.locations });
    if (p === "/v2/catalog/list") {
      const wanted = (url.searchParams.get("types") ?? "").split(",");
      const all = this.catalog.filter((o) => wanted.includes(o.type));
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const page = all.slice(start, start + 7);
      return send(200, { objects: page, ...(start + 7 < all.length ? { cursor: String(start + 7) } : {}) });
    }
    if (p === "/v2/catalog/search" && m === "POST") {
      const since = body?.begin_time as string;
      const changed = this.catalog.filter((o) => (o.updated_at ?? "") > since);
      return send(200, { objects: changed, latest_time: changed.map((o) => o.updated_at ?? "").sort().at(-1) ?? since });
    }
    if (p === "/v2/orders/calculate" && m === "POST") return send(200, { order: this.#price(body!.order) });
    if (p === "/v2/orders" && m === "POST") return this.#create(body!, send, fail, res);
    if (p === "/v2/orders/search" && m === "POST") return send(200, { orders: [...this.orders.values()].filter((o) => o.location_id === body?.location_ids?.[0]) });
    const one = /^\/v2\/orders\/([^/]+)$/.exec(p);
    if (one && m === "GET") {
      const o = this.orders.get(decodeURIComponent(one[1]!));
      return o ? send(200, { order: o }) : fail(404, "NOT_FOUND");
    }
    fail(404, "NOT_FOUND", `${m} ${p}`);
  }

  #create(body: Json, send: (s: number, j: Json) => void, fail: (s: number, c: string, d?: string) => void, res: import("node:http").ServerResponse): void {
    const mode = this.failure;
    if (mode === "server-error-before-create") return fail(500, "INTERNAL_SERVER_ERROR");
    if (mode === "bad-request") return fail(400, "INVALID_VALUE", "line_items[0].quantity is not valid");
    const hash = createHash("sha256").update(JSON.stringify(body.order)).digest("hex");
    const known = this.idempotency.get(body.idempotency_key);
    if (known) {
      if (known.hash !== hash) return fail(400, "IDEMPOTENCY_KEY_REUSED", "same key, different body");
      if (mode === "timeout-after-create") return void setTimeout(() => res.destroy(), 50);
      return send(200, { order: this.orders.get(known.orderId)! });
    }
    const priced = this.#price(body.order);
    const id = `ORD${String(++this.seq).padStart(6, "0")}`;
    const order = { ...priced, id, version: 1, state: "OPEN", created_at: new Date().toISOString(), fulfillments: [{ uid: randomUUID(), type: "PICKUP", state: "PROPOSED" }] };
    this.orders.set(id, order);
    this.idempotency.set(body.idempotency_key, { hash, orderId: id });
    if (mode === "timeout-after-create") return void setTimeout(() => res.destroy(), 50); // created, but the answer never arrives
    send(200, { order });
  }
}
