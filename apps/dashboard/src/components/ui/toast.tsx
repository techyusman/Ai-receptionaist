"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Toast as RToast } from "radix-ui";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";

type ToastInput = { title: string; description?: string; variant?: "success" | "error" | "info" };
type ToastItem = ToastInput & { id: number };

const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

const look = {
  success: { icon: CircleCheck, cls: "text-success" },
  error: { icon: CircleAlert, cls: "text-danger" },
  info: { icon: Info, cls: "text-accent" },
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: ToastInput) => setItems((xs) => [...xs, { ...t, id: Date.now() + Math.random() }]), []);
  return (
    <Ctx.Provider value={push}>
      <RToast.Provider swipeDirection="right">
        {children}
        {items.map((t) => {
          const v = t.variant ?? "info";
          const Icon = look[v].icon;
          return (
            <RToast.Root
              key={t.id}
              type={v === "error" ? "foreground" : "background"}
              duration={v === "error" ? Infinity : 5000}
              onOpenChange={(open) => !open && setItems((xs) => xs.filter((x) => x.id !== t.id))}
              className="flex items-start gap-3 rounded-md border border-border bg-surface p-4 shadow-pop"
            >
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", look[v].cls)} />
              <div className="flex flex-1 flex-col gap-0.5">
                <RToast.Title className="text-sm font-semibold text-fg">{t.title}</RToast.Title>
                {t.description && <RToast.Description className="text-sm text-muted">{t.description}</RToast.Description>}
              </div>
              <RToast.Close aria-label="Dismiss" className="rounded-sm p-1 text-muted hover:bg-surface-muted">
                <X aria-hidden className="size-4" />
              </RToast.Close>
            </RToast.Root>
          );
        })}
        <RToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-90 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </RToast.Provider>
    </Ctx.Provider>
  );
}
