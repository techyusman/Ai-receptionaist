// Builds the body Square's Orders API takes, from the order as stored in Postgres. The same body prices
// the order (CalculateOrder) and creates it (CreateOrder), so the total read to the caller is the total
// Square will hold. Lines reference catalog ids only: names and prices always come from Square.
import { createHash } from "node:crypto";
import { many, one, type Tx } from "@receptionist/db";
import type { SquareOrderBody } from "../providers/square.ts";

type LineRow = { id: string; line_no: number; square_variation_id: string; quantity: number; special_instructions: string | null };
type ModRow = { order_item_id: string; square_modifier_id: string; quantity: number };

export async function buildSquareOrder(tx: Tx, orderId: string, squareLocationId: string): Promise<SquareOrderBody> {
  const order = await one<{ customer_name: string | null; customer_phone_e164: string | null; special_instructions: string | null; pickup_at: string | null }>(
    tx, "select customer_name, customer_phone_e164, special_instructions, pickup_at from orders where id = $1", [orderId]);
  const lines = await many<LineRow>(tx, "select id, line_no, square_variation_id, quantity, special_instructions from order_items where order_id = $1 order by line_no", [orderId]);
  const mods = lines.length
    ? await many<ModRow>(tx, "select order_item_id, square_modifier_id, quantity from order_item_modifiers where order_item_id = any($1::uuid[]) order by created_at, id", [lines.map((l) => l.id)])
    : [];
  return {
    location_id: squareLocationId,
    // Our order id, so a lost response can be matched to the Square order later.
    reference_id: orderId,
    source: { name: "AI phone receptionist" },
    line_items: lines.map((l) => ({
      catalog_object_id: l.square_variation_id,
      quantity: String(l.quantity),
      ...(l.special_instructions ? { note: l.special_instructions } : {}),
      // Nested choices are sent flat; each is a real catalog modifier id.
      modifiers: mods.filter((m) => m.order_item_id === l.id).map((m) => ({ catalog_object_id: m.square_modifier_id, quantity: String(m.quantity) })),
    })),
    fulfillments: [
      {
        type: "PICKUP",
        state: "PROPOSED",
        pickup_details: {
          recipient: { ...(order.customer_name ? { display_name: order.customer_name } : {}), ...(order.customer_phone_e164 ? { phone_number: order.customer_phone_e164 } : {}) },
          schedule_type: order.pickup_at ? "SCHEDULED" : "ASAP",
          ...(order.pickup_at ? { pickup_at: order.pickup_at } : {}),
          ...(order.special_instructions ? { note: order.special_instructions } : {}),
        },
      },
    ],
  };
}

/** One idempotency key always goes with exactly one body. This is what proves it. */
export function requestHash(body: SquareOrderBody): Buffer {
  return createHash("sha256").update(JSON.stringify(body)).digest();
}
