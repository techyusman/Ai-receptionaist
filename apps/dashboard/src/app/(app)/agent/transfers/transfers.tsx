"use client";

import { Pencil, PhoneForwarded, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { deleteTransferTarget, saveTransferTarget, updateSettings } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { RadioGroup, Select, Switch } from "@/components/ui/controls";
import { Card, EmptyState, MobileDetail, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import { ConfirmDialog, Dialog, DialogClose } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import type { Settings, TransferIntent, TransferTarget } from "@/data/types";
import { prettyPhone } from "@/lib/format";

const intents: { value: TransferIntent; label: string }[] = [
  { value: "GENERAL", label: "Anything" },
  { value: "CATERING", label: "Catering and large orders" },
  { value: "LARGE_PARTY", label: "Events and large parties" },
  { value: "COMPLAINT", label: "Complaints" },
  { value: "ALLERGEN", label: "Allergy questions" },
];
const intentLabel = Object.fromEntries(intents.map((i) => [i.value, i.label])) as Record<TransferIntent, string>;

type Draft = Omit<TransferTarget, "id"> & { id?: string };
const blank: Draft = { label: "", e164: "", priority: 1, intent: "GENERAL", activeHours: "BUSINESS_HOURS", smsAlertOnMiss: true, enabled: true };

function toE164(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return raw.trim().startsWith("+") ? `+${d}` : raw.trim();
}

export function Transfers({ targets, settings }: { targets: TransferTarget[]; settings: Settings }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg text-fg">Transfer numbers</h2>
          <Button variant="secondary" onClick={() => setEditing({ ...blank })}>
            <Plus aria-hidden /> Add a number
          </Button>
        </div>
        {targets.length === 0 ? (
          <EmptyState icon={PhoneForwarded} title="No transfer numbers yet">
            Without one, the AI can only take a callback request when someone asks for a person.
          </EmptyState>
        ) : (
          <Table>
            <caption className="sr-only">Transfer numbers</caption>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th desktopOnly>Number</Th>
                <Th desktopOnly>For</Th>
                <Th desktopOnly>When</Th>
                <Th className="w-24">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {targets.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <span className="font-semibold">{t.label}</span>
                    {!t.enabled && <span className="ml-2 rounded-pill bg-surface-muted px-2 text-xs text-muted">Off</span>}
                    <MobileDetail>
                      {prettyPhone(t.e164)} · {intentLabel[t.intent]}
                    </MobileDetail>
                  </Td>
                  <Td desktopOnly className="whitespace-nowrap">{prettyPhone(t.e164)}</Td>
                  <Td desktopOnly className="text-muted">{intentLabel[t.intent]}</Td>
                  <Td desktopOnly className="text-muted">{t.activeHours === "ALWAYS" ? "Any time" : "Opening hours"}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Edit ${t.label}`} size="sm" onClick={() => setEditing({ ...t })}>
                        <Pencil aria-hidden />
                      </IconButton>
                      <ConfirmDialog
                        trigger={
                          <IconButton label={`Remove ${t.label}`} size="sm">
                            <Trash aria-hidden />
                          </IconButton>
                        }
                        title={`Remove ${t.label}?`}
                        description="The AI stops transferring calls to this number straight away."
                        confirmLabel="Remove"
                        onConfirm={async () => {
                          const r = await deleteTransferTarget(t.id);
                          toast(r.ok ? { title: `Removed ${t.label}`, variant: "success" } : { title: r.message, variant: "error" });
                        }}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <TargetDialog draft={editing} onClose={() => setEditing(null)} />}
      <Behaviour settings={settings} />
    </div>
  );
}

function TargetDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState({ ...draft, e164: draft.e164 ? prettyPhone(draft.e164) : "" });
  const save = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      locked={save.pending}
      title={draft.id ? `Edit ${draft.label}` : "Add a transfer number"}
      description="Use a line someone answers during service. A mobile works well: it can take a second call while you're on the first."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={save.pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button loading={save.pending} onClick={() => save.run(() => saveTransferTarget({ ...d, e164: toE164(d.e164) }), { success: "Saved", onDone: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Name" hint="Staff see this in call history, e.g. “Front counter”." error={save.fieldError("label")}>
          <Input value={d.label} onChange={(e) => set("label", e.target.value)} maxLength={60} />
        </FormField>
        <FormField label="Phone number" error={save.fieldError("e164")}>
          <Input value={d.e164} onChange={(e) => set("e164", e.target.value)} inputMode="tel" placeholder="212 555 0142" />
        </FormField>
        <FormField label="Use it for">
          <Select value={d.intent} onValueChange={(v) => set("intent", v as TransferIntent)} options={intents} />
        </FormField>
        <RadioGroup
          legend="When"
          value={d.activeHours}
          onValueChange={(v) => set("activeHours", v as Draft["activeHours"])}
          options={[
            { value: "BUSINESS_HOURS", title: "During opening hours" },
            { value: "ALWAYS", title: "Any time, including after hours" },
          ]}
        />
        <Switch label="Text this number if a transfer isn't answered" checked={d.smsAlertOnMiss} onCheckedChange={(v) => set("smsAlertOnMiss", v)} />
        <Switch label="Use this number" checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} />
      </div>
    </Dialog>
  );
}

function Behaviour({ settings }: { settings: Settings }) {
  const [strategy, setStrategy] = useState(settings.transferStrategy);
  const [timeout, setTimeoutValue] = useState(String(settings.transferTimeoutSeconds));
  const [attempts, setAttempts] = useState(String(settings.maxTransferAttempts));
  const save = useAction();
  const patch = { transferStrategy: strategy, transferTimeoutSeconds: Number(timeout), maxTransferAttempts: Number(attempts) };
  const dirty = patch.transferStrategy !== settings.transferStrategy || patch.transferTimeoutSeconds !== settings.transferTimeoutSeconds || patch.maxTransferAttempts !== settings.maxTransferAttempts;
  const incomplete = !timeout.trim() || !attempts.trim();
  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg text-fg">How transfers work</h2>
      <RadioGroup
        legend="Handing over"
        variant="cards"
        value={strategy}
        onValueChange={(v) => setStrategy(v as Settings["transferStrategy"])}
        options={[
          { value: "DIRECT", title: "Put the caller straight through", description: "Fastest. Staff pick up without context." },
          { value: "WARM", title: "Tell staff why first", description: "Staff hear a one-line summary (“Caller asking about catering for 40”) before the caller is connected." },
        ]}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Ring for (seconds)" hint="Then the caller comes back to the AI, which offers to take a callback." error={save.fieldError("transferTimeoutSeconds")}>
          <Input type="number" min={10} max={60} value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} />
        </FormField>
        <FormField label="Tries per call" error={save.fieldError("maxTransferAttempts")}>
          <Input type="number" min={1} max={5} value={attempts} onChange={(e) => setAttempts(e.target.value)} />
        </FormField>
      </div>
      {incomplete && <p className="text-sm text-warning">Fill in every number to save.</p>}
      <Button className="self-start" disabled={!dirty || incomplete} loading={save.pending} onClick={() => save.run(() => updateSettings(patch), { success: "Saved" })}>
        Save changes
      </Button>
    </Card>
  );
}
