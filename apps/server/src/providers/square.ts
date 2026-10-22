// Square's public REST API, called with the restaurant's own OAuth token. One small interface so the
// catalog sync, the pricing call and order submission can all be tested against a stub server.
export type SquareEnvironment = "SANDBOX" | "PRODUCTION";

export type SquareToken = { accessToken: string; refreshToken: string; expiresAt: string; merchantId: string; scopes: string[] };
export type SquareLocation = { id: string; name: string; address: string; status: string };

/** One catalog object as Square returns it. Only the fields the sync reads are typed. */
export type CatalogObject = {
  type: string;
  id: string;
  updated_at?: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: Record<string, unknown>;
  item_variation_data?: Record<string, unknown>;
  category_data?: Record<string, unknown>;
  modifier_list_data?: Record<string, unknown>;
  modifier_data?: Record<string, unknown>;
};

export type SquareOrderBody = Record<string, unknown>;
export type SquareOrder = {
  id?: string;
  location_id?: string;
  reference_id?: string;
  state?: string;
  version?: number;
  total_money?: { amount: number; currency: string };
  total_tax_money?: { amount: number; currency: string };
  net_amount_due_money?: { amount: number; currency: string };
  total_discount_money?: { amount: number; currency: string };
  total_service_charge_money?: { amount: number; currency: string };
  fulfillments?: { uid?: string; type?: string; state?: string }[];
  created_at?: string;
  [k: string]: unknown;
};

export class SquareApiError extends Error {
  readonly status: number;
  readonly errors: { category?: string; code?: string; detail?: string; field?: string }[];
  readonly requestId: string | null;
  /** True when the request may or may not have reached Square (timeout, dropped connection). */
  readonly ambiguous: boolean;
  constructor(status: number, errors: SquareApiError["errors"], requestId: string | null, ambiguous = false, message?: string) {
    super(message ?? errors[0]?.detail ?? errors[0]?.code ?? `Square returned ${status}`);
    this.name = "SquareApiError";
    this.status = status;
    this.errors = errors;
    this.requestId = requestId;
    this.ambiguous = ambiguous;
  }
  get code(): string {
    return this.errors[0]?.code ?? (this.ambiguous ? "NETWORK" : `HTTP_${this.status}`);
  }
}

export interface SquareApi {
  authorizeUrl(input: { state: string; redirectUri: string; scopes: readonly string[] }): string;
  obtainToken(input: { code: string; redirectUri: string }): Promise<SquareToken>;
  refreshToken(refreshToken: string): Promise<SquareToken>;
  revokeToken(accessToken: string): Promise<void>;
  merchantName(accessToken: string): Promise<string | null>;
  listLocations(accessToken: string): Promise<SquareLocation[]>;
  /** Every catalog object of the given types (paginated inside). */
  listCatalog(accessToken: string, types: readonly string[]): Promise<{ objects: CatalogObject[]; latestTime: string | null }>;
  /** Objects changed since a time, including deletions. */
  searchCatalogChanges(accessToken: string, since: string): Promise<{ objects: CatalogObject[]; latestTime: string | null }>;
  /** Prices and taxes an order without creating it. */
  calculateOrder(accessToken: string, order: SquareOrderBody): Promise<SquareOrder>;
  createOrder(accessToken: string, order: SquareOrderBody, idempotencyKey: string): Promise<SquareOrder>;
  retrieveOrder(accessToken: string, orderId: string): Promise<SquareOrder | null>;
  /** Orders at a location created since a time (used to find one by its reference_id). */
  searchOrders(accessToken: string, locationId: string, since: string): Promise<SquareOrder[]>;
}

export type SquareApiFactory = (environment: SquareEnvironment) => SquareApi;
