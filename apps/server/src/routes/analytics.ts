import { analyticsQuery, type Analytics, type CallOutcome } from "@receptionist/contracts";
import { addDays, localClock } from "@receptionist/domain";
import { many, one } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { lidParam, parse, who } from "../http.ts";
import { tenant } from "./util.ts";

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

// Counted in the restaurant's own days, so "Tuesday" means Tuesday there. Test calls never count.
export function registerAnalyticsRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/analytics", async (req): Promise<Analytics> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "analytics.view");
    const { range } = parse(analyticsQuery, req.query);
    const days = range === "7d" ? 7 : 30;
    return tenant(deps, a, async (tx) => {
      const { timezone } = await one<{ timezone: string }>(tx, "select timezone from locations where id = $1", [lid]);
      const today = localClock(deps.now(), timezone).date;
      const from = addDays(today, -(days - 1));
      const prevFrom = addDays(from, -days);

      const callDays = await many<{ d: string; calls: number; secs: number; transferred: number }>(
        tx,
        `select (c.started_at at time zone $2)::date as d, count(*)::int as calls, coalesce(sum(c.duration_seconds), 0)::int as secs,
                count(*) filter (where c.outcome = 'TRANSFERRED' or c.transfer_status <> 'NONE')::int as transferred
           from calls c where c.location_id = $1 and not c.is_test and (c.started_at at time zone $2)::date >= $3::date
          group by 1`,
        [lid, timezone, prevFrom],
      );
      const orderDays = await many<{ d: string; orders: number; value: number }>(
        tx,
        `select (o.created_at at time zone $2)::date as d, count(*)::int as orders, coalesce(sum(o.total_minor), 0)::int as value
           from orders o where o.location_id = $1 and not o.is_test and o.local_status = 'RECEIVED_BY_RESTAURANT'
            and (o.created_at at time zone $2)::date >= $3::date group by 1`,
        [lid, timezone, prevFrom],
      );
      const outcomes = await many<{ outcome: CallOutcome; count: number }>(
        tx,
        `select c.outcome, count(*)::int as count from calls c
          where c.location_id = $1 and not c.is_test and c.outcome is not null and (c.started_at at time zone $2)::date >= $3::date
          group by 1 order by 2 desc`,
        [lid, timezone, from],
      );
      const top = await many<{ name: string; count: number }>(
        tx,
        `select oi.item_name as name, sum(oi.quantity)::int as count
           from order_items oi join orders o on o.id = oi.order_id
          where o.location_id = $1 and not o.is_test and o.local_status = 'RECEIVED_BY_RESTAURANT' and (o.created_at at time zone $2)::date >= $3::date
          group by 1 order by 2 desc, 1 limit 5`,
        [lid, timezone, from],
      );

      const callOn = new Map(callDays.map((r) => [r.d, r]));
      const orderOn = new Map(orderDays.map((r) => [r.d, r]));
      const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
      const prevDates = Array.from({ length: days }, (_, i) => addDays(prevFrom, i));
      const sum = <T>(list: string[], m: Map<string, T>, pick: (v: T) => number) => list.reduce((t, d) => t + (m.has(d) ? pick(m.get(d)!) : 0), 0);

      const calls = sum(dates, callOn, (r) => r.calls);
      const callsPrev = sum(prevDates, callOn, (r) => r.calls);
      const orders = sum(dates, orderOn, (r) => r.orders);
      const transferred = sum(dates, callOn, (r) => r.transferred);
      const secs = sum(dates, callOn, (r) => r.secs);
      return {
        range,
        calls,
        callsPrev,
        minutes: Math.round(secs / 60),
        avgCallSeconds: calls ? Math.round(secs / calls) : 0,
        transferredPct: pct(transferred, calls),
        transferredPctPrev: pct(sum(prevDates, callOn, (r) => r.transferred), callsPrev),
        orders,
        ordersPrev: sum(prevDates, orderOn, (r) => r.orders),
        orderValueMinor: sum(dates, orderOn, (r) => r.value),
        conversionPct: pct(orders, calls),
        byDay: dates.map((d) => ({ date: d, calls: callOn.get(d)?.calls ?? 0, orders: orderOn.get(d)?.orders ?? 0 })),
        outcomes,
        topItems: top,
      };
    });
  });
}
