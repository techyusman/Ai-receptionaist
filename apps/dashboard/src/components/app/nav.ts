import type { Role } from "@/data/types";
import { can, type Capability } from "@/lib/permissions";

export type NavIcon =
  | "home" | "live" | "calls" | "orders" | "callbacks" | "agent" | "menu" | "knowledge" | "location" | "square"
  | "analytics" | "team" | "audit";

export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
export type NavGroup = { label: string; items: NavItem[] };

const groups: { label: string; items: (NavItem & { needs?: Capability })[] }[] = [
  { label: "", items: [{ href: "/", label: "Overview", icon: "home", needs: "settings.edit" }] },
  {
    label: "Today",
    items: [
      { href: "/live", label: "Live orders", icon: "live" },
      { href: "/calls", label: "Calls", icon: "calls" },
      { href: "/orders", label: "Orders", icon: "orders" },
      { href: "/callbacks", label: "Callbacks", icon: "callbacks" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/agent", label: "AI agent", icon: "agent", needs: "settings.edit" },
      { href: "/menu", label: "Menu", icon: "menu" },
      { href: "/knowledge", label: "Knowledge", icon: "knowledge", needs: "knowledge.edit" },
      { href: "/location", label: "Hours & location", icon: "location", needs: "settings.edit" },
      { href: "/square", label: "Square", icon: "square", needs: "square.connect" },
    ],
  },
  { label: "Insights", items: [{ href: "/analytics", label: "Analytics", icon: "analytics", needs: "analytics.view" }] },
  {
    label: "Settings",
    items: [
      { href: "/settings/team", label: "Team", icon: "team", needs: "members.view" },
      { href: "/settings/audit", label: "Audit log", icon: "audit", needs: "audit.view" },
    ],
  },
];

/** The navigation a role can use, with live counts on Live orders and Callbacks. */
export function navFor(role: Role, counts: { live: number; callbacks: number }): NavGroup[] {
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items
        .filter((i) => !i.needs || can(role, i.needs))
        .map(({ needs: _needs, ...i }) => ({
          ...i,
          badge: i.href === "/live" ? counts.live : i.href === "/callbacks" ? counts.callbacks : undefined,
        })),
    }))
    .filter((g) => g.items.length > 0);
}
