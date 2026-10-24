// Before an order is sent anywhere it is checked again against the freshest menu: the caller may have
// spent minutes choosing, and the kitchen may have run out of something meanwhile.
import { freshness, validateSelection, type Menu, type Order, type Problem } from "@receptionist/domain";

export type Revalidation = { ok: true } | { ok: false; reason: "STALE_MENU" | "UNAVAILABLE"; problems: Problem[] };

export function revalidate(order: Order, menu: Menu, maxAgeSeconds: number, now: Date): Revalidation {
  if (freshness(menu.syncedAt, maxAgeSeconds, now) === "stale") {
    return { ok: false, reason: "STALE_MENU", problems: [{ code: "ITEM_UNAVAILABLE", message: "The menu hasn't updated recently, so I can't be sure everything is still available." }] };
  }
  const problems: Problem[] = [];
  for (const line of order.lines) {
    problems.push(
      ...validateSelection(
        menu,
        {
          itemId: line.itemId,
          variationId: line.variationId,
          quantity: line.quantity,
          modifiers: line.modifiers.map((m) => ({ listId: m.listId, optionId: m.modifierId, quantity: m.quantity, ...(m.parentModifierId ? { parentOptionId: m.parentModifierId } : {}) })),
        },
        now,
      ),
    );
  }
  return problems.length ? { ok: false, reason: "UNAVAILABLE", problems } : { ok: true };
}
