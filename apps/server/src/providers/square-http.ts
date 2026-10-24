// The real Square client: plain fetch against Square's public REST API with the restaurant's own OAuth
// token, the API version pinned in config, and a time limit on every call. A call that times out or
// drops mid-flight is marked "ambiguous": Square may or may not have acted on it, and order submission
// treats that as an unknown outcome to reconcile, never as a failure.
import {
  SquareApiError,
  type CatalogObject,
  type SquareApi,
  type SquareApiFactory,
  type SquareEnvironment,
  type SquareLocation,
  type SquareOrder,
  type SquareOrderBody,
  type SquareToken,
} from "./square.ts";

export type SquareCredentials = { applicationId: string; applicationSecret: string };

export type SquareClientOptions = {
  apiVersion: string;
  credentials: Partial<Record<SquareEnvironment, SquareCredentials>>;
  /** Override the base URL per environment (tests point this at a local stub). */
  baseUrls?: Partial<Record<SquareEnvironment, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Order creation has a tighter budget: the caller is on the phone. */
  orderTimeoutMs?: number;
};

const BASES: Record<SquareEnvironment, string> = {
  SANDBOX: "https://connect.squareupsandbox.com",
  PRODUCTION: "https://connect.squareup.com",
};

/** The fewest scopes that let us read the menu and place pickup orders. Nothing about payments or customers. */
export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "ITEMS_READ", "ORDERS_READ", "ORDERS_WRITE"] as const;

type Json = Record<string, any>;

export function createSquareFactory(opts: SquareClientOptions): SquareApiFactory {
  return (env) => new HttpSquareApi(env, opts);
}

class HttpSquareApi implements SquareApi {
  readonly #env: SquareEnvironment;
  readonly #o: SquareClientOptions;
  constructor(env: SquareEnvironment, o: SquareClientOptions) {
    this.#env = env;
    this.#o = o;
  }

