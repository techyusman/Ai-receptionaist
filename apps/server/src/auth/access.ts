// Answers "who is this, and what can they do here?" for every request. The tenant always comes from
// the URL (a location or a resource id), never from the body, and a person who isn't a member of
// that restaurant gets "not found", so ids can't be probed.
import { can, type Capability, type Role } from "@receptionist/contracts";
import { many, maybeOne, one, withSystem, type Db } from "@receptionist/db";
import { forbidden, notFound } from "../errors.ts";
import type { Identity } from "./jwt.ts";

export type Access = {
  userId: string;
  email: string;
  name: string | null;
  restaurantId: string;
  /** Null on restaurant-level routes. */
  locationId: string | null;
  role: Role;
  actorType: "USER" | "SUPPORT";
};

/** Tables a resource id can be looked up in. The names are fixed here, never taken from a request. */
const RESOURCE_TABLES = {
  order: "orders",
  call: "calls",
  callback: "callback_requests",
  alert: "alerts",
  transferTarget: "transfer_targets",
  specialHours: "special_hours",
  notice: "notices",
  faq: "faqs",
  pronunciation: "pronunciations",
  phoneNumber: "phone_numbers",
  menuItem: "menu_items",
  menuAlias: "menu_aliases",
} as const;
export type ResourceKind = keyof typeof RESOURCE_TABLES;

const ROLE_RANK: Record<Role, number> = { OWNER: 4, MANAGER: 3, STAFF: 2, SUPPORT_LIMITED: 1 };

export class AccessService {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** Creates the user row on first sight and keeps the email current. */
  async ensureUser(id: Identity): Promise<void> {
    await withSystem(this.#db, (tx) =>
      tx.query(
        `insert into users (id, email, display_name) values ($1, $2, $3)
         on conflict (id) do update set email = excluded.email,
           display_name = coalesce(users.display_name, excluded.display_name)
         where users.email is distinct from excluded.email or users.display_name is null`,
        [id.userId, id.email, id.name],
      ),
    );
  }

  async #role(restaurantId: string, locationId: string | null, userId: string): Promise<{ role: Role; actorType: "USER" | "SUPPORT" } | null> {
    return withSystem(this.#db, async (tx) => {
      const rows = await many<{ role: Role }>(
        tx,
        `select role from memberships
          where restaurant_id = $1 and user_id = $2 and status = 'ACTIVE'
            and ($3::uuid is null or location_id is null or location_id = $3)`,
        [restaurantId, userId, locationId],
      );
      const best = rows.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])[0];
      if (best) return { role: best.role, actorType: "USER" as const };
      const grant = await maybeOne(
        tx,
        `select 1 as ok from support_access_grants
          where restaurant_id = $1 and support_user_id = $2 and revoked_at is null and expires_at > now()`,
        [restaurantId, userId],
      );
      return grant ? { role: "SUPPORT_LIMITED" as const, actorType: "SUPPORT" as const } : null;
    });
  }

  async forRestaurant(id: Identity, restaurantId: string, capability?: Capability): Promise<Access> {
    const found = await this.#role(restaurantId, null, id.userId);
    if (!found) throw notFound();
    return this.#finish(id, restaurantId, null, found, capability);
  }

  async forLocation(id: Identity, locationId: string, capability?: Capability): Promise<Access> {
    const loc = await withSystem(this.#db, (tx) => maybeOne<{ restaurant_id: string }>(tx, "select restaurant_id from locations where id = $1", [locationId]));
    if (!loc) throw notFound();
    const found = await this.#role(loc.restaurant_id, locationId, id.userId);
    if (!found) throw notFound();
    return this.#finish(id, loc.restaurant_id, locationId, found, capability);
  }

  async forResource(id: Identity, kind: ResourceKind, resourceId: string, capability?: Capability): Promise<Access & { locationId: string }> {
    const table = RESOURCE_TABLES[kind];
    const row = await withSystem(this.#db, (tx) =>
      maybeOne<{ restaurant_id: string; location_id: string }>(tx, `select restaurant_id, location_id from ${table} where id = $1`, [resourceId]),
    );
    if (!row) throw notFound();
    const found = await this.#role(row.restaurant_id, row.location_id, id.userId);
    if (!found) throw notFound();
    return this.#finish(id, row.restaurant_id, row.location_id, found, capability) as Access & { locationId: string };
  }

  #finish(id: Identity, restaurantId: string, locationId: string | null, found: { role: Role; actorType: "USER" | "SUPPORT" }, capability?: Capability): Access {
    if (capability && !can(found.role, capability)) throw forbidden();
    return { userId: id.userId, email: id.email, name: id.name, restaurantId, locationId, role: found.role, actorType: found.actorType };
  }

  /** The restaurants and locations a person belongs to, for GET /me. */
  async memberships(userId: string) {
    return withSystem(this.#db, async (tx) => {
      const rows = await many<{ restaurant_id: string; restaurant_name: string; slug: string; role: Role; scope_location_id: string | null }>(
        tx,
        `select r.id as restaurant_id, r.name as restaurant_name, r.slug, m.role, m.location_id as scope_location_id
           from memberships m join restaurants r on r.id = m.restaurant_id
          where m.user_id = $1 and m.status = 'ACTIVE' order by r.created_at`,
        [userId],
      );
      const out = [];
      for (const m of rows) {
        const locations = await many<{ id: string; name: string }>(
          tx,
          `select id, name from locations where restaurant_id = $1 and ($2::uuid is null or id = $2) order by created_at`,
          [m.restaurant_id, m.scope_location_id],
        );
        out.push({ restaurant: { id: m.restaurant_id, name: m.restaurant_name, slug: m.slug }, role: m.role, locations });
      }
      return out;
    });
  }

  async userRow(userId: string) {
    return withSystem(this.#db, (tx) => one<{ id: string; email: string; display_name: string | null }>(tx, "select id, email, display_name from users where id = $1", [userId]));
  }
}
