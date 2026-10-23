"use client";

import Link from "next/link";
import { useState } from "react";
import { chooseSquareLocation, connectSquare, disconnectSquare, resyncMenu } from "@/app/actions/content";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/controls";
import { Banner, Card, StatusPill } from "@/components/ui/display";
import { SyncIndicator } from "@/components/ui/live";
import { ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import type { Feasibility, Integration, MenuStatus, OrderingMode, SquareLocationOption } from "@/data/types";

const feasibilityText: Record<Feasibility, { title: string; body: string; tone: "info" | "warning" | "success" | "danger" }> = {
  UNVERIFIED: {
    tone: "warning",
    title: "Square test not done yet",
    body: "We don't yet know if Square shows unpaid pickup orders to your staff. Until that's tested and signed off, phone orders can't go into Square.",
  },
  FALLBACK_APPROVED: {
    tone: "info",
    title: "Using Live orders instead of Square",
    body: "The restaurant approved staff accepting phone orders on the Live orders screen. Square still supplies the menu and prices.",
  },
  VERIFIED_NATIVE: {
    tone: "success",
    title: "Square test passed",
    body: "Unpaid pickup orders were shown to staff in Square during the test. Orders can go straight into Square.",
  },
  BLOCKED: {
    tone: "danger",
    title: "Square can't take these orders",
    body: "The test showed Square won't show unpaid pickup orders to staff. Use Live orders, or agree another workflow with the restaurant.",
  },
};

export function SquareSettings({
  integration,
  menu,
  squareLocations,
  location,
  canDisconnect,
}: {
  integration: Integration;
  menu: MenuStatus;
  squareLocations: SquareLocationOption[];
  location: { orderingMode: OrderingMode; feasibility: Feasibility; note: string | null; signedOffBy: string | null; signedOffAt: string | null };
  canDisconnect: boolean;
}) {
  const [env, setEnv] = useState<"SANDBOX" | "PRODUCTION">("SANDBOX");
  const [picked, setSquareLocation] = useState<string | undefined>();
  // The list arrives after connecting, so default to its first entry until someone picks.
  const squareLocation = picked ?? squareLocations[0]?.id;
  const action = useAction();
  const toast = useToast();
  const connected = integration.status === "CONNECTED";
  const f = feasibilityText[location.feasibility];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg text-fg">Connection</h2>
          <StatusPill domain="square" value={connected ? "CONNECTED" : "NEEDS_REAUTH"} size="sm" />
        </div>

        {!connected ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg">
              {integration.status === "DISCONNECTED"
                ? "Square isn't connected. Connect it so the AI can read your menu."
                : "Square stopped accepting our connection. Reconnect to keep the menu and orders working."}
            </p>
            <RadioGroup
              legend="Which Square account?"
              variant="cards"
              value={env}
              onValueChange={(v) => setEnv(v as "SANDBOX" | "PRODUCTION")}
              options={[
                { value: "SANDBOX", title: "Sandbox (testing)", description: "Square's test account. Safe for trying things out." },
                { value: "PRODUCTION", title: "Live account", description: "Your real menu and locations." },
              ]}
            />
            <p className="text-xs text-muted">
              You&apos;ll sign in to Square and approve read access to items and your locations, and permission to create orders. We never ask for payment access.
            </p>
            <Button className="self-start" loading={action.pending} onClick={() => action.run(() => connectSquare(env), { onDone: (d) => window.location.assign(d.url) })}>
              Connect Square
            </Button>
          </div>
        ) : !integration.posLocationId ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg">Connected to {integration.merchantName}. Which Square location is this restaurant?</p>
            <RadioGroup
              legend="Square location"
              variant="cards"
              value={squareLocation}
              onValueChange={setSquareLocation}
              options={squareLocations.map((l) => ({ value: l.id, title: l.name, description: l.address }))}
            />
            <Button
              className="self-start"
              loading={action.pending}
              disabled={!squareLocation}
              onClick={() => squareLocation && action.run(() => chooseSquareLocation(squareLocation), { success: "Location linked. Syncing the menu…" })}
            >
              Use this location
            </Button>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Account</dt>
            <dd className="text-fg">
              {integration.merchantName} {integration.environment === "SANDBOX" && <span className="text-muted">(sandbox)</span>}
            </dd>
            <dt className="text-muted">Location</dt>
            <dd className="text-fg">{integration.posLocationName}</dd>
            <dt className="text-muted">Access</dt>
            <dd className="text-fg">Read items, read and create orders, read locations. No payment access.</dd>
            <dt className="text-muted">Connected by</dt>
            <dd className="text-fg">{integration.connectedBy ?? "Unknown"}</dd>
          </dl>
        )}

        {connected && canDisconnect && (
          <div className="border-t border-border pt-4">
            <ConfirmDialog
              trigger={<Button variant="secondary">Disconnect Square</Button>}
              title="Disconnect Square?"
              description="The AI keeps answering questions but stops taking orders that go to Square. The menu stays as it was at the last sync."
              confirmLabel="Disconnect"
              onConfirm={async () => {
                const r = await disconnectSquare();
                toast(r.ok ? { title: "Square disconnected", variant: "success" } : { title: r.message, variant: "error" });
              }}
            />
          </div>
        )}
      </Card>

      {connected && integration.posLocationId && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg text-fg">Menu sync</h2>
          <p className="text-sm text-muted">
            Square tells us when your menu changes, and we check every 15 minutes in case a message is missed. {menu.itemCount} items are on the menu now.
          </p>
          <SyncIndicator
            state={menu.state}
            updatedAt={menu.lastSuccessAt ?? undefined}
            error={menu.lastErrorCode ?? undefined}
            onResync={() => action.run(() => resyncMenu(), { success: "Syncing the menu now" })}
          />
          <Link href="/menu" className="text-sm text-accent underline underline-offset-2">
            See the menu the AI uses
          </Link>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg text-fg">Sending phone orders to Square</h2>
        <Banner tone={f.tone} title={f.title}>
          {f.body}
        </Banner>
        {location.note && <p className="text-sm text-fg">Note: {location.note}</p>}
        {location.signedOffBy && (
          <p className="text-xs text-muted">
            Recorded by {location.signedOffBy}
            {location.signedOffAt ? ` on ${location.signedOffAt}` : ""}.
          </p>
        )}
        <Link href="/agent/orders" className="text-sm text-accent underline underline-offset-2">
          Change where phone orders go
        </Link>
      </Card>
    </div>
  );
}
