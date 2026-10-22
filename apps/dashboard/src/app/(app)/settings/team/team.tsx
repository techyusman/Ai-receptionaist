"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { changeMember, invite, revokeInvitation } from "@/app/actions/content";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { Card, MobileDetail, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import { ConfirmDialog, Dialog, DialogClose } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import type { Invitation, Member } from "@/data/types";
import { roleLabel } from "@/lib/permissions";

const roleHelp = {
  MANAGER: "Settings, menu, knowledge, calls and orders. Can't manage the team or privacy settings.",
  STAFF: "Live orders, calls, orders and callbacks for their location.",
};

export function Team({
  me,
  canManage,
  members,
  invitations,
}: {
  me: string;
  canManage: boolean;
  members: (Member & { lastSeen: string })[];
  invitations: (Invitation & { expires: string })[];
}) {
  const toast = useToast();
  const act = useAction();
  const active = members.filter((m) => m.status === "ACTIVE");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">{canManage && <InviteDialog />}</div>
      <Table>
        <caption className="sr-only">Team members</caption>
        <THead>
          <tr>
            <Th>Person</Th>
            <Th>Role</Th>
            <Th desktopOnly>Access to</Th>
            <Th desktopOnly>Last signed in</Th>
            {canManage && (
              <Th className="w-28">
                <span className="sr-only">Actions</span>
              </Th>
            )}
          </tr>
        </THead>
        <tbody>
          {active.map((m) => {
            const locked = m.userId === me || m.role === "OWNER";
            return (
              <Tr key={m.membershipId}>
                <Td>
                  <span className="font-semibold">{m.name}</span>
                  {m.userId === me && <span className="text-muted"> (you)</span>}
                  <span className="block text-xs break-all text-muted">{m.email}</span>
                  <MobileDetail>{m.scope === "ALL_LOCATIONS" ? "All locations" : m.scope}</MobileDetail>
                </Td>
                <Td>
                  {canManage && !locked ? (
                    <Select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onValueChange={(role) => act.run(() => changeMember(m.membershipId, { role: role as "MANAGER" | "STAFF" }), { success: `${m.name} is now ${roleLabel[role as "MANAGER"].toLowerCase()}` })}
                      options={[
                        { value: "MANAGER", label: "Manager" },
                        { value: "STAFF", label: "Staff" },
                      ]}
                      className="w-36"
                    />
                  ) : (
                    <span className="text-sm text-fg">{roleLabel[m.role]}</span>
                  )}
                </Td>
                <Td desktopOnly className="text-muted">{m.scope === "ALL_LOCATIONS" ? "All locations" : m.scope}</Td>
                <Td desktopOnly className="text-muted">{m.lastSeen}</Td>
                {canManage && (
                  <Td>
                    {!locked && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Remove
                          </Button>
                        }
                        title={`Remove ${m.name}?`}
                        description="They're signed out straight away and can't sign back in. Their past actions stay in the audit log."
                        confirmLabel="Remove access"
                        onConfirm={async () => {
                          const r = await changeMember(m.membershipId, { revoke: true });
                          toast(r.ok ? { title: `Removed ${m.name}`, variant: "success" } : { title: r.message, variant: "error" });
                        }}
                      />
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg text-fg">Waiting to join</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">No open invitations.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-fg">
                  <span className="font-semibold break-all">{i.email}</span>
                  <span className="text-muted">
                    {" "}
                    · {roleLabel[i.role]} · invited by {i.invitedBy} · expires {i.expires}
                  </span>
                </span>
                {canManage && (
                  <Button variant="ghost" size="sm" disabled={act.pending} onClick={() => act.run(() => revokeInvitation(i.id), { success: "Invitation cancelled" })}>
                    Cancel invite
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MANAGER" | "STAFF">("STAFF");
  const act = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) act.clearError();
      }}
      locked={act.pending}
      trigger={
        <Button>
          <UserPlus aria-hidden /> Invite someone
        </Button>
      }
      title="Invite someone"
      description="They'll get an email with a link. It works for 7 days."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={act.pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            loading={act.pending}
            onClick={() =>
              act.run(() => invite(email, role), {
                success: `Invitation sent to ${email}`,
                onDone: () => {
                  setOpen(false);
                  setEmail("");
                },
              })
            }
          >
            Send invite
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Email" error={act.fieldError("email")}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Role" hint={roleHelp[role]}>
          <Select value={role} onValueChange={(v) => setRole(v as "MANAGER" | "STAFF")} options={[{ value: "STAFF", label: "Staff" }, { value: "MANAGER", label: "Manager" }]} />
        </FormField>
      </div>
    </Dialog>
  );
}
