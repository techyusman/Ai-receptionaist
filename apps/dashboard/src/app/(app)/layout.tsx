import { Suspense } from "react";
import { LiveRefresher } from "@/components/app/live-refresher";
import { AppHeader, GlobalBanners, HeaderSkeleton, Sidebar, SidebarSkeleton } from "@/components/app/shell";
import { TooltipProvider } from "@/components/ui/overlays";
import { Toaster } from "@/components/ui/toast";

// The signed-in app (S10). Each session-dependent part streams in behind its own boundary, so the
// frame paints at once and one slow read doesn't hold the page.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Toaster>
      <TooltipProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-pop"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          <aside className="sticky top-0 hidden h-dvh w-(--ds-sidebar) shrink-0 overflow-y-auto border-r border-border bg-surface lg:block">
            <Suspense fallback={<SidebarSkeleton />}>
              <Sidebar />
            </Suspense>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<HeaderSkeleton />}>
              <AppHeader />
            </Suspense>
            <Suspense fallback={null}>
              <GlobalBanners />
            </Suspense>
            <main id="main" tabIndex={-1} className="mx-auto w-full max-w-(--ds-content-max) flex-1 px-4 py-6 outline-none md:px-6">
              {children}
            </main>
          </div>
        </div>
        <LiveRefresher />
      </TooltipProvider>
    </Toaster>
  );
}
