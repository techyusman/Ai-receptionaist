// A restaurant's Square connection: the stored (encrypted) tokens, and a way to get a working access
// token. Tokens are refreshed a day before they expire. If Square refuses the refresh, the connection
// is marked as needing sign-in, phone ordering through Square is switched off, and staff are alerted.
import type { Integration } from "@receptionist/contracts";
import { maybeOne, withSystem } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import type { Deps } from "../deps.ts";
import { SquareApiError, type SquareApi, type SquareEnvironment } from "../providers/square.ts";

export type IntegrationRow = {
  id: string; restaurant_id: string; location_id: string; environment: SquareEnvironment; merchant_id: string; merchant_name: string | null;
  pos_location_id: string | null; pos_location_name: string | null; status: Integration["status"]; scopes: string[];
  token_expires_at: string | null; last_success_at: string | null; last_error_code: string | null; last_error_at: string | null;
  connected_by_name: string | null;
};

export async function readIntegration(tx: { query: import("@receptionist/db").Tx["query"] }, locationId: string): Promise<IntegrationRow | null> {
  return maybeOne<IntegrationRow>(
    tx as never,
    `select i.id, i.restaurant_id, i.location_id, i.environment, i.merchant_id, i.merchant_name, i.pos_location_id, i.pos_location_name, i.status,
            i.scopes, i.token_expires_at, i.last_success_at, i.last_error_code, i.last_error_at, coalesce(u.display_name, u.email) as connected_by_name
       from pos_integrations i left join users u on u.id = i.connected_by
      where i.location_id = $1 and i.status <> 'DISCONNECTED'`,
    [locationId],
  );
}

export function toIntegration(r: IntegrationRow | null): Integration {
  if (!r) {
    return { provider: "SQUARE", status: "DISCONNECTED", environment: "SANDBOX", merchantName: null, posLocationId: null, posLocationName: null, scopes: [], lastSuccessAt: null, lastErrorCode: null, lastErrorAt: null, connectedBy: null };
  }
  return {
    provider: "SQUARE", status: r.status, environment: r.environment, merchantName: r.merchant_name, posLocationId: r.pos_location_id,
    posLocationName: r.pos_location_name, scopes: r.scopes, lastSuccessAt: r.last_success_at, lastErrorCode: r.last_error_code,
    lastErrorAt: r.last_error_at, connectedBy: r.connected_by_name,
  };
}

export function squareFor(deps: Deps, env: SquareEnvironment): SquareApi {
  if (!deps.providers.square) throw new SquareApiError(0, [{ code: "NOT_CONFIGURED", detail: "Square is not set up on this server yet." }], null);
  return deps.providers.square(env);
}

const REFRESH_AHEAD_MS = 24 * 3_600_000;

export type SquareSession = { api: SquareApi; token: string; env: SquareEnvironment; integrationId: string; restaurantId: string; locationId: string; posLocationId: string | null };

/**
 * A usable access token for a location, refreshed first if it is about to expire. The row is locked
 * while refreshing so two jobs can't both spend the single-use refresh token.
 */
export async function squareSession(deps: Deps, locationId: string): Promise<SquareSession | null> {
  const needsRefresh = await withSystem(deps.db, async (tx) => {
    const r = await maybeOne<{ id: string; status: string; token_expires_at: string | null }>(tx, "select id, status, token_expires_at from pos_integrations where location_id = $1 and status = 'CONNECTED'", [locationId]);
    if (!r) return null;
    return !r.token_expires_at || new Date(r.token_expires_at).getTime() - deps.now().getTime() < REFRESH_AHEAD_MS;
  });
  if (needsRefresh === null) return null;
  if (needsRefresh) {
    const outcome = await refreshTokens(deps, locationId);
    if (outcome === "reauth") return null;
    if (outcome === "transient") throw new SquareApiError(0, [{ code: "REFRESH_FAILED", detail: "Square could not be reached to renew the connection." }], null, true);
  }
  return withSystem(deps.db, async (tx) => {
    const r = await maybeOne<{ id: string; restaurant_id: string; environment: SquareEnvironment; access_token_ct: Buffer; key_version: number; pos_location_id: string | null }>(
      tx, "select id, restaurant_id, environment, access_token_ct, key_version, pos_location_id from pos_integrations where location_id = $1 and status = 'CONNECTED'", [locationId]);
    if (!r) return null;
    const token = deps.cipher.decrypt(r.access_token_ct, `${r.id}:access`, r.key_version);
    return { api: squareFor(deps, r.environment), token, env: r.environment, integrationId: r.id, restaurantId: r.restaurant_id, locationId, posLocationId: r.pos_location_id };
  });
}

