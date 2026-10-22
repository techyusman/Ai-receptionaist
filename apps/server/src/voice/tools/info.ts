import { WEEKDAYS, addDays, describeDay, isOpenAt, localClock } from "@receptionist/domain";
import { many, withSystem, type Tx } from "@receptionist/db";
import { z } from "zod";
import { orderingAvailability } from "../availability.ts";
import type { CallContext } from "../context.ts";
import { loadMenu } from "../../menu/read.ts";
import { readHours, readSpecialHours } from "../../routes/hours.ts";
import { ok, type ToolDef } from "./types.ts";
import { prettyPhone } from "@receptionist/domain";

const schema = z.object({
  topic: z.enum(["hours", "address", "directions", "phone", "pickup", "ordering", "other"]),
  question: z.string().trim().max(200).optional(),
});

async function faqMatches(tx: Tx, locationId: string, question: string, at: Date) {
  return many<{ question: string; answer: string; score: number }>(
    tx,
    `select question, answer,
            greatest(similarity(lower(question), lower($2)), coalesce((select max(similarity(lower(a), lower($2))) from unnest(question_aliases) a), 0))::float as score
       from faqs where location_id = $1 and active and reviewed and (valid_from is null or valid_from <= $3) and (valid_until is null or valid_until > $3)
      order by score desc limit 3`,
    [locationId, question, at.toISOString()],
  );
}

export const getRestaurantInfo: ToolDef<typeof schema> = {
  name: "get_restaurant_info",
  description: "Look up facts about the restaurant: opening hours (including holidays), address, directions, phone, pickup policy, whether phone ordering is available, or answer a question from the restaurant's own notes. Only say what this returns.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", enum: ["hours", "address", "directions", "phone", "pickup", "ordering", "other"], description: "What the caller asked about." },
      question: { type: "string", description: "The caller's question in their words, for topic 'other'." },
    },
    required: ["topic"],
  },
  schema,
  async run(deps, ctx, args) {
    return withSystem(deps.db, async (tx) => {
      const now = deps.now();
      const [hours, specials, notices] = await Promise.all([
        readHours(tx, ctx.locationId),
        readSpecialHours(tx, ctx.locationId),
        many<{ message: string }>(tx, "select message from notices where location_id = $1 and starts_at <= $2 and ends_at > $2 order by starts_at", [ctx.locationId, now.toISOString()]),
      ]);
      const noticeList = notices.map((n) => n.message);
      switch (args.topic) {
        case "hours": {
          if (!hours.store.length) return ok({ known: false, say_if_unknown: "I don't have our hours in front of me. I can pass you to someone." });
          const today = localClock(now, ctx.timezone).date;
          const week = Array.from({ length: 7 }, (_, i) => {
            const d = addDays(today, i);
            const wd = localClock(new Date(`${d}T12:00:00Z`), "UTC").weekday;
            return `${i === 0 ? "Today" : WEEKDAYS[wd]}: ${describeDay(d, hours.store, specials)}`;
          });
          return ok({ known: true, open_now: isOpenAt(hours.store, specials, now, ctx.timezone), week, notices: noticeList });
        }
        case "address":
          return ctx.address ? ok({ known: true, address: ctx.address, notices: noticeList }) : ok({ known: false });
        case "directions":
          return ctx.directions ? ok({ known: true, directions: ctx.directions }) : ok({ known: false });
        case "phone":
          return ctx.publicPhone ? ok({ known: true, phone: prettyPhone(ctx.publicPhone) }) : ok({ known: false });
        case "pickup": {
          const s = ctx.settings;
          const est = s.pickupEstimateMinutes ? `Orders are usually ready in about ${s.pickupEstimateMinutes} minutes.` : null;
          return s.pickupPolicy || est ? ok({ known: true, policy: s.pickupPolicy || null, typical_wait: est }) : ok({ known: false });
        }
        case "ordering": {
          const menu = await loadMenu(tx, ctx.locationId);
          const a = await orderingAvailability(deps, tx, ctx, menu);
          return ok({ known: true, can_take_orders_now: a.available, ...(a.available ? {} : { why_not: a.say }), notices: noticeList });
        }
        default: {
          const matches = args.question ? (await faqMatches(tx, ctx.locationId, args.question, now)).filter((m) => m.score >= 0.2) : [];
          return matches.length
            ? ok({ known: true, answers: matches.map((m) => ({ question: m.question, answer: m.answer })), notices: noticeList })
            : ok({ known: false, say_if_unknown: "I don't have that information. I can pass you to someone, or take a message.", notices: noticeList });
        }
      }
    });
  },
};
export type { CallContext };
