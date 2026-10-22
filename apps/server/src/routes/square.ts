import { squareConnectInput, squareLocationInput, type SquareLocationOption } from "@receptionist/contracts";
import { maybeOne, pgError, PG, withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import { randomToken, sha256 } from "../crypto.ts";
import type { Deps } from "../deps.ts";
import { conflict, notConfigured, rule, upstream } from "../errors.ts";
import { lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { readIntegration, squareFor, squareSession, toIntegration } from "../pos/integration.ts";
import { SQUARE_SCOPES } from "../providers/square-http.ts";
import { SquareApiError } from "../providers/square.ts";
import { tenant } from "./util.ts";

const STATE_MINUTES = 10;
export const callbackUrl = (deps: Deps) => `${deps.config.PUBLIC_API_BASE_URL.replace(/\/$/, "")}/oauth/square/callback`;

export function registerSquareRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/integrations", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => toIntegration(await readIntegration(tx, lid)));
  });

  // Step 1 of connecting: hand the browser to Square's own sign-in. Nothing is stored until Square sends the person back.
  api.post("/locations/:lid/integrations/square/connect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "square.connect");
    const { environment } = parse(squareConnectInput, req.body);
    if (!deps.providers.square) throw notConfigured("Square");
    const state = randomToken();
    const url = squareFor(deps, environment).authorizeUrl({ state, redirectUri: callbackUrl(deps), scopes: SQUARE_SCOPES });
    await tenant(deps, a, (tx) =>
      tx.query(
        `insert into oauth_states (restaurant_id, location_id, user_id, environment, state_hash, expires_at, return_path)
         values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6), '/square')`,
        [a.restaurantId, lid, a.userId, environment, sha256(state), STATE_MINUTES],
      ),
    );
    return { url };
  });

  api.get("/locations/:lid/integrations/square/locations", async (req): Promise<SquareLocationOption[]> => {
    const { lid } = parse(lidParam, req.params);
    await deps.access.forLocation(who(req), lid, "square.connect");
    const session = await squareSession(deps, lid);
    if (!session) throw rule("Connect Square first.");
    try {
      const list = await session.api.listLocations(session.token);
      return list.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.id, name: l.name, address: l.address }));
    } catch (e) {
      if (e instanceof SquareApiError) throw upstream("Square didn't answer. Try again in a moment.");
      throw e;
    }
  });

  api.put("/locations/:lid/integrations/square/location", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "square.connect");
    const { posLocationId } = parse(squareLocationInput, req.body);
    const session = await squareSession(deps, lid);
    if (!session) throw rule("Connect Square first, then pick a location.");
    const options = await session.api.listLocations(session.token).catch(() => {
      throw upstream("Square didn't answer. Try again in a moment.");
    });
    const chosen = options.find((l) => l.id === posLocationId);
    if (!chosen) throw rule("Pick a location from the list.");
    return tenant(deps, a, async (tx) => {
      try {
        await tx.query("update pos_integrations set pos_location_id = $2, pos_location_name = $3 where id = $1", [session.integrationId, chosen.id, chosen.name]);
      } catch (e) {
        if (pgError(e)?.code === PG.uniqueViolation) throw conflict("That Square location is already connected to another restaurant.");
        throw e;
      }
      await audit(tx, a, meta(req), { action: "square.location", targetType: "pos_integration", targetId: session.integrationId, target: chosen.name, summary: `Linked Square location “${chosen.name}”.` });
      await deps.jobs.enqueue("catalog.sync", { locationId: lid, kind: "FULL", trigger: "CONNECT" }, { tx, singletonKey: `sync:${lid}` });
      await signal(tx, lid, { type: "menu" });
      return toIntegration(await readIntegration(tx, lid));
    });
  });

  api.post("/locations/:lid/integrations/square/disconnect", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "square.disconnect");
    const session = await squareSession(deps, lid).catch(() => null);
    // Revoke at Square first so the token dies even if our database write below fails.
    if (session) await session.api.revokeToken(session.token).catch(() => undefined);
    return tenant(deps, a, async (tx) => {
      await tx.query(
        `update pos_integrations set status = 'DISCONNECTED', access_token_ct = null, refresh_token_ct = null, token_expires_at = null,
                pos_location_id = null, pos_location_name = null, scopes = '{}'
          where location_id = $1 and status <> 'DISCONNECTED'`,
        [lid],
      );
      await tx.query("update locations set ordering_mode = 'DISABLED' where id = $1 and ordering_mode = 'SQUARE'", [lid]);
      await audit(tx, a, meta(req), { action: "square.disconnect", targetType: "location", targetId: lid, target: "Square", summary: "Disconnected Square. Square ordering was switched off." });
      await signal(tx, lid, { type: "settings" });
      return toIntegration(null);
    });
  });

  // Manual resync. One at a time per location and at most once a minute, so Square's limits are never at risk.
  api.post("/locations/:lid/menu/sync", { config: { rateLimit: { max: 1, timeWindow: "1 minute", keyGenerator: (req: { params?: unknown }) => `sync:${(req.params as { lid?: string })?.lid}` } } }, async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "square.connect");
    await tenant(deps, a, async (tx) => {
      const integration = await readIntegration(tx, lid);
      if (integration?.status !== "CONNECTED" || !integration.pos_location_id) throw rule("Connect Square and pick a location before syncing.");
      await deps.jobs.enqueue("catalog.sync", { locationId: lid, kind: "FULL", trigger: "MANUAL" }, { tx, singletonKey: `sync:${lid}` });
      await signal(tx, lid, { type: "menu" });
    });
    return reply.status(202).send({ ok: true });
  });
}

