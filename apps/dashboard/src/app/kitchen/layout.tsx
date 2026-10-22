import { LiveRefresher } from "@/components/app/live-refresher";
import { Toaster } from "@/components/ui/toast";

// Full-screen Live orders for a kitchen tablet (S41, kitchen mode). Dark by default, no sidebar.
export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return (
    <Toaster>
      <div data-theme="dark" className="min-h-dvh bg-canvas text-fg">
        {children}
      </div>
      <LiveRefresher />
    </Toaster>
  );
}
