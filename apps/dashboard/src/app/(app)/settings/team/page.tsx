import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { fmtDateTime, fmtDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { Team } from "./team";

export const metadata: Metadata = { title: "Team" };

// S43: members, roles and invitations.
export default function TeamPage() {
  return (
    <>
      <PageHeader title="Team" description="Who can sign in, and what they can do. Owners manage the team; managers can see it." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "members.view")) return <NoAccess who="owners and managers" />;
  const [{ members, invitations }, location] = await Promise.all([api.listMembers(), api.getLocation()]);
  const tz = location.timezone;
  return (
    <Team
      me={session.user.id}
      canManage={can(session.role, "members.manage")}
      members={members.map((m) => ({ ...m, lastSeen: m.lastSeenAt ? fmtDateTime(m.lastSeenAt, tz) : "Never" }))}
      invitations={invitations.map((i) => ({ ...i, expires: fmtDay(i.expiresAt, tz) }))}
    />
  );
}
