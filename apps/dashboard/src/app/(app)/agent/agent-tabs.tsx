"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "@/lib/cn";

const tabs = [
  { href: "/agent", label: "Greeting" },
  { href: "/agent/call-handling", label: "Call handling" },
  { href: "/agent/orders", label: "Orders" },
  { href: "/agent/transfers", label: "Transfers" },
  { href: "/agent/voice", label: "Voice" },
  { href: "/agent/phone", label: "Phone number" },
  { href: "/agent/test", label: "Test" },
];

/** Route-based tabs (S16–S22): each tab is its own URL, so it can be linked and the back button works. */
export function AgentTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="AI agent settings" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-semibold transition-colors",
                  active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                  focusRing,
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
