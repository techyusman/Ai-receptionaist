import type { Role } from "@/data/types";

// Who can do what (architecture.md, "API"). The server enforces it on every read and action; the
// UI uses the same table only to hide controls a person can't use.
const matrix = {
  "orders.view": ["OWNER", "MANAGER", "STAFF", "SUPPORT_LIMITED"],
  "orders.accept": ["OWNER", "MANAGER", "STAFF"],
  "orders.manage": ["OWNER", "MANAGER"],
  "calls.view": ["OWNER", "MANAGER", "STAFF", "SUPPORT_LIMITED"],
  "calls.fullPhone": ["OWNER", "MANAGER"],
  "calls.transcript": ["OWNER", "MANAGER"],
  "callbacks.handle": ["OWNER", "MANAGER", "STAFF"],
  "settings.edit": ["OWNER", "MANAGER"],
  "privacy.edit": ["OWNER"],
  "ordering.mode": ["OWNER"],
  "square.connect": ["OWNER", "MANAGER"],
  "square.disconnect": ["OWNER"],
  "numbers.buy": ["OWNER"],
  "menu.overlay": ["OWNER", "MANAGER"],
  "knowledge.edit": ["OWNER", "MANAGER"],
  "analytics.view": ["OWNER", "MANAGER"],
  "agent.test": ["OWNER", "MANAGER"],
  "members.view": ["OWNER", "MANAGER"],
  "members.manage": ["OWNER"],
  "audit.view": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof matrix;

export function can(role: Role, capability: Capability): boolean {
  return (matrix[capability] as readonly Role[]).includes(role);
}

export const roleLabel: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  STAFF: "Staff",
  SUPPORT_LIMITED: "Support (limited)",
};
