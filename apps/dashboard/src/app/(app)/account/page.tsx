import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, PageHeader } from "@/components/app/page";
import { Card } from "@/components/ui/display";
import { roleLabel } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import { DeleteAccount } from "./delete-account";

export const metadata: Metadata = { title: "Your account" };

// Every role can reach this page: it is about the person, not the restaurant.
export default function AccountPage() {
  return (
    <>
      <PageHeader title="Your account" description="How you sign in, and leaving for good." />
      <Suspense fallback={<CardSkeleton rows={4} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const s = await requireSession();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg text-fg">Signed in as</h2>
        <p className="text-sm text-fg">
          <span className="font-semibold">{s.user.name}</span> · {s.user.email}
        </p>
        <p className="text-sm text-muted">
          {roleLabel[s.role]} at {s.restaurant.name}. You sign in with a code emailed to this address; there is no password to change.
        </p>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg text-fg">Delete your account</h2>
        <p className="text-sm text-muted">
          This removes your sign-in and your place on every team, straight away. Orders and calls you handled stay in the restaurant&apos;s records
          without your name. An owner has to hand the restaurant to someone else first.
        </p>
        <DeleteAccount />
      </Card>
    </div>
  );
}
