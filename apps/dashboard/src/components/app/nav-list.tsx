"use client";

import {
  BellRing,
  Bot,
  ChartColumn,
  House,
  MapPin,
  MessageCircleQuestionMark,
  Phone,
  PhoneCall,
  Plug,
  Receipt,
  ScrollText,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "@/lib/cn";
import type { NavGroup, NavIcon } from "./nav";

const icons: Record<NavIcon, LucideIcon> = {
  home: House,
  live: BellRing,
  calls: Phone,
  orders: Receipt,
  callbacks: PhoneCall,
  agent: Bot,
  menu: UtensilsCrossed,
  knowledge: MessageCircleQuestionMark,
  location: MapPin,
  square: Plug,
  analytics: ChartColumn,
  team: Users,
  audit: ScrollText,
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label || "top"} className="flex flex-col gap-0.5">
          {g.label && <p className="px-3 pb-1 text-xs font-semibold text-muted">{g.label}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const Icon = icons[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors duration-(--ds-motion-fast)",
                      active ? "bg-accent-subtle text-accent" : "text-muted hover:bg-surface-muted hover:text-fg",
                      focusRing,
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {!!item.badge && (
                      <span className="rounded-pill bg-accent px-1.5 text-xs text-on-accent">
                        {item.badge}
                        <span className="sr-only"> waiting</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
