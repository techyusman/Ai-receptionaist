import { orderingInput, settingsInput, updateLocationInput, PRIVACY_SETTINGS, can } from "@receptionist/contracts";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { forbidden, rule } from "../errors.ts";
import { lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { getLocationRow, getSettingsRow, SETTINGS_COLUMNS } from "./location-data.ts";
import { tenant } from "./util.ts";

export function registerLocationRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, (tx) => getLocationRow(tx, lid));
  });

  api.patch("/locations/:lid", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const patch = parse(updateLocationInput, req.body);
    const sets: string[] = [];
    const vals: unknown[] = [lid];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.timezone !== undefined) set("timezone", patch.timezone);
    if (patch.directions !== undefined) set("directions", patch.directions || null);
    if (patch.publicPhone !== undefined) set("public_phone_e164", patch.publicPhone);
    if (patch.website !== undefined) set("website", patch.website);
    if (patch.address) {
      set("address_line1", patch.address.line1);
      set("address_line2", patch.address.line2 || null);
      set("city", patch.address.city);
      set("region", patch.address.region);
      set("postal_code", patch.address.postalCode);
      set("country", patch.address.country.toUpperCase());
    }
    return tenant(deps, a, async (tx) => {
      if (sets.length) await tx.query(`update locations set ${sets.join(", ")} where id = $1`, vals);
      const loc = await getLocationRow(tx, lid);
      await audit(tx, a, meta(req), { action: "location.update", targetType: "location", targetId: lid, target: loc.name, summary: "Updated location details." });
      await signal(tx, lid, { type: "settings" });
      return loc;
    });
  });

  // The Square question: which way phone orders reach the restaurant. Owner only, and the database
  // refuses a combination that hasn't been proven or approved.
  api.patch("/locations/:lid/ordering", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "ordering.mode");
    const input = parse(orderingInput, req.body);
    if (input.mode === "SQUARE" && input.feasibility !== "VERIFIED_NATIVE") {
      throw rule("Square ordering needs the Square test to pass and be signed off first.", "mode");
    }
    if (input.mode === "DASHBOARD_TICKET" && input.feasibility !== "VERIFIED_NATIVE" && input.feasibility !== "FALLBACK_APPROVED") {
      throw rule("Live orders needs the restaurant's written approval recorded first.", "mode");
    }
    return tenant(deps, a, async (tx) => {
      const before = await getLocationRow(tx, lid);
      const changedSignOff = input.feasibility !== before.feasibility;
      await tx.query(
        `update locations set ordering_mode = $2, pos_feasibility = $3, pos_feasibility_note = $4,
                pos_feasibility_signed_off_by = case when $5 then $6::uuid else pos_feasibility_signed_off_by end,
                pos_feasibility_signed_off_at = case when $5 then now() else pos_feasibility_signed_off_at end
          where id = $1`,
        [lid, input.mode, input.feasibility, input.note, changedSignOff, a.userId],
      );
      const loc = await getLocationRow(tx, lid);
      await audit(tx, a, meta(req), {
        action: "ordering.mode", targetType: "location", targetId: lid, target: loc.name,
        summary: `Phone orders: ${input.mode.toLowerCase().replace("_", " ")}; sign-off: ${input.feasibility.toLowerCase().replace("_", " ")}.`,
        before: { mode: before.orderingMode, feasibility: before.feasibility }, after: { mode: input.mode, feasibility: input.feasibility },
      });
      await signal(tx, lid, { type: "settings" });
      return loc;
    });
  });

  api.get("/locations/:lid/settings", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, (tx) => getSettingsRow(tx, lid));
  });

  api.patch("/locations/:lid/settings", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const patch = parse(settingsInput, req.body);
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.some((k) => (PRIVACY_SETTINGS as readonly string[]).includes(k)) && !can(a.role, "privacy.edit")) throw forbidden();
    return tenant(deps, a, async (tx) => {
      if (keys.length) {
        const sets = keys.map((k, i) => `${SETTINGS_COLUMNS[k]} = $${i + 2}`);
        const vals = keys.map((k) => (k === "pickupPolicy" ? patch.pickupPolicy || null : patch[k]));
        await tx.query(`update location_settings set ${sets.join(", ")}, updated_by = $${keys.length + 2} where location_id = $1`, [lid, ...vals, a.userId]);
        await audit(tx, a, meta(req), { action: "settings.update", targetType: "location_settings", targetId: lid, target: "AI agent", summary: `Changed ${keys.join(", ")}.` });
        await signal(tx, lid, { type: "settings" });
      }
      return getSettingsRow(tx, lid);
    });
  });
}