/** Square said no to our credentials: stop using them, stop taking Square orders, and tell a person. */
export async function markNeedsReauth(deps: Deps, tx: import("@receptionist/db").Tx, row: { id: string; restaurant_id: string; location_id: string }, code: string, revoked = false): Promise<void> {
  await tx.query(
    "update pos_integrations set status = $2, last_error_code = $3, last_error_at = now() where id = $1",
    [row.id, revoked ? "REVOKED" : "NEEDS_REAUTH", code],
  );
  await tx.query("update locations set ordering_mode = 'DISABLED' where id = $1 and ordering_mode = 'SQUARE'", [row.location_id]);
  await raiseAlert(deps, tx, {
    restaurantId: row.restaurant_id, locationId: row.location_id, kind: revoked ? "POS_REVOKED" : "POS_AUTH_EXPIRED", severity: "CRITICAL",
    message: revoked ? "Square access was removed. Reconnect Square so the AI can read your menu and place orders." : "The Square connection needs signing in again. Phone orders to Square are paused until you reconnect.",
    dedupeKey: "pos-auth",
  });
}

/** Spends the refresh token for a new pair, under a row lock. "reauth" means the connection needs signing in again. */
export async function refreshTokens(deps: Deps, locationId: string, aheadMs = REFRESH_AHEAD_MS): Promise<"ok" | "reauth" | "transient"> {
  return withSystem(deps.db, async (tx) => {
    const r = await maybeOne<{ id: string; restaurant_id: string; location_id: string; environment: SquareEnvironment; refresh_token_ct: Buffer; key_version: number; token_expires_at: string | null }>(
      tx, "select id, restaurant_id, location_id, environment, refresh_token_ct, key_version, token_expires_at from pos_integrations where location_id = $1 and status = 'CONNECTED' for update", [locationId]);
    if (!r) return "reauth";
    if (r.token_expires_at && new Date(r.token_expires_at).getTime() - deps.now().getTime() >= aheadMs) return "ok"; // someone else just did it
    const api = squareFor(deps, r.environment);
    try {
      const refreshToken = deps.cipher.decrypt(r.refresh_token_ct, `${r.id}:refresh`, r.key_version);
      const t = await api.refreshToken(refreshToken);
      await tx.query(
        `update pos_integrations set access_token_ct = $2, refresh_token_ct = $3, key_version = $4, token_expires_at = $5,
                last_success_at = now(), last_error_code = null, last_error_at = null where id = $1`,
        [r.id, deps.cipher.encrypt(t.accessToken, `${r.id}:access`), deps.cipher.encrypt(t.refreshToken, `${r.id}:refresh`), deps.cipher.version, t.expiresAt],
      );
      return "ok";
    } catch (e) {
      if (e instanceof SquareApiError && !e.ambiguous && e.status >= 400 && e.status < 500) {
        await markNeedsReauth(deps, tx, r, e.code);
        return "reauth";
      }
      await tx.query("update pos_integrations set last_error_code = $2, last_error_at = now() where id = $1", [r.id, e instanceof SquareApiError ? e.code : "REFRESH_FAILED"]);
      return "transient";
    }
  });
}
