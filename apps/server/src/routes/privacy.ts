import { eraseInput } from "@receptionist/contracts";
import { many, one } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { rule } from "../errors.ts";
import { meta, parse, ridParam, who } from "../http.ts";
import { parseLocalPhone } from "../phone.ts";
import { tenant } from "./util.ts";

export function registerPrivacyRoutes(api: FastifyInstance, deps: Deps) {
  // A data request: remove everything held about one phone number. Orders keep their items and totals but
  // lose who they were for. The audit entry records that it happened, not the number.
  api.post("/restaurants/:rid/privacy/erase", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "privacy.edit");
    const { phone } = parse(eraseInput, req.body);
    return tenant(deps, a, async (tx) => {
      // Read in the restaurant's countries (a local number like 0300 1234567 in Pakistan); +country works anywhere.
      const countries = await many<{ country: string | null }>(tx, "select distinct country from locations where restaurant_id = $1", [rid]);
      const number = [...countries.map((c) => c.country), "US"].map((c) => parseLocalPhone(phone, c)).find(Boolean);
      if (!number) throw rule("That isn't a full phone number.", "phone");
      const r = await one<{ calls: number; callbacks: number; orders: number }>(tx, "select * from app.erase_person($1, $2)", [rid, number]);
      await audit(tx, a, meta(req), {
        action: "privacy.erase", targetType: "restaurant", targetId: rid, target: "Privacy request",
        summary: `Erased one person's details: ${r.calls} calls, ${r.callbacks} callbacks, ${r.orders} orders. Square keeps its own copy of any order sent there.`,
      });
      return r;
    });
  });
}