/**
 * Square sends the browser back here after the owner approves. There is no bearer token on this request:
 * the one-time state we issued is what ties it to a restaurant, a location and the person who started it.
 * Returns where to send the browser next.
 */
export async function completeSquareOAuth(deps: Deps, q: { code?: string; state?: string; error?: string }): Promise<string> {
  const dash = deps.config.DASHBOARD_ORIGIN.replace(/\/$/, "");
  if (!q.state) return `${dash}/square?error=state`;
  if (q.error || !q.code) {
    // The owner pressed Deny, or Square reported a problem. Burn the state and go back.
    await withSystem(deps.db, (tx) => tx.query("update oauth_states set used_at = now() where state_hash = $1 and used_at is null", [sha256(q.state!)]));
    return `${dash}/square?error=${q.error === "access_denied" ? "denied" : "failed"}`;
  }
  const state = await withSystem(deps.db, (tx) =>
    maybeOne<{ id: string; restaurant_id: string; location_id: string; user_id: string; environment: "SANDBOX" | "PRODUCTION"; return_path: string | null }>(
      tx,
      `update oauth_states set used_at = now() where state_hash = $1 and used_at is null and expires_at > now()
       returning id, restaurant_id, location_id, user_id, environment, return_path`,
      [sha256(q.state!)],
    ),
  );
  if (!state) return `${dash}/square?error=expired`;
  const api = squareFor(deps, state.environment);
  let token;
  try {
    token = await api.obtainToken({ code: q.code, redirectUri: callbackUrl(deps) });
  } catch {
    return `${dash}${state.return_path ?? "/square"}?error=failed`;
  }
  const merchantName = await api.merchantName(token.accessToken).catch(() => null);
  try {
    await withSystem(deps.db, async (tx) => {
      const existing = await maybeOne<{ id: string; merchant_id: string }>(tx, "select id, merchant_id from pos_integrations where location_id = $1 and status <> 'DISCONNECTED' for update", [state.location_id]);
      let id = existing?.id;
      if (!id) {
        const r = await tx.query<{ id: string }>(
          "insert into pos_integrations (restaurant_id, location_id, environment, merchant_id, status, connected_by) values ($1, $2, $3, $4, 'DISCONNECTED', $5) returning id",
          [state.restaurant_id, state.location_id, state.environment, token.merchantId, state.user_id],
        );
        id = r.rows[0]!.id;
      }
      // A different Square account than before means the old location choice no longer applies.
      const sameMerchant = !existing || existing.merchant_id === token.merchantId;
      await tx.query(
        `update pos_integrations set environment = $2, merchant_id = $3, merchant_name = $4, access_token_ct = $5, refresh_token_ct = $6, key_version = $7,
                token_expires_at = $8, scopes = $9, status = 'CONNECTED', last_success_at = now(), last_error_code = null, last_error_at = null, connected_by = $10,
                pos_location_id = case when $11 then pos_location_id else null end, pos_location_name = case when $11 then pos_location_name else null end
          where id = $1`,
        [id, state.environment, token.merchantId, merchantName, deps.cipher.encrypt(token.accessToken, `${id}:access`), deps.cipher.encrypt(token.refreshToken, `${id}:refresh`),
         deps.cipher.version, token.expiresAt, token.scopes, state.user_id, sameMerchant],
      );
      await tx.query(
        `insert into audit_logs (restaurant_id, actor_user_id, actor_type, action, target_type, target_id, after_redacted)
         values ($1, $2, 'USER', 'square.connect', 'pos_integration', $3, $4)`,
        [state.restaurant_id, state.user_id, id, JSON.stringify({ target: "Square", summary: `Connected Square (${state.environment.toLowerCase()}).` })],
      );
      await signal(tx, state.location_id, { type: "settings" });
    });
  } catch (e) {
    if (pgError(e)?.code === PG.uniqueViolation) return `${dash}${state.return_path ?? "/square"}?error=claimed`;
    throw e;
  }
  return `${dash}${state.return_path ?? "/square"}?connected=1`;
}

