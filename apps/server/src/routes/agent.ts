import { pronunciationInput, transferTargetInput, type Pronunciation, type TransferTarget } from "@receptionist/contracts";
import { many, maybeOne, one, type Tx } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notFound, rule } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { tenant } from "./util.ts";

type TargetRow = {
  id: string; label: string; e164: string; priority: number; intent: TransferTarget["intent"];
  active_hours: TransferTarget["activeHours"]; sms_alert_on_miss: boolean; enabled: boolean;
};
const TARGET_COLUMNS = "id, label, e164, priority, intent, active_hours, sms_alert_on_miss, enabled";
const toTarget = (r: TargetRow): TransferTarget => ({
  id: r.id, label: r.label, e164: r.e164, priority: r.priority, intent: r.intent, activeHours: r.active_hours, smsAlertOnMiss: r.sms_alert_on_miss, enabled: r.enabled,
});

/** A transfer to one of our own numbers would ring the AI again and loop forever. */
async function assertNotAiNumber(tx: Tx, locationId: string, e164: string) {
  const own = await maybeOne(tx, "select 1 as x from phone_numbers where location_id = $1 and e164 = $2 and released_at is null", [locationId, e164]);
  if (own) throw rule("That's your AI number. Transfers to it would loop back to the AI.", "e164");
}

export function registerAgentRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/transfer-targets", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => (await many<TargetRow>(tx, `select ${TARGET_COLUMNS} from transfer_targets where location_id = $1 order by priority, created_at`, [lid])).map(toTarget));
  });

  api.post("/locations/:lid/transfer-targets", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const input = parse(transferTargetInput, req.body);
    const created = await tenant(deps, a, async (tx) => {
      await assertNotAiNumber(tx, lid, input.e164);
      const r = await one<TargetRow>(
        tx,
        `insert into transfer_targets (restaurant_id, location_id, label, e164, priority, intent, active_hours, sms_alert_on_miss, enabled)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${TARGET_COLUMNS}`,
        [a.restaurantId, lid, input.label, input.e164, input.priority, input.intent, input.activeHours, input.smsAlertOnMiss, input.enabled],
      );
      await audit(tx, a, meta(req), { action: "transfers.save", targetType: "transfer_target", targetId: r.id, target: input.label, summary: `Saved transfer number ${input.label}.` });
      return toTarget(r);
    });
    return reply.status(201).send(created);
  });

  api.put("/transfer-targets/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "transferTarget", id, "settings.edit");
    const input = parse(transferTargetInput, req.body);
    return tenant(deps, a, async (tx) => {
      await assertNotAiNumber(tx, a.locationId, input.e164);
      const r = await maybeOne<TargetRow>(
        tx,
        `update transfer_targets set label = $2, e164 = $3, priority = $4, intent = $5, active_hours = $6, sms_alert_on_miss = $7, enabled = $8
          where id = $1 returning ${TARGET_COLUMNS}`,
        [id, input.label, input.e164, input.priority, input.intent, input.activeHours, input.smsAlertOnMiss, input.enabled],
      );
      if (!r) throw notFound();
      await audit(tx, a, meta(req), { action: "transfers.save", targetType: "transfer_target", targetId: id, target: input.label, summary: `Saved transfer number ${input.label}.` });
      return toTarget(r);
    });
  });

  api.delete("/transfer-targets/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "transferTarget", id, "settings.edit");
    await tenant(deps, a, async (tx) => {
      const gone = await maybeOne<{ label: string }>(tx, "delete from transfer_targets where id = $1 returning label", [id]);
      if (gone) await audit(tx, a, meta(req), { action: "transfers.delete", targetType: "transfer_target", targetId: id, target: gone.label, summary: `Removed transfer number ${gone.label}.` });
    });
    return reply.status(204).send();
  });

  api.get("/locations/:lid/pronunciations", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) =>
      (await many<{ id: string; term: string; spoken_as: string }>(tx, "select id, term, spoken_as from pronunciations where location_id = $1 order by lower(term)", [lid])).map(
        (r): Pronunciation => ({ id: r.id, term: r.term, spokenAs: r.spoken_as }),
      ),
    );
  });

  api.post("/locations/:lid/pronunciations", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const input = parse(pronunciationInput, req.body);
    const created = await tenant(deps, a, async (tx) => {
      const dup = await maybeOne(tx, "select id from pronunciations where location_id = $1 and lower(term) = lower($2)", [lid, input.term]);
      if (dup) throw conflict("That word is already on the list.", "term");
      const r = await one<{ id: string }>(
        tx,
        "insert into pronunciations (restaurant_id, location_id, term, spoken_as, created_by) values ($1, $2, $3, $4, $5) returning id",
        [a.restaurantId, lid, input.term, input.spokenAs, a.userId],
      );
      return { id: r.id, term: input.term, spokenAs: input.spokenAs } satisfies Pronunciation;
    });
    return reply.status(201).send(created);
  });

  api.delete("/pronunciations/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "pronunciation", id, "settings.edit");
    await tenant(deps, a, (tx) => tx.query("delete from pronunciations where id = $1", [id]));
    return reply.status(204).send();
  });
}
