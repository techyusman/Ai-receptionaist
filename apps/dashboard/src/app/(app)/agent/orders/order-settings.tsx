"use client";

import { useState } from "react";
import { setOrdering, updateSettings } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { RadioGroup, Select, Switch } from "@/components/ui/controls";
import { Card } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/field";
import type { Feasibility, OrderingMode, Settings } from "@/data/types";

const feasibilityOptions: { value: Feasibility; label: string }[] = [
  { value: "UNVERIFIED", label: "Not tested yet" },
  { value: "FALLBACK_APPROVED", label: "Restaurant approved Live orders in writing" },
  { value: "VERIFIED_NATIVE", label: "Square test passed and signed off" },
  { value: "BLOCKED", label: "Square test failed" },
];

export function OrderSettings({
  settings,
  ordering,
  canSignOff,
}: {
  settings: Settings;
  ordering: { mode: OrderingMode; feasibility: Feasibility; note: string };
  canSignOff: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Destination initial={ordering} canSignOff={canSignOff} />
      <PickupRules settings={settings} />
    </div>
  );
}

function Destination({ initial, canSignOff }: { initial: { mode: OrderingMode; feasibility: Feasibility; note: string }; canSignOff: boolean }) {
  const [mode, setMode] = useState(initial.mode);
  const [feasibility, setFeasibility] = useState(initial.feasibility);
  const [note, setNote] = useState(initial.note);
  const save = useAction();
  const dirty = mode !== initial.mode || feasibility !== initial.feasibility || note !== initial.note;
  const ticketOk = feasibility === "FALLBACK_APPROVED" || feasibility === "VERIFIED_NATIVE";

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg text-fg">Where phone orders go</h2>
        <p className="text-sm text-muted">
          Square may not show unpaid pickup orders to your staff, so it stays locked until that&apos;s tested. Record the outcome here.
        </p>
      </div>
      <FormField label="Square test and sign-off" hint={canSignOff ? undefined : "Only owners can record a sign-off."}>
        <Select value={feasibility} onValueChange={(v) => setFeasibility(v as Feasibility)} options={feasibilityOptions} disabled={!canSignOff} />
      </FormField>
      <FormField label="Sign-off note" hint="Who agreed, and how. For example: “Approved by Maya by email, 14 Oct”." error={save.fieldError("note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={!canSignOff} />
      </FormField>
      <RadioGroup
        legend="Send phone orders to"
        variant="cards"
        value={mode}
        onValueChange={(v) => setMode(v as OrderingMode)}
        disabled={!canSignOff}
        options={[
          {
            value: "DASHBOARD_TICKET",
            title: "The Live orders screen",
            description: "Staff see each order on a tablet or computer and tap Accept.",
            ...(ticketOk ? {} : { disabledReason: "Needs the restaurant's written approval first." }),
          },
          {
            value: "SQUARE",
            title: "Straight into Square",
            description: "Orders appear in Square's order manager and kitchen display.",
            ...(feasibility === "VERIFIED_NATIVE" ? {} : { disabledReason: "Needs the Square test to pass and be signed off." }),
          },
          { value: "DISABLED", title: "Nowhere: don't take orders", description: "The AI answers questions and offers to pass the caller to staff." },
        ]}
      />
      {save.fieldError("mode") && <p className="text-sm text-danger">{save.fieldError("mode")}</p>}
      {canSignOff && (
        <Button
          className="self-start"
          disabled={!dirty}
          loading={save.pending}
          onClick={() => save.run(() => setOrdering({ mode, feasibility, note: note.trim() || null }), { success: "Saved where phone orders go" })}
        >
          Save
        </Button>
      )}
    </Card>
  );
}

function PickupRules({ settings }: { settings: Settings }) {
  const [orderingEnabled, setOrderingEnabled] = useState(settings.orderingEnabled);
  const [pickupNotesEnabled, setNotes] = useState(settings.pickupNotesEnabled);
  const [scheduledPickupEnabled, setScheduled] = useState(settings.scheduledPickupEnabled);
  const [pickupPolicy, setPolicy] = useState(settings.pickupPolicy);
  const [estimate, setEstimate] = useState(settings.pickupEstimateMinutes?.toString() ?? "");
  const save = useAction();
  const estimateValue = estimate.trim() === "" ? null : Number(estimate);
  const dirty =
    orderingEnabled !== settings.orderingEnabled ||
    pickupNotesEnabled !== settings.pickupNotesEnabled ||
    scheduledPickupEnabled !== settings.scheduledPickupEnabled ||
    pickupPolicy !== settings.pickupPolicy ||
    estimateValue !== settings.pickupEstimateMinutes;

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg text-fg">Taking orders</h2>
      <Switch label="Take pickup orders by phone" description="When this is off, the AI still answers questions." checked={orderingEnabled} onCheckedChange={setOrderingEnabled} />
      <Switch label="Ask for special requests" description="The AI notes things like “extra hot” or “cut in half”." checked={pickupNotesEnabled} onCheckedChange={setNotes} />
      <Switch label="Allow orders for later today" description="Callers can pick a pickup time instead of as soon as possible." checked={scheduledPickupEnabled} onCheckedChange={setScheduled} />
      <FormField label="What the AI says about pickup" hint="Keep it short. The AI always adds that payment is taken at pickup.">
        <Textarea value={pickupPolicy} onChange={(e) => setPolicy(e.target.value)} maxLength={1000} />
      </FormField>
      <FormField
        label="Pickup time to quote (minutes)"
        hint="Leave empty and the AI won't promise a time. Only fill this in if the kitchen can keep to it."
        error={save.fieldError("pickupEstimateMinutes")}
      >
        <Input type="number" min={1} max={240} value={estimate} onChange={(e) => setEstimate(e.target.value)} className="w-32" />
      </FormField>
      <Button
        className="self-start"
        disabled={!dirty}
        loading={save.pending}
        onClick={() =>
          save.run(
            () =>
              updateSettings({
                orderingEnabled,
                pickupNotesEnabled,
                scheduledPickupEnabled,
                pickupPolicy,
                pickupEstimateMinutes: estimateValue,
              }),
            { success: "Saved" },
          )
        }
      >
        Save changes
      </Button>
    </Card>
  );
}