  get #base() {
    return this.#o.baseUrls?.[this.#env] ?? BASES[this.#env];
  }
  get #creds(): SquareCredentials {
    const c = this.#o.credentials[this.#env];
    if (!c) throw new SquareApiError(0, [{ code: "NOT_CONFIGURED", detail: `Square ${this.#env.toLowerCase()} credentials are not set.` }], null);
    return c;
  }

  async #request(method: string, path: string, init: { token?: string; body?: unknown; auth?: string; timeoutMs?: number; query?: Record<string, string | undefined> } = {}): Promise<Json> {
    const url = new URL(path, this.#base);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "square-version": this.#o.apiVersion, accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.auth) headers.authorization = init.auth;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await (this.#o.fetch ?? fetch)(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? this.#o.timeoutMs ?? 10_000),
      });
    } catch {
      throw new SquareApiError(0, [{ code: "NETWORK", detail: "Square did not answer in time." }], null, true);
    }
    const requestId = res.headers.get("square-request-id") ?? res.headers.get("x-request-id");
    let json: Json = {};
    try {
      json = (await res.json()) as Json;
    } catch {
      // an empty or non-JSON body
    }
    if (!res.ok) {
      // A 5xx may have been processed before it failed; only 4xx is a definite "no".
      throw new SquareApiError(res.status, Array.isArray(json.errors) ? json.errors : [], requestId, res.status >= 500);
    }
    return json;
  }

  authorizeUrl({ state, redirectUri, scopes }: { state: string; redirectUri: string; scopes: readonly string[] }): string {
    const u = new URL("/oauth2/authorize", this.#base);
    u.searchParams.set("client_id", this.#creds.applicationId);
    u.searchParams.set("scope", scopes.join(" "));
    u.searchParams.set("session", "false");
    u.searchParams.set("state", state);
    u.searchParams.set("redirect_uri", redirectUri);
    return u.toString();
  }

  async #tokenCall(body: Json): Promise<SquareToken> {
    const c = this.#creds;
    const j = await this.#request("POST", "/oauth2/token", { body: { client_id: c.applicationId, client_secret: c.applicationSecret, ...body } });
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at, merchantId: j.merchant_id, scopes: [...SQUARE_SCOPES] };
  }
  obtainToken({ code, redirectUri }: { code: string; redirectUri: string }) {
    return this.#tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  }
  refreshToken(refreshToken: string) {
    return this.#tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
  }
  async revokeToken(accessToken: string) {
    const c = this.#creds;
    await this.#request("POST", "/oauth2/revoke", { auth: `Client ${c.applicationSecret}`, body: { client_id: c.applicationId, access_token: accessToken } });
  }

  async merchantName(accessToken: string) {
    const j = await this.#request("GET", "/v2/merchants/me", { token: accessToken });
    return (j.merchant?.business_name as string | undefined) ?? null;
  }

  async listLocations(accessToken: string): Promise<SquareLocation[]> {
    const j = await this.#request("GET", "/v2/locations", { token: accessToken });
    return ((j.locations ?? []) as Json[]).map((l) => ({
      id: l.id,
      name: l.name ?? l.business_name ?? "Location",
      status: l.status ?? "ACTIVE",
      address: [l.address?.address_line_1, l.address?.locality, l.address?.administrative_district_level_1].filter(Boolean).join(", "),
    }));
  }

  async #catalogPages(accessToken: string, fetchPage: (cursor: string | undefined) => Promise<Json>): Promise<{ objects: CatalogObject[]; latestTime: string | null }> {
    const objects: CatalogObject[] = [];
    let latest: string | null = null;
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const j = await fetchPage(cursor);
      objects.push(...((j.objects ?? []) as CatalogObject[]));
      if (typeof j.latest_time === "string" && (!latest || j.latest_time > latest)) latest = j.latest_time;
      cursor = j.cursor || undefined;
      if (!cursor) break;
    }
    for (const o of objects) if (o.updated_at && (!latest || o.updated_at > latest)) latest = o.updated_at;
    void accessToken;
    return { objects, latestTime: latest };
  }

  listCatalog(accessToken: string, types: readonly string[]) {
    return this.#catalogPages(accessToken, (cursor) => this.#request("GET", "/v2/catalog/list", { token: accessToken, query: { types: types.join(","), cursor }, timeoutMs: 20_000 }));
  }

  searchCatalogChanges(accessToken: string, since: string) {
    return this.#catalogPages(accessToken, (cursor) =>
      this.#request("POST", "/v2/catalog/search", {
        token: accessToken,
        body: { begin_time: since, include_deleted_objects: true, limit: 1000, ...(cursor ? { cursor } : {}) },
        timeoutMs: 20_000,
      }),
    );
  }

  async calculateOrder(accessToken: string, order: SquareOrderBody): Promise<SquareOrder> {
    const j = await this.#request("POST", "/v2/orders/calculate", { token: accessToken, body: { order } });
    return j.order as SquareOrder;
  }

  async createOrder(accessToken: string, order: SquareOrderBody, idempotencyKey: string): Promise<SquareOrder> {
    const j = await this.#request("POST", "/v2/orders", {
      token: accessToken,
      body: { idempotency_key: idempotencyKey, order },
      timeoutMs: this.#o.orderTimeoutMs ?? 8_000,
    });
    return j.order as SquareOrder;
  }

  async retrieveOrder(accessToken: string, orderId: string): Promise<SquareOrder | null> {
    try {
      const j = await this.#request("GET", `/v2/orders/${encodeURIComponent(orderId)}`, { token: accessToken });
      return j.order as SquareOrder;
    } catch (e) {
      if (e instanceof SquareApiError && e.status === 404) return null;
      throw e;
    }
  }

  async searchOrders(accessToken: string, locationId: string, since: string): Promise<SquareOrder[]> {
    const j = await this.#request("POST", "/v2/orders/search", {
      token: accessToken,
      body: {
        location_ids: [locationId],
        query: { filter: { date_time_filter: { created_at: { start_at: since } } }, sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
        limit: 100,
      },
    });
    return (j.orders ?? []) as SquareOrder[];
  }
}
