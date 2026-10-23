// The only sentences the AI may use about an order's fate. Each claim is the most the system has
// verified, never more (spec FR-ORDER-015): "the restaurant has your order" is said only after a
// person there acknowledged it. Shared by the voice agent and the dashboard's test call.
import type { CallerClaim, Order } from "./order.ts";

export function whatToSay(claim: CallerClaim, order: Pick<Order, "posMode">): string {
  switch (claim) {
    case "RECEIVED":
      return "The restaurant has your order and is working on it.";
    case "SENT_NOT_ACKNOWLEDGED":
      return order.posMode === "DASHBOARD_TICKET"
        ? "I've sent your order to the restaurant. I can't promise it's been seen yet, but it's on their screen."
        : "I've sent your order to the restaurant's system. I can't promise it's been seen yet.";
    case "SENDING":
      return "One moment, I'm sending that to the restaurant now.";
    case "UNCERTAIN":
      return "I'm not certain your order went through. I've alerted the team, and they will call you back to confirm it. Please don't count on it until they do.";
    case "STOPPED":
      return "I wasn't able to place that order. I'm sorry. I can pass you to a person or take a number for a call back.";
    default:
      return "That order hasn't been placed yet.";
  }
}
