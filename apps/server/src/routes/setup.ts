import type { SetupTask } from "@receptionist/contracts";
import { one } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { lidParam, parse, who } from "../http.ts";
import { tenant } from "./util.ts";

export function registerSetupRoutes(api: FastifyInstance, deps: Deps) {
  // The checklist on Overview and Setup: each step is done when the data says so, never when someone ticks a box.
  api.get("/locations/:lid/onboarding", async (req): Promise<SetupTask[]> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => {
      const c = await one<{ number: boolean; square: boolean; hours: boolean; transfer: boolean; faqs: number; ordering: boolean; test: boolean }>(
        tx,
        `select exists (select 1 from phone_numbers where location_id = $1 and enabled and released_at is null) as number,
                exists (select 1 from pos_integrations where location_id = $1 and status = 'CONNECTED' and pos_location_id is not null) as square,
                exists (select 1 from business_hours where location_id = $1 and kind = 'STORE') as hours,
                exists (select 1 from transfer_targets where location_id = $1 and enabled) as transfer,
                (select count(*)::int from faqs where location_id = $1 and active and reviewed) as faqs,
                (select ordering_mode <> 'DISABLED' from locations where id = $1) as ordering,
                exists (select 1 from orders where location_id = $1 and is_test) as test`,
        [lid],
      );
      return [
        { id: "number", title: "Get an AI phone number", detail: "Callers reach the AI on this number.", done: c.number, href: "/agent/phone" },
        { id: "square", title: "Connect Square", detail: "The AI reads your menu and prices from Square.", done: c.square, href: "/square" },
        { id: "hours", title: "Set your opening hours", detail: "The AI only takes orders while you're open.", done: c.hours, href: "/location" },
        { id: "transfer", title: "Add a transfer number", detail: "Where calls go when someone asks for a person.", done: c.transfer, href: "/agent/transfers" },
        { id: "faqs", title: "Answer at least 10 common questions", detail: `${c.faqs} of 10 so far. Parking, allergies, Wi-Fi, that kind of thing.`, done: c.faqs >= 10, href: "/knowledge" },
        { id: "orders", title: "Decide where phone orders go", detail: c.ordering ? "Done. You can change it any time." : "Ordering is off until you choose.", done: c.ordering, href: "/agent/orders" },
        { id: "test", title: "Place a test order", detail: "Walk an order through the AI's steps before callers do.", done: c.test, href: "/agent/test" },
      ];
    });
  });
}
