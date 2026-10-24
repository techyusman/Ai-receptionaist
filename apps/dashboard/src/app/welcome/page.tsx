import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getMe } from "@/server/auth";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = { title: "Set up your restaurant" };

// For someone signed in who isn't on any team yet: start a restaurant, or open an invitation link.
async function Gate() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.memberships.length) redirect("/");
  return me.pendingInvites.length ? (
    <p className="rounded-md border border-border p-3 text-sm text-muted">
      You have an invitation to {me.pendingInvites[0]!.restaurantName}. Open the link in that email to join it instead.
    </p>
  ) : null;
}

export default function WelcomePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-140 flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl text-fg">Set up your restaurant</h1>
          <p className="text-sm text-muted">A few details to start. Phone number, menu and hours come next, on the setup checklist.</p>
        </div>
        <Suspense fallback={null}>
          <Gate />
        </Suspense>
        <WelcomeForm />
      </div>
    </main>
  );
}
