import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { getMe } from "@/server/auth";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Join your team" };

// The link in an invitation email lands here. Signing in comes back to this page, and the invite is
// only accepted for the address it was sent to (the API checks).
async function InviteBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  if (typeof token !== "string" || token.length < 20) {
    return <p className="text-sm text-fg">This link is incomplete. Open it again from the invitation email.</p>;
  }
  const me = await getMe();
  if (!me) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg">Sign in with the email address the invitation was sent to, then come back here to accept it.</p>
        <Button asChild size="lg">
          <Link href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}>Sign in to accept</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg">
        You&apos;re signed in as <strong className="font-semibold">{me.user.email}</strong>.
      </p>
      <AcceptButton token={token} />
    </div>
  );
}

export default function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-100 flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl text-fg">Join your team</h1>
          <p className="text-sm text-muted">Accept the invitation to see calls and orders for your restaurant.</p>
        </div>
        <Card>
          <Suspense fallback={<p className="text-sm text-muted">Checking the invitation…</p>}>
            <InviteBody searchParams={searchParams} />
          </Suspense>
        </Card>
      </div>
    </main>
  );
}
