"use client";

import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/overlays";

/** A drawer whose open state lives in the URL (?order=…), so it can be linked and Back closes it. */
export function UrlDrawer({ open, title, closeHref, children }: { open: boolean; title: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Drawer open={open} onOpenChange={(o) => !o && router.push(closeHref, { scroll: false })} title={title}>
      {children}
    </Drawer>
  );
}
